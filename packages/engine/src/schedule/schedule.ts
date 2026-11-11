import type { FlowGraph, NodeDefinition } from "../flow/definition.ts";
import type { InstanceDependency, NodeState } from "../flow/state.ts";
import type { Day, WorkCalendar } from "./calendar.ts";

export interface Span {
  start: Day;
  end: Day;
}

export interface ScheduleNodeInput {
  state: NodeState;
  /** 负责人手动定过的日期，重排时不动。 */
  pinned?: Span | null;
  /** 节点实际完成的日期。已完成的节点按它推后续节点。 */
  actualEnd?: Day | null;
  /** 相对排期算出的计划结束日（如上市日往前推 N 个工作日）。手动定过的日期优先。 */
  anchorEnd?: Day | null;
}

export interface ScheduleInput {
  /** 第一个节点最早的开始日期，通常是工作项创建那天。 */
  start: Day;
  nodes: Readonly<Record<string, ScheduleNodeInput>>;
  /** 工作项上加的依赖（只算本工作项里的节点）。 */
  dependencies?: InstanceDependencies;
}

/** 工作项上加的依赖，按等待的节点分组。 */
export type InstanceDependencies = Readonly<Record<string, readonly InstanceDependency[]>>;

/**
 * 排期上的先后约束：FS 前一个结束后再过 lag 个工作日开始（连线和「完成后开始」都是 lag 0），
 * SS 前一个开始后再过 lag 个工作日开始，FF 不早于前一个结束。
 */
export interface ScheduleLink {
  from: string;
  to: string;
  type: "FS" | "SS" | "FF";
  lag: number;
}

/**
 * 连线、依赖和排期规则合在一起的排期约束。指向不存在节点的跳过。
 * 工作项上加的依赖里，等本工作项节点的也算；等别的工作项的不影响排期。
 */
export function scheduleLinks(graph: FlowGraph, dependencies?: InstanceDependencies): ScheduleLink[] {
  const links: ScheduleLink[] = graph.definition.edges.map((e) => ({ from: e.from, to: e.to, type: "FS", lag: 0 }));
  for (const node of graph.nodes) {
    for (const d of node.dependsOn ?? [])
      if (graph.has(d.node) && d.node !== node.key)
        links.push({ from: d.node, to: node.key, type: d.allow === "start" ? "FS" : "FF", lag: 0 });
    for (const r of node.scheduleRules ?? [])
      if (graph.has(r.node) && r.node !== node.key)
        links.push({ from: r.node, to: node.key, type: r.edge === "end" ? "FS" : "SS", lag: Math.trunc(r.offset) });
    for (const d of dependencies?.[node.key] ?? [])
      if ("node" in d && graph.has(d.node) && d.node !== node.key)
        links.push({ from: d.node, to: node.key, type: d.allow === "start" ? "FS" : "FF", lag: 0 });
  }
  return links;
}

/** 按约束排的先后顺序。有环时环上的节点按定义顺序排在最后（发布前的校验会拦住环）。 */
export function linkOrder(graph: FlowGraph, links: readonly ScheduleLink[]): string[] {
  const { order, cyclic } = sortLinks(graph, links);
  return [...order, ...cyclic];
}

/** 互相等待、排不出先后的节点（依赖或排期规则绕成了环）。 */
export function cyclicNodes(graph: FlowGraph, links: readonly ScheduleLink[]): string[] {
  return sortLinks(graph, links).cyclic;
}

