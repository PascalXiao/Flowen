import { type Condition, evaluate, type Fields } from "../flow/condition.ts";
import { type Day, dayFromIso, dayToIso } from "../schedule/calendar.ts";

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
  "workItemDeleted",
  "commentAdded",
] as const;
/** 可以再限定节点的触发器；事件 payload 里带 node。 */
export const NODE_TRIGGERS = [
  "nodeStarted",
  "nodeCompleted",
  "nodeRolledBack",
  "nodePlanChanged",
  "taskCreated",
  "taskUpdated",
  "taskDone",
  "taskDeleted",
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
  | DateTrigger
  | ManualTrigger;

/** 手动运行：管理员在规则列表里选一个工作项运行，或者在工作项详情里点「运行自动化」。 */
export interface ManualTrigger {
  kind: "manual";
  typeId?: string;
}

/**
 * 定时触发：按空间时区，在选中的日子的整点，对这个类型里所有没终止的工作项各触发一次（再按条件筛）。
 * 每周按星期（0 是周日），每月按几号；每天不用选。
 */
export interface ScheduleTrigger {
  kind: "schedule";
  typeId?: string;
  frequency: "day" | "week" | "month";
  /** 每隔几天、几周、几个月触发一次，从生效日（没填就从 1970-01-01）起算；默认 1。 */
  every?: number;
  weekdays?: number[];
  monthDays?: number[];
  hour: number;
  /** 生效起止日（YYYY-MM-DD，含首尾）；不填表示不限。 */
  startDate?: string;
  endDate?: string;
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
/** 事件里带着规则 id、只触发这一条规则的触发器：按时间触发的，加上手动运行。 */
export const CLAIMED_TRIGGERS = [...TIME_TRIGGERS, "manual"] as const;

/**
 * 通知的收件人：工作项创建人、触发人（做出这次改动的人）、某个角色的成员、某个人员字段里的人、
 * 进行中节点的负责人、某个节点的负责人、指定成员。
 */
export type AutomationRecipient =
  | "creator"
  | "actor"
  | "currentNodeOwners"
  | `role:${string}`
  | `field:${string}`
  | `node:${string}`
  | `user:${string}`;

/**
 * 动作的作用对象：不填是触发的工作项；填了是通过某条关联（两个方向都算）关联着触发工作项的工作项，
 * 可以再按条件筛（条件按关联工作项自己的字段求值）。关联可以是跨空间的，这时动作在另一个空间里执行。
 */
export interface ActionTarget {
  relation: string;
  condition?: Condition | null;
}

/** 一个动作最多作用到这么多个关联工作项上，多出来的不执行。 */
export const MAX_ACTION_TARGETS = 200;

/**
 * 值从哪里来：不填 relation 是触发的工作项，填了是通过这条关联关联着触发工作项的第一个工作项。
 * 用来「同步为」：比如把需求的业务线同步给关联的缺陷，或者把关联版本的上线日期同步回需求。
 */
export interface ValueSource {
  field: string;
  relation?: string | null;
}

/** 新建工作项时给的字段值：固定值，或者从触发的工作项拷一个字段的值。 */
export interface NewItemField {
  field: string;
  value?: FieldValueLiteral;
  from?: string | null;
}

export type FieldValueLiteral = string | number | boolean | string[] | { start: string; end: string } | null;

/** 调用外部接口时附带的请求头。 */
export interface RequestHeader {
  name: string;
  value: string;
}

/** 动作本身；作用对象见 target。 */
export type AutomationActionBody =
  | {
      type: "setField";
      field: string;
      value: FieldValueLiteral;
      /** 设了就不用 value，改成拷这个来源的字段值。 */
      copy?: ValueSource | null;
    }
  | {
      type: "setRole";
      role: string;
      userIds: string[];
      /** 设了就不用 userIds，改成拷这个来源的角色成员（field 是角色 key）。 */
      copy?: ValueSource | null;
    }
  | { type: "confirmNode"; node: string }
  | { type: "transitionStatus"; to: string }
  | { type: "terminate"; reason?: string }
  | { type: "restore" }
  | { type: "addComment"; body: string }
  | { type: "createTask"; node: string; name: string; assigneeId?: string | null }
  /** 新建一个工作项；配了关联就和触发的工作项关联上（方向按关联定义两端的类型定）。 */
  | {
      type: "createWorkItem";
      typeId: string;
      name: string;
      relationDefId?: string | null;
      /** 新工作项的字段值。 */
      fields?: NewItemField[] | null;
    }
  /** 发站内通知（通知中心）。默认不通知触发人自己，除非收件人里显式选了「触发人」。 */
  | { type: "notify"; to: AutomationRecipient[]; text: string }
  /**
   * 调用外部接口：POST 到 url。body 为空时发标准的 JSON（规则、事件、工作项和字段值）；
   * 不为空时按模板渲染后原样发送。请求在规则提交后异步发出，失败按退避重试。
   */
  | { type: "httpRequest"; url: string; headers?: RequestHeader[] | null; body?: string | null };

export type AutomationAction = AutomationActionBody & { target?: ActionTarget | null };

/** 可以作用到关联工作项上的动作。新建工作项和调用外部接口只看触发的工作项。 */
export const TARGETABLE_ACTIONS = [
  "setField",
  "setRole",
  "confirmNode",
  "transitionStatus",
  "terminate",
  "restore",
  "addComment",
  "createTask",
  "notify",
] as const satisfies readonly AutomationAction["type"][];

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
  "manual",
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
  "httpRequest",
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
    case "manual":
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

/** 定时触发器在这个整点是否该触发：在生效期内、隔了该隔的天（周、月）数、是选中的日子和整点。 */
export function scheduleDue(trigger: ScheduleTrigger, slot: LocalSlot): boolean {
  if (slot.hour !== trigger.hour) return false;
  if (trigger.startDate && slot.day < dayFromIso(trigger.startDate)) return false;
  if (trigger.endDate && slot.day > dayFromIso(trigger.endDate)) return false;
  const every = Math.max(1, trigger.every ?? 1);
  const origin = trigger.startDate ? dayFromIso(trigger.startDate) : 0;
  const mod = (n: number) => ((n % every) + every) % every;
  if (trigger.frequency === "week") {
    // 按周一开始的周算隔几周
    const weekOf = (day: Day) => Math.floor((day - mondayOffset(day)) / 7);
    return (trigger.weekdays ?? []).includes(slot.weekday) && mod(weekOf(slot.day) - weekOf(origin)) === 0;
  }
  if (trigger.frequency === "month") {
    const monthOf = (day: Day) => {
      const [y, m] = dayToIso(day).split("-").map(Number) as [number, number];
      return y * 12 + m;
    };
    return (trigger.monthDays ?? []).includes(slot.monthDay) && mod(monthOf(slot.day) - monthOf(origin)) === 0;
  }
  return mod(slot.day - origin) === 0;
}

/** 这一天离本周一几天（1970-01-01 是星期四）。 */
const mondayOffset = (day: Day) => (((day + 3) % 7) + 7) % 7;

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

/**
 * 动作里的文本可以引用工作项：{{name}} 是名称，{{id}} 是 id，{{status}} 是状态，{{field:字段 key}} 是字段值。
 * 多值字段用逗号连起来，对象（日期区间等）按 JSON 写出。
 */
export function renderTemplate(
  text: string,
  item: { name: string; id?: string; status?: string },
  fields: Fields = {},
): string {
  return text.replace(/\{\{\s*(name|id|status|field:([^}\s]+))\s*\}\}/g, (_, key: string, fieldKey?: string) => {
    if (fieldKey) return templateValue(fields[fieldKey]);
    if (key === "name") return item.name;
    if (key === "id") return item.id ?? "";
    return item.status ?? "";
  });
}

function templateValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(templateValue).join(",");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** 收件人解析成用户 id。roles 是角色 → 成员，fields 用来取人员字段里的人。 */
export function resolveRecipients(
  to: readonly AutomationRecipient[],
  context: {
    createdBy: string;
    actor: string | null;
    roles: Record<string, readonly string[]>;
    fields: Fields;
    /** 节点 key → 负责人和状态；按节点通知时用。 */
    nodes?: Record<string, { owners: readonly string[]; state: string }>;
  },
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
    else if (r.startsWith("node:")) add(context.nodes?.[r.slice(5)]?.owners);
    else if (r === "currentNodeOwners") {
      for (const n of Object.values(context.nodes ?? {})) if (n.state === "inProgress") add(n.owners);
    }
    else if (r.startsWith("user:")) add(r.slice(5));
  }
  // 没有显式选触发人时，不通知做出这次改动的人自己
  if (context.actor && !to.includes("actor")) ids.delete(context.actor);
  return [...ids];
}
