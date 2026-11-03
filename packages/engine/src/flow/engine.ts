import { evaluate, type Fields, isEmpty } from "./condition.ts";
import { type FlowDefinition, FlowGraph, type NodeDefinition, type NodeEventAction } from "./definition.ts";
import { type Actor, FlowError, type FlowEvent, type NodeRuntime, type WorkItemState } from "./state.ts";

/** 确认节点时一起提交的内容：完成结论、意见、节点字段。 */
export interface ConfirmInput {
  conclusion?: string | null;
  comment?: string | null;
  nodeFields?: Record<string, unknown>;
}

/** 一次操作引发的连锁重算最多跑这么多轮，防止配置错误导致死循环。 */
export const MAX_PASSES = 1000;

/**
 * 节点流引擎。所有状态变化都在这里计算：输入一个操作，原地修改 WorkItemState，返回发生的事件。
 * 不依赖数据库和网络，服务端和浏览器共用。
 */
export class FlowEngine {
  readonly graph: FlowGraph;

  constructor(definition: FlowDefinition) {
    this.graph = new FlowGraph(definition);
  }

  /** 新建工作项：初始化所有节点并推进到第一个需要人处理的位置。 */
  start(fields: Fields, owners: Record<string, string[]> = {}): { state: WorkItemState; events: FlowEvent[] } {
    const state: WorkItemState = { status: "inProgress", stage: null, nodes: {} };
    for (const node of this.graph.nodes) {
      state.nodes[node.key] = { state: "notStarted", owners: [...(owners[node.key] ?? [])], confirmations: [] };
    }
    const events: FlowEvent[] = [];
    this.recompute(state, fields, events);
    return { state, events };
  }

  /**
   * 把工作项升级到这个（新版本的）流程：两个版本都有的节点保留原来的状态、负责人和结论，
   * 新版本里新增的节点从未开始算起（前序都通过了就会开始），旧版本里删掉的节点丢弃。
   */
  upgrade(
    previous: WorkItemState,
    fields: Fields,
    owners: Record<string, string[]> = {},
  ): { state: WorkItemState; events: FlowEvent[] } {
    const state: WorkItemState = { status: "inProgress", stage: previous.stage, nodes: {} };
    for (const node of this.graph.nodes) {
      const old = previous.nodes[node.key];
      state.nodes[node.key] = old
        ? structuredClone(old)
        : { state: "notStarted", owners: [...(owners[node.key] ?? [])], confirmations: [] };
    }
    const events: FlowEvent[] = [];
    this.recompute(state, fields, events);
    return { state, events };
  }

  /** 字段变化后调用：重新求值出现条件和自动节点的卡点。 */
  onFieldsChanged(state: WorkItemState, fields: Fields): FlowEvent[] {
    const events: FlowEvent[] = [];
    this.recompute(state, fields, events);
    return events;
  }

