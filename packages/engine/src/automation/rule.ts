import { type Condition, evaluate, type Fields } from "../flow/condition.ts";

/**
 * 自动化规则：某个事件发生在符合条件的工作项上时，自动执行一串动作。
 * 规则存成 JSON；匹配逻辑放在引擎里，前端预览和 worker 执行用同一份。
 */

/** 只按事件类型（和工作项类型）匹配的触发器。 */
export const PLAIN_TRIGGERS = [
  "workItemCreated",
  "workItemCompleted",
  "workItemTerminated",
  "workItemRestored",
  "commentAdded",
] as const;
/** 可以再限定节点的触发器；事件 payload 里带 node。 */
export const NODE_TRIGGERS = [
  "nodeStarted",
  "nodeCompleted",
  "nodeRolledBack",
  "nodePlanChanged",
  "taskCreated",
  "taskDone",
] as const;

/** 触发器：事件类型，加上可选的工作项类型、节点、字段、状态、角色、关联过滤。 */
export type AutomationTrigger =
  | { kind: (typeof PLAIN_TRIGGERS)[number]; typeId?: string }
  | { kind: (typeof NODE_TRIGGERS)[number]; typeId?: string; node?: string }
  | { kind: "fieldChanged"; typeId?: string; field: string }
  | { kind: "statusChanged"; typeId?: string; from?: string; to?: string }
  | { kind: "roleChanged"; typeId?: string; role?: string }
  | { kind: "relationAdded" | "relationRemoved"; typeId?: string; relation?: string };

/**
 * 通知的收件人：工作项创建人、触发人（做出这次改动的人）、某个角色的成员、某个人员字段里的人、指定成员。
 */
export type AutomationRecipient = "creator" | "actor" | `role:${string}` | `field:${string}` | `user:${string}`;

/** 动作：都作用在触发事件所在的工作项上。 */
export type AutomationAction =
  | {
      type: "setField";
      field: string;
      value: string | number | boolean | string[] | { start: string; end: string } | null;
    }
  | { type: "setRole"; role: string; userIds: string[] }
  | { type: "confirmNode"; node: string }
  | { type: "transitionStatus"; to: string }
  | { type: "terminate"; reason?: string }
  | { type: "restore" }
  | { type: "addComment"; body: string }
  | { type: "createTask"; node: string; name: string; assigneeId?: string | null }
  /** 新建一个工作项；配了关联就和触发的工作项关联上（方向按关联定义两端的类型定）。 */
  | { type: "createWorkItem"; typeId: string; name: string; relationDefId?: string | null }
  /** 发站内通知（通知中心）。默认不通知触发人自己，除非收件人里显式选了「触发人」。 */
  | { type: "notify"; to: AutomationRecipient[]; text: string };

export interface AutomationRuleDefinition {
  trigger: AutomationTrigger;
  /** 为空表示不加条件。按触发后工作项的字段值求值。 */
  condition?: Condition | null;
  actions: AutomationAction[];
}

/** event_log 里的一条事件，触发器匹配时用到的部分。 */
export interface TriggerEvent {
  kind: string;
  payload: unknown;
}

export const TRIGGER_KINDS = [
  ...PLAIN_TRIGGERS,
  ...NODE_TRIGGERS,
  "fieldChanged",
  "statusChanged",
  "roleChanged",
  "relationAdded",
  "relationRemoved",
] as const satisfies readonly AutomationTrigger["kind"][];

export const ACTION_TYPES = [
  "setField",
  "setRole",
  "confirmNode",
  "transitionStatus",
  "terminate",
  "restore",
  "addComment",
  "createTask",
  "createWorkItem",
  "notify",
] as const satisfies readonly AutomationAction["type"][];

function payloadValue(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
}

const isNodeTrigger = (kind: string): kind is (typeof NODE_TRIGGERS)[number] =>
  (NODE_TRIGGERS as readonly string[]).includes(kind);

/** 事件是否命中触发器。typeId 是事件所在工作项的类型。 */
export function triggerMatches(trigger: AutomationTrigger, event: TriggerEvent, typeId: string): boolean {
  if (trigger.kind !== event.kind) return false;
  if (trigger.typeId && trigger.typeId !== typeId) return false;
  const is = (key: string, expected: string | undefined) => !expected || payloadValue(event.payload, key) === expected;
  switch (trigger.kind) {
    case "fieldChanged":
      return payloadValue(event.payload, "fieldKey") === trigger.field;
    case "statusChanged":
      return is("from", trigger.from) && is("to", trigger.to);
    case "roleChanged":
      return is("roleKey", trigger.role);
    case "relationAdded":
    case "relationRemoved":
      return is("relationDefId", trigger.relation);
    default:
      return isNodeTrigger(trigger.kind) ? is("node", (trigger as { node?: string }).node) : true;
  }
}

/** 触发器命中后再看条件。 */
export function ruleApplies(rule: AutomationRuleDefinition, event: TriggerEvent, typeId: string, fields: Fields) {
  return triggerMatches(rule.trigger, event, typeId) && (!rule.condition || evaluate(rule.condition, fields));
}

/** 动作里的文本可以引用工作项：{{name}} 是工作项名称。 */
export function renderTemplate(text: string, item: { name: string }): string {
  return text.split("{{name}}").join(item.name);
}

/** 收件人解析成用户 id。roles 是角色 → 成员，fields 用来取人员字段里的人。 */
export function resolveRecipients(
  to: readonly AutomationRecipient[],
  context: { createdBy: string; actor: string | null; roles: Record<string, readonly string[]>; fields: Fields },
): string[] {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === "string" && value) ids.add(value);
    else if (Array.isArray(value)) for (const v of value) if (typeof v === "string" && v) ids.add(v);
  };
  for (const r of to) {
    if (r === "creator") add(context.createdBy);
    else if (r === "actor") add(context.actor);
    else if (r.startsWith("role:")) add(context.roles[r.slice(5)]);
    else if (r.startsWith("field:")) add(context.fields[r.slice(6)]);
    else if (r.startsWith("user:")) add(r.slice(5));
  }
  // 没有显式选触发人时，不通知做出这次改动的人自己
  if (context.actor && !to.includes("actor")) ids.delete(context.actor);
  return [...ids];
}
