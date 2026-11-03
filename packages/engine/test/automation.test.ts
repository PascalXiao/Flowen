import { describe, expect, it } from "vitest";
import {
  type AutomationRuleDefinition,
  cond,
  dateTriggerTarget,
  dayFromIso,
  dayOfDateValue,
  localSlot,
  pickActions,
  renderTemplate,
  resolveRecipients,
  ruleApplies,
  scheduleDue,
  triggerMatches,
} from "../src/index.ts";

describe("automation triggers", () => {
  it("matches the event kind and the optional type and node filters", () => {
    const started = { kind: "nodeStarted", payload: { node: "review" } };
    expect(triggerMatches({ kind: "nodeStarted" }, started, "t1")).toBe(true);
    expect(triggerMatches({ kind: "nodeStarted", node: "review" }, started, "t1")).toBe(true);
    expect(triggerMatches({ kind: "nodeStarted", node: "other" }, started, "t1")).toBe(false);
    expect(triggerMatches({ kind: "nodeStarted", typeId: "t2" }, started, "t1")).toBe(false);
    expect(triggerMatches({ kind: "nodeCompleted" }, started, "t1")).toBe(false);
  });

  it("matches field changes by field key", () => {
    const changed = { kind: "fieldChanged", payload: { fieldKey: "sku", from: null, to: "A" } };
    expect(triggerMatches({ kind: "fieldChanged", field: "sku" }, changed, "t1")).toBe(true);
    expect(triggerMatches({ kind: "fieldChanged", field: "price" }, changed, "t1")).toBe(false);
  });

  it("checks the condition against the work item's fields", () => {
    const rule: AutomationRuleDefinition = {
      trigger: { kind: "workItemCreated" },
      condition: cond.equal("priority", "P0"),
      actions: [],
    };
    const created = { kind: "workItemCreated", payload: {} };
    expect(ruleApplies(rule, created, "t1", { priority: "P0" })).toBe(true);
    expect(ruleApplies(rule, created, "t1", { priority: "P1" })).toBe(false);
    expect(ruleApplies({ ...rule, condition: null }, created, "t1", {})).toBe(true);
  });
});

describe("more automation triggers", () => {
  it("filters status changes by from and to", () => {
    const event = { kind: "statusChanged", payload: { from: "open", to: "fixed", by: "u1" } };
    expect(triggerMatches({ kind: "statusChanged" }, event, "t1")).toBe(true);
    expect(triggerMatches({ kind: "statusChanged", to: "fixed" }, event, "t1")).toBe(true);
    expect(triggerMatches({ kind: "statusChanged", from: "open", to: "fixed" }, event, "t1")).toBe(true);
    expect(triggerMatches({ kind: "statusChanged", from: "fixed" }, event, "t1")).toBe(false);
  });

  it("filters role, relation and node-scoped events", () => {
    const role = { kind: "roleChanged", payload: { roleKey: "pm", from: [], to: ["u1"] } };
    expect(triggerMatches({ kind: "roleChanged" }, role, "t1")).toBe(true);
    expect(triggerMatches({ kind: "roleChanged", role: "qa" }, role, "t1")).toBe(false);
    const rel = { kind: "relationAdded", payload: { relationDefId: "d1", toId: "x" } };
    expect(triggerMatches({ kind: "relationAdded", relation: "d1" }, rel, "t1")).toBe(true);
    expect(triggerMatches({ kind: "relationRemoved", relation: "d1" }, rel, "t1")).toBe(false);
    const task = { kind: "taskDone", payload: { taskId: "k", node: "dev", name: "x" } };
    expect(triggerMatches({ kind: "taskDone", node: "dev" }, task, "t1")).toBe(true);
    expect(triggerMatches({ kind: "taskDone", node: "qa" }, task, "t1")).toBe(false);
    expect(triggerMatches({ kind: "commentAdded" }, { kind: "commentAdded", payload: {} }, "t1")).toBe(true);
  });
});

