import { describe, expect, it } from "vitest";
import {
  type AutomationRuleDefinition,
  cond,
  renderTemplate,
  resolveRecipients,
  ruleApplies,
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
