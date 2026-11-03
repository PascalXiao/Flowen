import { type Condition, evaluate, type Fields } from "../flow/condition.ts";
import { type Day, dayFromIso } from "../schedule/calendar.ts";

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
  | { kind: "relationAdded" | "relationRemoved"; typeId?: string; relation?: string }
  | ScheduleTrigger
  | DateTrigger;

/**
 * 定时触发：按空间时区，在选中的日子的整点，对这个类型里所有没终止的工作项各触发一次（再按条件筛）。
 * 每周按星期（0 是周日），每月按几号；每天不用选。
 */
export interface ScheduleTrigger {
  kind: "schedule";
  typeId?: string;
  frequency: "day" | "week" | "month";
  weekdays?: number[];
  monthDays?: number[];
  hour: number;
}

/**
 * 动态时间触发：日期字段（或某个节点的计划完成日）临近、到期、超期时，在那天的整点触发一次。
 * date 是日期字段的 key，或 `node:节点 key` 表示节点排期的结束日；days 是提前或超过的天数。
 * 已完成、已终止的工作项（节点排期：已完成的节点）不再触发。
 */
export interface DateTrigger {
  kind: "dateReached";
  typeId?: string;
  date: string;
  when: "before" | "on" | "after";
  days: number;
  hour: number;
}

/** 按时间触发、由时钟产生事件的触发器；事件里带着规则 id，只触发这一条规则。 */
export const TIME_TRIGGERS = ["schedule", "dateReached"] as const;

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

/** 条件分支：主条件不满足时，按顺序找第一个条件满足的分支执行（条件为空的分支相当于「否则」）。 */
export interface AutomationBranch {
  condition?: Condition | null;
  actions: AutomationAction[];
}

export interface AutomationRuleDefinition {
  /** 规则 id；按时间触发的规则靠它认领自己的事件。 */
  id?: string;
  trigger: AutomationTrigger;
  /** 为空表示不加条件。按触发后工作项的字段值求值。 */
  condition?: Condition | null;
  actions: AutomationAction[];
  branches?: AutomationBranch[] | null;
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
  ...TIME_TRIGGERS,
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

/** 事件是否命中触发器。typeId 是事件所在工作项的类型；ruleId 用来认领按时间触发的事件。 */
export function triggerMatches(
  trigger: AutomationTrigger,
  event: TriggerEvent,
  typeId: string,
  ruleId?: string,
): boolean {
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
    case "schedule":
    case "dateReached":
      return ruleId !== undefined && payloadValue(event.payload, "ruleId") === ruleId;
    default:
      return isNodeTrigger(trigger.kind) ? is("node", (trigger as { node?: string }).node) : true;
  }
}

/** 按条件选出要执行的动作：主条件满足用主动作，否则用第一个条件满足的分支；都不满足返回 null。 */
export function pickActions(rule: AutomationRuleDefinition, fields: Fields): AutomationAction[] | null {
  if (!rule.condition || evaluate(rule.condition, fields)) return rule.actions;
  return (rule.branches ?? []).find((b) => !b.condition || evaluate(b.condition, fields))?.actions ?? null;
}

/** 触发器命中后再看条件（含分支）。 */
export function ruleApplies(rule: AutomationRuleDefinition, event: TriggerEvent, typeId: string, fields: Fields) {
  return triggerMatches(rule.trigger, event, typeId, rule.id) && pickActions(rule, fields) !== null;
}

/** 一个整点在某个时区里的日期、星期、几号和小时。 */
export interface LocalSlot {
  day: Day;
  weekday: number;
  monthDay: number;
  hour: number;
}

export function localSlot(at: number, timeZone: string): LocalSlot {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const day = dayFromIso(`${parts.year}-${parts.month}-${parts.day}`);
  // 1970-01-01 是星期四
  return { day, weekday: (((day + 4) % 7) + 7) % 7, monthDay: Number(parts.day), hour: Number(parts.hour) % 24 };
}

/** 定时触发器在这个整点是否该触发。 */
export function scheduleDue(trigger: ScheduleTrigger, slot: LocalSlot): boolean {
  if (slot.hour !== trigger.hour) return false;
  if (trigger.frequency === "week") return (trigger.weekdays ?? []).includes(slot.weekday);
  if (trigger.frequency === "month") return (trigger.monthDays ?? []).includes(slot.monthDay);
  return true;
}

/** 动态时间触发器在这个整点要找的日期：日期字段等于它的工作项触发；不在触发的小时返回 null。 */
export function dateTriggerTarget(trigger: DateTrigger, slot: LocalSlot): Day | null {
  if (slot.hour !== trigger.hour) return null;
  if (trigger.when === "before") return slot.day + trigger.days;
  if (trigger.when === "after") return slot.day - trigger.days;
  return slot.day;
}

/** 日期类字段值是哪一天：日期、日期+时间取日期，日期区间取结束日。 */
export function dayOfDateValue(value: unknown): Day | null {
  const iso =
    typeof value === "string"
      ? value.slice(0, 10)
      : value && typeof value === "object" && typeof (value as { end?: unknown }).end === "string"
        ? (value as { end: string }).end.slice(0, 10)
        : null;
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return dayFromIso(iso);
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
