export type NodeState =
  | "notStarted"
  | "inProgress"
  | "completed"
  /** 出现条件不满足，被流程裁剪。汇聚时视为已通过。 */
  | "skipped";

export type WorkItemStatus = "inProgress" | "completed";

export interface NodeRuntime {
  state: NodeState;
  owners: string[];
  confirmations: string[];
  /** 整体完成结论（选项值）和意见。 */
  conclusion?: string | null;
  comment?: string | null;
  /** 每位负责人的个人结论和意见。 */
  verdicts?: Record<string, { value: string | null; comment?: string | null }>;
  /** 节点字段的值。 */
  fields?: Record<string, unknown>;
}

/**
 * 工作项上加的依赖（流程定义之外的）：
 * - node：等本工作项里的另一个节点，引擎按它当前的状态判断；
 * - waiting：等别的工作项里的节点，调用方只把还没完成的传进来，值是显示用的名称。
 */
export type InstanceDependency = { allow: "start" | "complete" } & ({ node: string } | { waiting: string });

/** 一个工作项在流程上的运行状态。由 FlowEngine 原地修改，可以直接 JSON 序列化存库。 */
export interface WorkItemState {
  status: WorkItemStatus;
  stage: string | null;
  nodes: Record<string, NodeRuntime>;
  /** 节点键 → 工作项上加的依赖。引擎只读不改。 */
  dependencies?: Record<string, InstanceDependency[]>;
}

export type FlowEvent =
  | { type: "nodeStarted"; node: string }
  | { type: "nodeCompleted"; node: string; by: string | null }
  | { type: "nodeSkipped"; node: string }
  | { type: "nodeRestored"; node: string }
  | { type: "nodeConfirmed"; node: string; by: string }
  | { type: "nodeRolledBack"; node: string; by: string }
  | { type: "stageChanged"; node: string | null; from: string | null; to: string }
  /** 节点事件要求改字段值；调用方负责写进字段，再按新值重算。 */
  | { type: "fieldAssigned"; node: string; field: string; value: unknown }
  | { type: "workItemCompleted" }
  | { type: "workItemReopened" };

export interface Actor {
  userId: string;
  isSuperAdmin?: boolean;
}

export class FlowError extends Error {
  override name = "FlowError";
}
