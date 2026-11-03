import { type Condition, evaluate, type Fields } from "../flow/condition.ts";

/**
 * 自动化规则：某个事件发生在符合条件的工作项上时，自动执行一串动作。
 * 规则存成 JSON；匹配逻辑放在引擎里，前端预览和 worker 执行用同一份。
 */

/** 触发器：事件类型，加上可选的工作项类型、节点、字段过滤。 */
export type AutomationTrigger =
  | { kind: "workItemCreated"; typeId?: string }
  | { kind: "nodeStarted" | "nodeCompleted"; typeId?: string; node?: string }
  | { kind: "fieldChanged"; typeId?: string; field: string };

/** 动作：都作用在触发事件所在的工作项上。 */
export type AutomationAction =
  | {
      type: "setField";
      field: string;
      value: string | number | boolean | string[] | { start: string; end: string } | null;
    }
  | { type: "setRole"; role: string; userIds: string[] }
  | { type: "confirmNode"; node: string };

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

export const TRIGGER_KINDS = ["workItemCreated", "nodeStarted", "nodeCompleted", "fieldChanged"] as const;

function payloadValue(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
}

/** 事件是否命中触发器。typeId 是事件所在工作项的类型。 */
export function triggerMatches(trigger: AutomationTrigger, event: TriggerEvent, typeId: string): boolean {
  if (trigger.kind !== event.kind) return false;
  if (trigger.typeId && trigger.typeId !== typeId) return false;
  switch (trigger.kind) {
    case "workItemCreated":
      return true;
    case "nodeStarted":
    case "nodeCompleted":
      return !trigger.node || payloadValue(event.payload, "node") === trigger.node;
    case "fieldChanged":
      return payloadValue(event.payload, "fieldKey") === trigger.field;
  }
}

/** 触发器命中后再看条件。 */
export function ruleApplies(rule: AutomationRuleDefinition, event: TriggerEvent, typeId: string, fields: Fields) {
  return triggerMatches(rule.trigger, event, typeId) && (!rule.condition || evaluate(rule.condition, fields));
}
