import { cyclicNodes, scheduleLinks } from "../schedule/schedule.ts";
import { type FlowDefinition, FlowGraph } from "./definition.ts";

export interface ValidationResult {
  /** 阻止发布的问题。 */
  errors: string[];
  /** 只提示、不阻止发布的问题。 */
  warnings: string[];
}

/** 流程模板发布前的校验。模板编辑器里也用它做实时提示。 */
export function validateFlow(definition: FlowDefinition): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const seen = new Set<string>();
  for (const node of definition.nodes) {
    if (seen.has(node.key)) errors.push(`节点键重复：${node.key}`);
    seen.add(node.key);
  }
  if (errors.length > 0) return { errors, warnings };

  for (const edge of definition.edges) {
    if (!seen.has(edge.from)) errors.push(`连线起点不存在：${edge.from}`);
    if (!seen.has(edge.to)) errors.push(`连线终点不存在：${edge.to}`);
  }
  if (errors.length > 0) return { errors, warnings };

  const graph = new FlowGraph(definition);
  const starts = graph.nodes.filter((n) => graph.predecessors(n.key).length === 0);
  if (starts.length !== 1) errors.push(`流程必须有且只有一个起始节点，现在有 ${starts.length} 个。`);

  const order = graph.topologicalOrder();
  if (order.length !== graph.nodes.length) errors.push("流程图里存在环。");

  for (const node of graph.nodes) {
    const needsPeople = node.completion === "singleConfirm" || node.completion === "allConfirm";
    if (needsPeople && node.ownerRoles.length === 0)
      warnings.push(`节点「${node.name}」需要人确认，但没有配置负责角色。`);
    const formFields = (node.form ?? []).map((f) => f.field);
    if (new Set(formFields).size !== formFields.length) errors.push(`节点「${node.name}」的完成表单里有重复的字段。`);
    if ((node.tasks ?? []).some((t) => t.trim() === "")) errors.push(`节点「${node.name}」有名称为空的预置子任务。`);
  }

  // 依赖和排期规则：指向的节点要存在，不能是自己或后面的节点（后面的节点要等它，再反过来等后面的就卡死了）
  for (const node of graph.nodes) {
    const refs = [
      ...(node.dependsOn ?? []).map((d) => ({ key: d.node, what: "依赖" })),
      ...(node.scheduleRules ?? []).map((r) => ({ key: r.node, what: "排期规则" })),
    ];
    const after = order.length === graph.nodes.length ? graph.descendants(node.key) : new Set<string>();
    for (const { key, what } of refs) {
      if (!graph.has(key)) errors.push(`节点「${node.name}」的${what}指向不存在的节点：${key}`);
      else if (key === node.key) errors.push(`节点「${node.name}」的${what}不能指向自己。`);
      else if (after.has(key))
        errors.push(`节点「${node.name}」的${what}指向它后面的节点「${graph.node(key).name}」，流程会卡住。`);
    }
  }
  if (errors.length === 0) {
    const stuck = cyclicNodes(graph, scheduleLinks(graph));
    if (stuck.length > 0)
      errors.push(`这些节点的依赖或排期规则互相等待：${stuck.map((k) => graph.node(k).name).join("、")}。`);
  }

  if (errors.length === 0) warnings.push(...stageRegressions(graph, order));
  return { errors, warnings };
}

/**
 * 节点把阶段改回比它某个前序节点更早的阶段时给出警告（如 OEM 的“配方成本初步核算”）。
 * 阶段先后按它们在流程里第一次出现的顺序推断。
 */
function stageRegressions(graph: FlowGraph, order: string[]): string[] {
  const rank = new Map<string, number>();
  for (const key of order) {
    const stage = graph.node(key).stageOnArrival;
    if (stage !== undefined && !rank.has(stage)) rank.set(stage, rank.size);
  }

  const warnings: string[] = [];
  const reached = new Map<string, number>();
  for (const key of order) {
    const node = graph.node(key);
    const inherited = Math.max(-1, ...graph.predecessors(key).map((p) => reached.get(p) ?? -1));
    const own = node.stageOnArrival !== undefined ? (rank.get(node.stageOnArrival) ?? -1) : -1;
    if (own >= 0 && own < inherited)
      warnings.push(`节点「${node.name}」会把阶段改回「${node.stageOnArrival}」，早于它前面已经到达的阶段。`);
    reached.set(key, Math.max(own, inherited));
  }
  return warnings;
}
