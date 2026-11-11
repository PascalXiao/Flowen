import { describe, expect, it } from "vitest";
import {
  type CompletionMode,
  type Condition,
  cond,
  type FlowDefinition,
  FlowEngine,
  type NodeDefinition,
  resolveOwners,
  validateFlow,
} from "../src/index.ts";

const noFields = {};
const u1 = { userId: "u1" };

type Spec = [key: string, preds: string[], mode?: CompletionMode, visible?: Condition];

function flow(...specs: Spec[]): FlowDefinition {
  return {
    key: "t",
    version: 1,
    nodes: specs.map(([key, , mode, visible]) => ({
      key,
      name: key,
      completion: mode ?? "singleConfirm",
      ownerRoles: ["owner"],
      ...(visible && { visibility: visible }),
    })),
    edges: specs.flatMap(([key, preds]) => preds.map((from) => ({ from, to: key }))),
  };
}

const ownersOf = (f: FlowDefinition) => Object.fromEntries(f.nodes.map((n) => [n.key, ["u1"]]));

describe("FlowEngine", () => {
  it("starts the first node", () => {
    const f = flow(["a", []], ["b", ["a"]]);
    const { state, events } = new FlowEngine(f).start(noFields, ownersOf(f));
    expect(state.nodes.a?.state).toBe("inProgress");
    expect(state.nodes.b?.state).toBe("notStarted");
    expect(events).toContainEqual({ type: "nodeStarted", node: "a" });
  });

  it("waits for every predecessor at a join", () => {
    const f = flow(["a", []], ["b", ["a"]], ["c", ["a"]], ["d", ["b", "c"]]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));

    engine.confirm(state, "a", u1, noFields);
    expect(state.nodes.b?.state).toBe("inProgress");
    expect(state.nodes.c?.state).toBe("inProgress");

    engine.confirm(state, "b", u1, noFields);
    expect(state.nodes.d?.state).toBe("notStarted");

    engine.confirm(state, "c", u1, noFields);
    expect(state.nodes.d?.state).toBe("inProgress");
  });

  it("dependencies: wait to start, wait to complete", () => {
    // a 后面并行 b、c；c 要等 b 完成才能开始，b 要等 d 完成才能完成；d 也在 a 后面
    const f = flow(["a", []], ["b", ["a"]], ["c", ["a"]], ["d", ["a"]]);
    (f.nodes[2] as NodeDefinition).dependsOn = [{ node: "b", allow: "start" }];
    (f.nodes[1] as NodeDefinition).dependsOn = [{ node: "d", allow: "complete" }];
    expect(validateFlow(f).errors).toEqual([]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    engine.confirm(state, "a", u1, noFields);
    expect(state.nodes.b?.state).toBe("inProgress");
    expect(state.nodes.c?.state).toBe("notStarted");
    expect(() => engine.confirm(state, "b", u1, noFields)).toThrow("要等「d」完成才能完成");
    engine.confirm(state, "d", u1, noFields);
    engine.confirm(state, "b", u1, noFields);
    expect(state.nodes.c?.state).toBe("inProgress");
  });

  it("dependencies added on a work item: another node of the item, or a node somewhere else", () => {
    // a 后面并行 b、c；工作项上加：c 要等 b 完成才能开始，b 要等别的工作项里的节点才能完成
    const f = flow(["a", []], ["b", ["a"]], ["c", ["a"]]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    state.dependencies = {
      c: [{ allow: "start", node: "b" }],
      b: [{ allow: "complete", waiting: "新品 B · 采购" }],
    };
    engine.confirm(state, "a", u1, noFields);
    expect(state.nodes.b?.state).toBe("inProgress");
    expect(state.nodes.c?.state).toBe("notStarted");
    expect(() => engine.confirm(state, "b", u1, noFields)).toThrow("要等「新品 B · 采购」完成才能完成");
    // 对方完成后这条依赖不再传进来；重算时 c 仍然要等 b
    state.dependencies = { c: [{ allow: "start", node: "b" }] };
    engine.onFieldsChanged(state, noFields);
    expect(state.nodes.c?.state).toBe("notStarted");
    engine.confirm(state, "b", u1, noFields);
    expect(state.nodes.c?.state).toBe("inProgress");
  });

  it("a node released by a dependency elsewhere starts on the next recompute", () => {
    const f = flow(["a", []], ["b", ["a"]]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    state.dependencies = { b: [{ allow: "start", waiting: "新品 B · 采购" }] };
    engine.confirm(state, "a", u1, noFields);
    expect(state.nodes.b?.state).toBe("notStarted");
    state.dependencies = {};
    engine.onFieldsChanged(state, noFields);
    expect(state.nodes.b?.state).toBe("inProgress");
  });

  it("does not let a skipped node in a chain start its successor early", () => {
    const f = flow(["a", []], ["b", ["a"], "singleConfirm", cond.equal("x", "是")], ["c", ["b"]]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    expect(state.nodes.b?.state).toBe("skipped");
    expect(state.nodes.c?.state).toBe("notStarted");

    engine.confirm(state, "a", u1, noFields);
    expect(state.nodes.c?.state).toBe("inProgress");
  });

  it("restores a skipped node when its condition becomes true", () => {
    const f = flow(["a", []], ["b", ["a"], "singleConfirm", cond.equal("x", "是")]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    engine.confirm(state, "a", u1, noFields);
    expect(state.nodes.b?.state).toBe("skipped");

    engine.onFieldsChanged(state, { x: "是" });
    expect(state.nodes.b?.state).toBe("inProgress");
  });

  it("needs every owner for an all-confirm node", () => {
    const f = flow(["a", [], "allConfirm"], ["b", ["a"]]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, { a: ["u1", "u2"], b: ["u1"] });

    engine.confirm(state, "a", u1, noFields);
    expect(state.nodes.a?.state).toBe("inProgress");
    engine.confirm(state, "a", { userId: "u2" }, noFields);
    expect(state.nodes.a?.state).toBe("completed");
  });

  it("rejects a confirm from someone who is not an owner", () => {
    const f = flow(["a", []]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    expect(() => engine.confirm(state, "a", { userId: "someone-else" }, noFields)).toThrow("负责人");
  });

  it("rolls back downstream nodes and reopens the work item", () => {
    const f = flow(["a", []], ["b", ["a"]]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    engine.confirm(state, "a", u1, noFields);
    engine.confirm(state, "b", u1, noFields);
    expect(state.status).toBe("completed");

    engine.rollback(state, "a", u1, noFields);
    expect(state.nodes.a?.state).toBe("inProgress");
    expect(state.nodes.b?.state).toBe("notStarted");
    expect(state.status).toBe("inProgress");
  });

  it("requires the completion form's required fields before a confirm", () => {
    const f = flow(["a", []], ["b", ["a"]]);
    (f.nodes[0] as NodeDefinition).form = [{ field: "x", required: true }, { field: "y" }];
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    expect(() => engine.confirm(state, "a", u1, noFields)).toThrow("必填");
    engine.confirm(state, "a", u1, { x: "1" });
    expect(state.nodes.a?.state).toBe("completed");
  });

  it("holds an auto node until its required form fields are filled", () => {
    const f = flow(["a", []], ["b", ["a"], "auto"], ["c", ["b"]]);
    (f.nodes[1] as NodeDefinition).form = [{ field: "x", required: true }];
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    engine.confirm(state, "a", u1, noFields);
    expect(state.nodes.b?.state).toBe("inProgress");
    engine.onFieldsChanged(state, { x: "1" });
    expect(state.nodes.b?.state).toBe("completed");
  });

  it("blocks a confirm while the node has open tasks, unless a super admin completes an automatic node", () => {
    const f = flow(["a", []], ["b", ["a"], "subItemDriven"]);
    const engine = new FlowEngine(f);
    const { state } = engine.start(noFields, ownersOf(f));
    const admin = { userId: "admin", isSuperAdmin: true };
    expect(() => engine.confirm(state, "a", u1, noFields, 2)).toThrow("2 个子任务");
    expect(() => engine.confirm(state, "a", admin, noFields, 2)).toThrow("2 个子任务");
    engine.confirm(state, "a", u1, noFields);
    engine.confirm(state, "b", admin, noFields, 2);
    expect(state.nodes.b?.state).toBe("completed");
  });
});

describe("validateFlow", () => {
  it("rejects cycles and dangling edges", () => {
    const cyclic = flow(["a", []], ["b", ["a", "c"]], ["c", ["b"]]);
    expect(validateFlow(cyclic).errors).toContainEqual(expect.stringContaining("环"));

    const dangling: FlowDefinition = { ...flow(["a", []]), edges: [{ from: "a", to: "zzz" }] };
    expect(validateFlow(dangling).errors).not.toHaveLength(0);
  });
});

describe("resolveOwners", () => {
  it("expands each node's owner roles into the work item's role members, without duplicates", () => {
    const definition: FlowDefinition = {
      key: "t",
      version: 1,
      nodes: [
        { key: "a", name: "A", completion: "allConfirm", ownerRoles: ["NPD", "开发"] },
        { key: "b", name: "B", completion: "auto", ownerRoles: [] },
      ],
      edges: [{ from: "a", to: "b" }],
    };
    expect(resolveOwners(definition, { NPD: ["u1", "u2"], 开发: ["u2", "u3"] })).toEqual({
      a: ["u1", "u2", "u3"],
      b: [],
    });
  });
});
