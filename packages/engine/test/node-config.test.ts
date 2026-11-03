import { describe, expect, it } from "vitest";
import { cond, type FlowDefinition, FlowEngine, type NodeDefinition, schedule, WorkCalendar } from "../src/index.ts";

const node = (key: string, extra: Partial<NodeDefinition> = {}): NodeDefinition => ({
  key,
  name: key,
  completion: "singleConfirm",
  ownerRoles: ["owner"],
  ...extra,
});
const chain = (...nodes: NodeDefinition[]): FlowDefinition => ({
  key: "t",
  version: 1,
  nodes,
  edges: nodes.slice(1).map((n, i) => ({ from: nodes[i]?.key ?? "", to: n.key })),
});
const owners = (f: FlowDefinition, ...users: string[]) => Object.fromEntries(f.nodes.map((n) => [n.key, users]));

const review = {
  options: [
    { value: "pass", label: "已通过", passed: true },
    { value: "conditional", label: "有条件通过", passed: true },
    { value: "fail", label: "未通过", passed: false },
  ],
};

describe("node configuration", () => {
  it("records a required conclusion and comment when confirming", () => {
    const f = chain(node("评审", { conclusion: { ...review, required: true, commentRequired: true } }), node("开发"));
    const engine = new FlowEngine(f);
    const { state } = engine.start({}, owners(f, "u1"));
    expect(() => engine.confirm(state, "评审", { userId: "u1" }, {})).toThrow("要选完成结论");
    expect(() => engine.confirm(state, "评审", { userId: "u1" }, {}, 0, { conclusion: "pass" })).toThrow("完成意见");
    engine.confirm(state, "评审", { userId: "u1" }, {}, 0, { conclusion: "pass", comment: "OK" });
    expect(state.nodes.评审).toMatchObject({ state: "completed", conclusion: "pass", comment: "OK" });
    // 回滚后结论清空
    engine.rollback(state, "评审", { userId: "u1" }, {});
    expect(state.nodes.评审?.conclusion).toBeNull();
  });

  it("aggregates per-owner verdicts with veto", () => {
    const f = chain(
      node("评审", { completion: "allConfirm", conclusion: { ...review, perOwner: true, aggregate: "veto" } }),
    );
    const engine = new FlowEngine(f);
    const { state } = engine.start({}, owners(f, "u1", "u2", "u3"));
    engine.confirm(state, "评审", { userId: "u1" }, {}, 0, { conclusion: "pass" });
    engine.confirm(state, "评审", { userId: "u2" }, {}, 0, { conclusion: "pass" });
    engine.confirm(state, "评审", { userId: "u3" }, {}, 0, { conclusion: "fail" });
    expect(state.nodes.评审?.conclusion).toBe("fail");
  });

  it("blocks restricted nodes and required node fields", () => {
    const f = chain(
      node("锁定", { restricted: true }),
      node("打样", { fields: [{ key: "batch", name: "批次", dataType: "text", required: true }] }),
    );
    const engine = new FlowEngine(f);
    const { state } = engine.start({}, owners(f, "u1"));
    expect(() => engine.confirm(state, "锁定", { userId: "u1" }, {})).toThrow("限制节点");
    engine.confirm(state, "锁定", { userId: "admin", isSuperAdmin: true }, {});
    expect(() => engine.confirm(state, "打样", { userId: "u1" }, {})).toThrow("批次");
    engine.confirm(state, "打样", { userId: "u1" }, {}, 0, { nodeFields: { batch: "B-01" } });
    expect(state.nodes.打样).toMatchObject({ state: "completed", fields: { batch: "B-01" } });
  });

  it("runs arrive and complete events, and status rules win over them", () => {
    const f: FlowDefinition = {
      ...chain(
        node("立项", { onComplete: [{ kind: "setField", field: "locked", value: true }] }),
        node("开发", {
          onArrive: [{ kind: "setStage", stage: "开发中" }],
          onComplete: [{ kind: "setStage", stage: "已上线", onlyFrom: ["测试中"] }],
        }),
      ),
    };
    const engine = new FlowEngine(f);
    const { state } = engine.start({}, owners(f, "u1"));
    const events = engine.confirm(state, "立项", { userId: "u1" }, {});
    expect(events).toContainEqual({ type: "fieldAssigned", node: "立项", field: "locked", value: true });
    expect(state.stage).toBe("开发中");
    engine.confirm(state, "开发", { userId: "u1" }, {});
    // onlyFrom 不满足，不改
    expect(state.stage).toBe("开发中");

    const ruled: FlowDefinition = {
      ...f,
      stageRules: [{ when: cond.equal("$node.开发", "completed"), stage: "已完成" }],
    };
    const e2 = new FlowEngine(ruled);
    const s2 = e2.start({}, owners(ruled, "u1")).state;
    e2.confirm(s2, "立项", { userId: "u1" }, {});
    e2.confirm(s2, "开发", { userId: "u1" }, {});
    expect(s2.stage).toBe("已完成");
  });

  it("gates on another node's conclusion", () => {
    const f = chain(
      node("评审", { conclusion: review }),
      node("上市", { gate: cond.equal("$conclusion.评审", "pass") }),
    );
    const engine = new FlowEngine(f);
    const { state } = engine.start({}, owners(f, "u1"));
    engine.confirm(state, "评审", { userId: "u1" }, {}, 0, { conclusion: "fail" });
    expect(() => engine.confirm(state, "上市", { userId: "u1" }, {})).toThrow("流转条件");
  });

  it("upgrades to a new version keeping progress", () => {
    const v1 = chain(node("a"), node("b"));
    const e1 = new FlowEngine(v1);
    const { state } = e1.start({}, owners(v1, "u1"));
    e1.confirm(state, "a", { userId: "u1" }, {});
    const v2: FlowDefinition = {
      key: "t",
      version: 2,
      nodes: [node("a"), node("x"), node("b")],
      edges: [
        { from: "a", to: "x" },
        { from: "x", to: "b" },
      ],
    };
    const { state: next } = new FlowEngine(v2).upgrade(state, {}, owners(v2, "u2"));
    expect(next.nodes.a?.state).toBe("completed");
    expect(next.nodes.x).toMatchObject({ state: "inProgress", owners: ["u2"] });
    // b 保留原来的进行中状态（旧版本里已经到达）
    expect(next.nodes.b?.state).toBe("inProgress");
  });

  it("schedules relative to an anchor date and treats milestones as zero days", () => {
    const f = chain(node("打样", { duration: 3 }), node("上市", { milestone: true, duration: 5 }));
    const engine = new FlowEngine(f);
    const { state } = engine.start({}, owners(f, "u1"));
    const calendar = new WorkCalendar();
    // 1970-01-05 是周一
    const plan = schedule(engine.graph, calendar, {
      start: 4,
      nodes: {
        打样: { state: "inProgress", anchorEnd: 11 },
        上市: { state: "notStarted" },
      },
    });
    expect(plan.打样).toEqual({ start: 7, end: 11 });
    expect(plan.上市?.start).toBe(plan.上市?.end);
  });
});
