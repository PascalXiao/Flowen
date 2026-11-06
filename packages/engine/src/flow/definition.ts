import type { Condition } from "./condition.ts";

export type CompletionMode =
  /** 任一负责人确认即完成。 */
  | "singleConfirm"
  /** 会签：全部负责人确认才完成。 */
  | "allConfirm"
  /** 卡点条件满足后自动完成；只有超管可以手动完成。 */
  | "auto"
  /** 关联的子工作项走到结束时完成。 */
  | "subItemDriven";

/** 节点完成表单里的一项：确认完成时要填的工作项字段。 */
export interface NodeFormField {
  field: string;
  /** 必填：没填就不能完成节点（自动节点也等它填好）。 */
  required?: boolean;
}

/** 完成结论的一个选项，如「已通过」「未通过」「有条件通过」。 */
export interface ConclusionOption {
  value: string;
  label: string;
  /** 算不算通过：节点在流程图上按它显示「已通过 / 未通过」，流转条件也可以判断。 */
  passed?: boolean;
}

/** 节点的完成结论与意见。 */
export interface NodeConclusion {
  options: ConclusionOption[];
  /** 每位负责人各填各的（会签时常用），整体结论按 aggregate 汇总；否则只填一个整体结论。 */
  perOwner?: boolean;
  /** 个人结论怎么汇总：majority 少数服从多数（平票取靠前的选项），veto 一票否决（有人选了不通过的就不通过）。 */
  aggregate?: "majority" | "veto";
  /** 完成时必须选结论。 */
  required?: boolean;
  /** 完成时必须写意见。 */
  commentRequired?: boolean;
}

/** 节点上的自定义按钮。 */
export interface NodeButton {
  key: string;
  label: string;
  style?: "primary" | "default" | "warning";
  /** complete：完成节点（可带结论）；assign：只改字段值，不完成节点。 */
  action: "complete" | "assign";
  /** 按下时记下的完成结论。 */
  conclusion?: string;
  /** 按下时写入的字段值。 */
  assignments?: { field: string; value: string | number | boolean | string[] | null }[];
  /** 只有这些角色能按；为空时节点负责人能按。 */
  roles?: string[];
}

/** 节点自己的字段（不是工作项字段），值记在节点实例上。 */
export interface NodeFieldDefinition {
  key: string;
  name: string;
  dataType: "text" | "number" | "date" | "select" | "multiSelect";
  options?: { value: string; label: string }[];
  /** 完成节点前必须填。 */
  required?: boolean;
}

/** 节点到达或完成时触发的动作。 */
export type NodeEventAction =
  /** 改工作项状态（阶段）；onlyFrom 不为空时，只有当前状态在其中才改。 */
  | { kind: "setStage"; stage: string; onlyFrom?: string[] }
  /** 改工作项字段的值。 */
  | { kind: "setField"; field: string; value: string | number | boolean | string[] | null };

/** 相对排期：节点的计划结束日按某个日期字段推算（如从上市日倒推）。 */
export interface RelativeSchedule {
  /** 作为基准的日期字段。 */
  field: string;
  /** 相对基准偏移的工作日，负数是往前推。 */
  offset: number;
}

export interface NodeDefinition {
  key: string;
  name: string;
  completion: CompletionMode;
  ownerRoles: string[];
  /** 可操作角色：除负责人和空间管理员外，还可以回滚到这个节点、调整它排期的角色。 */
  operatorRoles?: string[];
  /** 出现条件。不满足时节点被裁剪（跳过）。 */
  visibility?: Condition;
  /** 卡点：节点完成前必须满足的条件。 */
  gate?: Condition;
  /** 完成表单：负责人确认完成时一起填写的字段。 */
  form?: NodeFormField[];
  /** 预置子任务的名称，新建工作项时为节点建好。 */
  tasks?: string[];
  /**
   * 节点上只读显示的关联信息：沿关联（本端看到的关联名）取对端工作项的一个字段，
   * 给负责人确认时参考。
   */
  relatedInfo?: { relation: string; field: string }[];
  /**
   * 节点上的估分、实际工时，
   * 以及确认完成时是否必须填好实际工时、排期。
   */
  effort?: { points?: boolean; hours?: "show" | "required"; scheduleRequired?: boolean; ownersRequired?: boolean };
  /**
   * 节点下的子工作项：在节点上新建 type 类型的工作项，自动经 relation（本端看到的关联名）关联上；
   * scheduleLinked 时节点排期可以按这些工作项的排期范围更新。和「子工作项驱动」不同，不决定节点什么时候完成。
   */
  subItems?: { type: string; relation: string; scheduleLinked?: boolean };
  /** 节点上显示的别的节点的信息（负责人、排期、结论），如立项时先给后面的节点排期。 */
  nodeInfo?: { node: string; info?: ("owner" | "schedule" | "conclusion")[] }[];
  /** 节点到达时把工作项阶段改成这个值。 */
  stageOnArrival?: string;
  /** 预估工期（工作日）。不填时需要人确认的节点按 1 天，自动节点按 0 天（里程碑）。 */
  duration?: number;
  /** 里程碑：只有截止日期，不占工期。 */
  milestone?: boolean;
  /** 限制节点：只有空间管理员能完成、回滚。 */
  restricted?: boolean;
  conclusion?: NodeConclusion;
  buttons?: NodeButton[];
  fields?: NodeFieldDefinition[];
  /** 节点到达时触发。 */
  onArrive?: NodeEventAction[];
  /** 节点完成时触发。 */
  onComplete?: NodeEventAction[];
  schedule?: RelativeSchedule;
  /** 编辑器里的画布坐标。引擎不使用；没有时按层级自动布局。 */
  position?: { x: number; y: number };
}