function sortLinks(graph: FlowGraph, links: readonly ScheduleLink[]): { order: string[]; cyclic: string[] } {
  const inDegree = new Map(graph.nodes.map((n) => [n.key, 0]));
  const out = new Map<string, string[]>();
  for (const l of links) {
    inDegree.set(l.to, (inDegree.get(l.to) ?? 0) + 1);
    out.set(l.from, [...(out.get(l.from) ?? []), l.to]);
  }
  const queue = graph.nodes.filter((n) => inDegree.get(n.key) === 0).map((n) => n.key);
  const order: string[] = [];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    order.push(key);
    for (const next of out.get(key) ?? []) {
      const left = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  const placed = new Set(order);
  return { order, cyclic: graph.nodes.map((n) => n.key).filter((k) => !placed.has(k)) };
}

/** 节点的预估工期（工作日）。没有配置时，需要人处理的节点按 1 天，自动节点是 0 天的里程碑。 */
export function durationOf(node: NodeDefinition): number {
  if (node.milestone) return 0;
  if (node.duration !== undefined) return Math.max(0, Math.floor(node.duration));
  return node.completion === "auto" ? 0 : 1;
}

/**
 * 按依赖关系推算每个节点的计划日期：节点在所有前序结束后的下一个工作日开始，持续它的工期。
 * - 跳过的节点没有日期，只把前序的结束时间传给后续节点；
 * - 手动定过日期的节点保留原日期，后续节点从它的结束日期往后排；
 * - 已完成的节点用实际完成日期往后推（完成当天后续节点就可以开始），延误会自动顺延到后面。
 * 0 天的节点是里程碑，落在前序结束的那天，不占后续节点的时间。
 */
export function schedule(graph: FlowGraph, calendar: WorkCalendar, input: ScheduleInput): Record<string, Span | null> {
  const result: Record<string, Span | null> = {};
  /** 节点对后续节点而言的结束日；没有前序的节点以 start 的前一天作为“前序结束”。 */
  const finish = new Map<string, Day>();
  const links = scheduleLinks(graph, input.dependencies);
  const incoming = new Map<string, ScheduleLink[]>();
  for (const l of links) incoming.set(l.to, [...(incoming.get(l.to) ?? []), l]);

  for (const key of linkOrder(graph, links)) {
    const node = graph.node(key);
    const info = input.nodes[key];
    let ready = input.start - 1;
    /** SS 约束给出的最早开始日。 */
    let minStart: Day | null = null;
    /** FF 约束给出的最早结束日。 */
    let minEnd: Day | null = null;
    for (const l of incoming.get(key) ?? []) {
      if (l.type === "FS") {
        const f = finish.get(l.from);
        if (f !== undefined) ready = Math.max(ready, l.lag === 0 ? f : calendar.offsetWorkdays(f, l.lag));
      } else {
        const span = result[l.from];
        if (!span) continue;
        if (l.type === "SS") {
          const s = calendar.offsetWorkdays(span.start, l.lag);
          minStart = minStart === null ? s : Math.max(minStart, s);
        } else minEnd = minEnd === null ? span.end : Math.max(minEnd, span.end);
      }
    }

    if (info?.state === "skipped") {
      result[key] = null;
      finish.set(key, ready);
      continue;
    }

    const duration = durationOf(node);
    let span: Span;
    /** 对后续节点而言的结束日。 */
    let end: Day;
    if (info?.pinned) {
      span = info.pinned;
      end = span.end;
    } else if (info?.anchorEnd != null) {
      // 相对排期：结束日由基准日期推出，开始日往前数工期
      const anchor = calendar.onOrBefore(info.anchorEnd);
      span = { start: duration === 0 ? anchor : calendar.offsetWorkdays(anchor, -(duration - 1)), end: anchor };
      end = anchor;
    } else if (duration === 0) {
      // 里程碑不占工期：后续节点照常从前序结束后的下一个工作日开始
      const day = Math.max(ready, input.start, minStart ?? ready, minEnd ?? ready);
      span = { start: day, end: day };
      end = Math.max(ready, minStart === null ? ready : minStart - 1, minEnd ?? ready);
    } else {
      let start = calendar.onOrAfter(Math.max(ready + 1, minStart ?? ready + 1));
      end = calendar.addWorkdays(start, duration - 1);
      if (minEnd !== null && end < minEnd) {
        // 要等依赖的节点完成才能完成：整体往后挪，工期不变
        end = calendar.onOrAfter(minEnd);
        start = calendar.offsetWorkdays(end, -(duration - 1));
      }
      span = { start, end };
    }
    result[key] = span;
    // 已完成的节点：完成当天后续节点就可以开始，所以“结束”记为完成日的前一天
    finish.set(key, info?.state === "completed" && info.actualEnd != null ? Math.max(info.actualEnd - 1, ready) : end);
  }
  return result;
}