  /**
   * 负责人确认节点（单人确认、会签），或超管手动完成自动节点。
   * openTasks 是节点上还没完成的子任务数，有未完成的子任务时不能确认（和卡点一样，只有超管手动完成自动节点时不看）。
   */
  confirm(
    state: WorkItemState,
    nodeKey: string,
    actor: Actor,
    fields: Fields,
    openTasks = 0,
    input: ConfirmInput = {},
  ): FlowEvent[] {
    const node = this.graph.node(nodeKey);
    const runtime = this.runtime(state, nodeKey);
    const admin = actor.isSuperAdmin === true;

    if (runtime.state !== "inProgress") throw new FlowError(`节点「${node.name}」当前不是进行中，不能确认。`);
    if (node.restricted && !admin) throw new FlowError(`节点「${node.name}」是限制节点，只有空间管理员可以完成。`);

    const isAutomatic = node.completion === "auto" || node.completion === "subItemDriven";
    if (isAutomatic && !admin) throw new FlowError(`节点「${node.name}」是自动节点，只有超管可以手动完成。`);
    if (!isAutomatic && !admin && !runtime.owners.includes(actor.userId))
      throw new FlowError(`你不是节点「${node.name}」的负责人。`);

    const manualOverride = isAutomatic && admin;
    if (!manualOverride && openTasks > 0) throw new FlowError(`节点「${node.name}」还有 ${openTasks} 个子任务没完成。`);
    if (!manualOverride && missingFormFields(node, fields).length > 0)
      throw new FlowError(`节点「${node.name}」的完成表单还有必填项没填。`);
    if (node.gate && !manualOverride && !evaluate(node.gate, withNodes(fields, state)))
      throw new FlowError(`节点「${node.name}」的流转条件还没满足。`);

    // 节点字段和完成结论
    if (input.nodeFields) runtime.fields = { ...(runtime.fields ?? {}), ...input.nodeFields };
    if (!manualOverride) {
      const missing = (node.fields ?? []).filter((f) => f.required && isEmpty(runtime.fields?.[f.key]));
      if (missing.length > 0)
        throw new FlowError(`节点「${node.name}」还有必填的节点字段没填：${missing.map((f) => f.name).join("、")}。`);
    }
    const conclusion = node.conclusion;
    if (conclusion) {
      const value = input.conclusion ?? null;
      if (value !== null && !conclusion.options.some((o) => o.value === value))
        throw new FlowError(`节点「${node.name}」没有结论「${value}」。`);
      if (!manualOverride && conclusion.required && value === null)
        throw new FlowError(`节点「${node.name}」要选完成结论。`);
      if (!manualOverride && conclusion.commentRequired && !input.comment?.trim())
        throw new FlowError(`节点「${node.name}」要填完成意见。`);
      if (conclusion.perOwner && !admin) {
        runtime.verdicts = { ...(runtime.verdicts ?? {}), [actor.userId]: { value, comment: input.comment ?? null } };
      } else {
        runtime.conclusion = value;
        runtime.comment = input.comment ?? null;
      }
    }

    const events: FlowEvent[] = [];
    if (node.completion === "allConfirm" && !admin) {
      if (!runtime.confirmations.includes(actor.userId)) runtime.confirmations.push(actor.userId);
      events.push({ type: "nodeConfirmed", node: nodeKey, by: actor.userId });
      if (!runtime.owners.every((o) => runtime.confirmations.includes(o))) return events;
    }

    this.complete(state, nodeKey, actor.userId, events);
    this.recompute(state, fields, events);
    return events;
  }

  /** 关联的子工作项走到结束时调用，完成“子工作项驱动”的节点。节点没到达时忽略。 */
  completeBySubItem(state: WorkItemState, nodeKey: string, fields: Fields): FlowEvent[] {
    const events: FlowEvent[] = [];
    if (this.runtime(state, nodeKey).state !== "inProgress") return events;
    this.complete(state, nodeKey, null, events);
    this.recompute(state, fields, events);
    return events;
  }

  /** 回滚：把节点重置为进行中，它之后已经开始或完成的节点全部打回未开始。 */
  rollback(state: WorkItemState, nodeKey: string, actor: Actor, fields: Fields): FlowEvent[] {
    const runtime = this.runtime(state, nodeKey);
    if (runtime.state !== "inProgress" && runtime.state !== "completed")
      throw new FlowError(`节点「${this.graph.node(nodeKey).name}」还没到达，不能回滚。`);

    const events: FlowEvent[] = [{ type: "nodeRolledBack", node: nodeKey, by: actor.userId }];
    runtime.state = "inProgress";
    runtime.confirmations = [];
    clearConclusion(runtime);

    for (const key of this.graph.descendants(nodeKey)) {
      const downstream = this.runtime(state, key);
      if (downstream.state === "inProgress" || downstream.state === "completed") {
        downstream.state = "notStarted";
        downstream.confirmations = [];
        clearConclusion(downstream);
      }
    }

    if (state.status === "completed") {
      state.status = "inProgress";
      events.push({ type: "workItemReopened" });
    }

    this.recompute(state, fields, events);
    return events;
  }