export interface EdgeDefinition {
  from: string;
  to: string;
}

/** 一个流程模板版本的完整定义。发布后不可修改，改动只能发布新版本。可以直接 JSON 序列化。 */
export interface FlowDefinition {
  key: string;
  version: number;
  nodes: NodeDefinition[];
  edges: EdgeDefinition[];
  /**
   * 状态计算规则：从上到下第一个满足的条件组决定工作项状态（阶段），都不满足时按节点事件。
   * 条件可以用字段，也可以用节点状态：字段键写成 `$node.节点键`，值是 notStarted / inProgress / completed / skipped，
   * 结论写成 `$conclusion.节点键`。
   */
  stageRules?: { when: Condition; stage: string }[];
}

/** 流程图的只读索引：按键查节点、前序、后续、末端节点。 */
export class FlowGraph {
  private readonly byKey: Map<string, NodeDefinition>;
  private readonly preds = new Map<string, string[]>();
  private readonly succs = new Map<string, string[]>();

  readonly definition: FlowDefinition;

  constructor(definition: FlowDefinition) {
    this.definition = definition;
    this.byKey = new Map(definition.nodes.map((n) => [n.key, n]));
    for (const { from, to } of definition.edges) {
      push(this.succs, from, to);
      push(this.preds, to, from);
    }
  }

  get nodes(): readonly NodeDefinition[] {
    return this.definition.nodes;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  node(key: string): NodeDefinition {
    const node = this.byKey.get(key);
    if (!node) throw new Error(`流程里没有节点 ${key}`);
    return node;
  }

  predecessors(key: string): readonly string[] {
    return this.preds.get(key) ?? [];
  }

  successors(key: string): readonly string[] {
    return this.succs.get(key) ?? [];
  }

  /** 没有后续节点的节点。工作项完成的判定看这些节点。 */
  get leaves(): NodeDefinition[] {
    return this.nodes.filter((n) => this.successors(n.key).length === 0);
  }

  /** 拓扑序：每个节点都排在它的所有前序之后。有环时环上的节点不在结果里。 */
  topologicalOrder(): string[] {
    const inDegree = new Map(this.nodes.map((n) => [n.key, this.predecessors(n.key).length]));
    const queue = this.nodes.filter((n) => inDegree.get(n.key) === 0).map((n) => n.key);
    const order: string[] = [];
    while (queue.length > 0) {
      const key = queue.shift() as string;
      order.push(key);
      for (const next of this.successors(key)) {
        const left = (inDegree.get(next) ?? 0) - 1;
        inDegree.set(next, left);
        if (left === 0) queue.push(next);
      }
    }
    return order;
  }

  /** 某节点之后能到达的所有节点。 */
  descendants(key: string): Set<string> {
    const seen = new Set<string>();
    const queue = [...this.successors(key)];
    while (queue.length > 0) {
      const next = queue.shift() as string;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...this.successors(next));
    }
    return seen;
  }
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** 按节点的负责角色，把工作项上各角色的成员展开成每个节点的负责人。 */
export function resolveOwners(
  definition: FlowDefinition,
  membersByRole: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  return Object.fromEntries(
    definition.nodes.map((n) => [n.key, [...new Set(n.ownerRoles.flatMap((role) => membersByRole[role] ?? []))]]),
  );
}