describe("notify recipients", () => {
  const context = {
    createdBy: "c",
    actor: "a",
    roles: { pm: ["p1", "a"], qa: [] },
    fields: { owner: "f1", watchers: ["f2", "c"] },
  };
  it("resolves creator, roles, person fields and named users without the actor", () => {
    expect(resolveRecipients(["creator", "role:pm", "field:watchers", "user:u9"], context).sort()).toEqual(
      ["c", "f2", "p1", "u9"].sort(),
    );
  });
  it("includes the actor only when picked explicitly", () => {
    expect(resolveRecipients(["actor", "role:pm"], context).sort()).toEqual(["a", "p1"]);
  });
  it("renders the work item name into text", () => {
    expect(renderTemplate("「{{name}}」要验收了", { name: "新品 A" })).toBe("「新品 A」要验收了");
  });
});

describe("time triggers", () => {
  // 2026-11-03 是星期二；上海 09:00 是 UTC 01:00
  const at = Date.parse("2026-11-03T01:00:00Z");
  const slot = localSlot(at, "Asia/Shanghai");

  it("reads the local day, weekday and hour", () => {
    expect(slot).toEqual({ day: dayFromIso("2026-11-03"), weekday: 2, monthDay: 3, hour: 9 });
    expect(localSlot(Date.parse("2026-11-02T23:00:00Z"), "Asia/Shanghai").hour).toBe(7);
  });

  it("fires schedules on the chosen hour and days", () => {
    expect(scheduleDue({ kind: "schedule", frequency: "day", hour: 9 }, slot)).toBe(true);
    expect(scheduleDue({ kind: "schedule", frequency: "day", hour: 10 }, slot)).toBe(false);
    expect(scheduleDue({ kind: "schedule", frequency: "week", weekdays: [1, 2], hour: 9 }, slot)).toBe(true);
    expect(scheduleDue({ kind: "schedule", frequency: "week", weekdays: [5], hour: 9 }, slot)).toBe(false);
    expect(scheduleDue({ kind: "schedule", frequency: "month", monthDays: [3], hour: 9 }, slot)).toBe(true);
  });

  it("targets due-soon, due and overdue dates", () => {
    const base = { kind: "dateReached", date: "due", hour: 9 } as const;
    expect(dateTriggerTarget({ ...base, when: "before", days: 2 }, slot)).toBe(dayFromIso("2026-11-05"));
    expect(dateTriggerTarget({ ...base, when: "on", days: 0 }, slot)).toBe(dayFromIso("2026-11-03"));
    expect(dateTriggerTarget({ ...base, when: "after", days: 1 }, slot)).toBe(dayFromIso("2026-11-02"));
    expect(dateTriggerTarget({ ...base, when: "on", days: 0, hour: 8 }, slot)).toBeNull();
    expect(dayOfDateValue("2026-11-05")).toBe(dayFromIso("2026-11-05"));
    expect(dayOfDateValue("2026-11-05 18:30")).toBe(dayFromIso("2026-11-05"));
    expect(dayOfDateValue({ start: "2026-11-01", end: "2026-11-05" })).toBe(dayFromIso("2026-11-05"));
    expect(dayOfDateValue(null)).toBeNull();
  });

  it("only claims clock events addressed to the rule", () => {
    const event = { kind: "schedule", payload: { ruleId: "r1", slot: at } };
    const trigger = { kind: "schedule", frequency: "day", hour: 9 } as const;
    expect(triggerMatches(trigger, event, "t1", "r1")).toBe(true);
    expect(triggerMatches(trigger, event, "t1", "r2")).toBe(false);
    expect(triggerMatches(trigger, event, "t1")).toBe(false);
  });
});

describe("branches", () => {
  const rule: AutomationRuleDefinition = {
    trigger: { kind: "workItemCreated" },
    condition: cond.equal("priority", "P0"),
    actions: [{ type: "restore" }],
    branches: [
      { condition: cond.equal("priority", "P1"), actions: [{ type: "addComment", body: "P1" }] },
      { condition: null, actions: [{ type: "addComment", body: "其他" }] },
    ],
  };
  it("runs the main actions, else the first matching branch", () => {
    expect(pickActions(rule, { priority: "P0" })).toEqual([{ type: "restore" }]);
    expect(pickActions(rule, { priority: "P1" })).toEqual([{ type: "addComment", body: "P1" }]);
    expect(pickActions(rule, { priority: "P2" })).toEqual([{ type: "addComment", body: "其他" }]);
    expect(pickActions({ ...rule, branches: [] }, { priority: "P2" })).toBeNull();
  });
});