  private runtime(state: WorkItemState, key: string): NodeRuntime {
    const runtime = state.nodes[key];
    if (!runtime) throw new FlowError(`工作项状态里没有节点 ${key}`);
    return runtime;
  }

  private complete(state: WorkItemState, key: string, by: string | null, events: FlowEvent[]) {
    const runtime = this.runtime(state, key);
    const node = this.graph.node(key);
    runtime.state = "completed";
    // 各自填结论的节点：完成时按汇总方式算出整体结论
    if (node.conclusion?.perOwner && runtime.verdicts && runtime.conclusion == null)
      runtime.conclusion = aggregateVerdicts(node.conclusion, runtime.verdicts);
    events.push({ type: "nodeCompleted", node: key, by });
    this.applyActions(state, node, node.onComplete, events);
  }

  /** 节点事件：改状态（可以限定只在某些状态下改）、改字段值（交给调用方写）。 */
  private applyActions(
    state: WorkItemState,
    node: NodeDefinition,
    actions: readonly NodeEventAction[] | undefined,
    events: FlowEvent[],
  ) {
    for (const action of actions ?? []) {
      if (action.kind === "setField") {
        events.push({ type: "fieldAssigned", node: node.key, field: action.field, value: action.value });
        continue;
      }
      if (action.onlyFrom?.length && !action.onlyFrom.includes(state.stage ?? "")) continue;
      if (action.stage === state.stage) continue;
      events.push({ type: "stageChanged", node: node.key, from: state.stage, to: action.stage });
      state.stage = action.stage;
    }
  }

  /** 状态计算规则：第一个满足的条件组决定状态。 */
  private applyStageRules(state: WorkItemState, fields: Fields, events: FlowEvent[]) {
    const rules = this.graph.definition.stageRules ?? [];
    if (rules.length === 0) return;
    const view = withNodes(fields, state);
    const hit = rules.find((r) => evaluate(r.when, view));
    if (!hit || hit.stage === state.stage) return;
    events.push({ type: "stageChanged", node: null, from: state.stage, to: hit.stage });
    state.stage = hit.stage;
  }

  /** 反复应用规则直到状态不再变化：可见性 → 开始 → 自动完成，最后判断工作项完成。 */
  private recompute(state: WorkItemState, fields: Fields, events: FlowEvent[]) {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const visibility = this.applyVisibility(state, fields, events);
      const starts = this.applyStarts(state, events);
      const autos = this.applyAutoCompletions(state, fields, events);
      if (!visibility && !starts && !autos) {
        this.applyWorkItemCompletion(state, events);
        this.applyStageRules(state, fields, events);
        return;
      }
    }
    throw new FlowError("流程重算超过上限，可能存在循环依赖。");
  }

  private applyVisibility(state: WorkItemState, fields: Fields, events: FlowEvent[]): boolean {
    let changed = false;
    for (const node of this.graph.nodes) {
      if (!node.visibility) continue;
      const runtime = this.runtime(state, node.key);
      const visible = evaluate(node.visibility, fields);

      if (!visible && (runtime.state === "notStarted" || runtime.state === "inProgress")) {
        runtime.state = "skipped";
        runtime.confirmations = [];
        events.push({ type: "nodeSkipped", node: node.key });
        changed = true;
      } else if (visible && runtime.state === "skipped") {
        runtime.state = "notStarted";
        events.push({ type: "nodeRestored", node: node.key });
        changed = true;
      }
    }
    return changed;
  }

  private applyStarts(state: WorkItemState, events: FlowEvent[]): boolean {
    let changed = false;
    const memo = new Map<string, boolean>();
    for (const node of this.graph.nodes) {
      const runtime = this.runtime(state, node.key);
      if (runtime.state !== "notStarted") continue;
      if (!this.graph.predecessors(node.key).every((p) => this.isPassed(state, p, memo))) continue;

      runtime.state = "inProgress";
      events.push({ type: "nodeStarted", node: node.key });
      this.applyStage(state, node, events);
      this.applyActions(state, node, node.onArrive, events);
      changed = true;
    }
    return changed;
  }

  private applyStage(state: WorkItemState, node: NodeDefinition, events: FlowEvent[]) {
    const stage = node.stageOnArrival;
    if (stage === undefined || stage === state.stage) return;
    events.push({ type: "stageChanged", node: node.key, from: state.stage, to: stage });
    state.stage = stage;
  }

  /**
   * 节点对后续节点而言是否“已通过”：已完成；或被裁剪且它自己的前序都已通过。
   * 后者保证 A → B(裁剪) → C 时，C 仍要等 A。
   */
  private isPassed(state: WorkItemState, key: string, memo: Map<string, boolean>): boolean {
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const current = this.runtime(state, key).state;
    const result =
      current === "completed" ||
      (current === "skipped" && this.graph.predecessors(key).every((p) => this.isPassed(state, p, memo)));
    memo.set(key, result);
    return result;
  }

  private applyAutoCompletions(state: WorkItemState, fields: Fields, events: FlowEvent[]): boolean {
    let changed = false;
    for (const node of this.graph.nodes) {
      if (node.completion !== "auto") continue;
      if (this.runtime(state, node.key).state !== "inProgress") continue;
      if (node.gate && !evaluate(node.gate, withNodes(fields, state))) continue;
      if (missingFormFields(node, fields).length > 0) continue;
      this.complete(state, node.key, null, events);
      changed = true;
    }
    return changed;
  }

  /** 所有可见的末端节点都完成时，工作项完成。被裁剪的末端节点不参与判断。 */
  private applyWorkItemCompletion(state: WorkItemState, events: FlowEvent[]) {
    if (state.status === "completed") return;
    const leaves = this.graph.leaves.map((n) => this.runtime(state, n.key).state);
    const done = leaves.every((s) => s === "completed" || s === "skipped") && leaves.some((s) => s === "completed");
    if (done) {
      state.status = "completed";
      events.push({ type: "workItemCompleted" });
    }
  }
}

/** 条件求值用的字段：工作项字段，加上 `$node.节点键`（节点状态）和 `$conclusion.节点键`（完成结论）。 */
export function withNodes(fields: Fields, state: WorkItemState): Fields {
  const view: Record<string, unknown> = { ...fields };
  for (const [key, runtime] of Object.entries(state.nodes)) {
    view[`$node.${key}`] = runtime.state;
    view[`$conclusion.${key}`] = runtime.conclusion ?? null;
  }
  return view;
}

/** 个人结论汇总成整体结论。 */
export function aggregateVerdicts(
  conclusion: NonNullable<NodeDefinition["conclusion"]>,
  verdicts: Record<string, { value: string | null }>,
): string | null {
  const values = Object.values(verdicts)
    .map((v) => v.value)
    .filter((v): v is string => v !== null);
  if (values.length === 0) return null;
  if (conclusion.aggregate === "veto") {
    const failed = conclusion.options.find((o) => o.passed === false && values.includes(o.value));
    if (failed) return failed.value;
  }
  // 少数服从多数；平票时取选项里靠前的
  let best: string | null = null;
  let count = 0;
  for (const option of conclusion.options) {
    const n = values.filter((v) => v === option.value).length;
    if (n > count) {
      best = option.value;
      count = n;
    }
  }
  return best;
}

function clearConclusion(runtime: NodeRuntime) {
  if (runtime.conclusion !== undefined) runtime.conclusion = null;
  if (runtime.comment !== undefined) runtime.comment = null;
  if (runtime.verdicts !== undefined) runtime.verdicts = {};
}

/** 节点完成表单里还没填的必填字段键。 */
export function missingFormFields(node: NodeDefinition, fields: Fields): string[] {
  return (node.form ?? []).filter((f) => f.required && isEmpty(fields[f.field])).map((f) => f.field);
}
