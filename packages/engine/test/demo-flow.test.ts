import { beforeEach, describe, expect, it } from "vitest";
import { FlowEngine, FlowGraph, validateFlow, type WorkItemState } from "../src/index.ts";
import { demoFlow, F, ownersByRole } from "../src/samples/demo-flow.ts";

/** 设计文档「示例空间用例清单」里只涉及流程引擎的那几条。 */
describe("示例流程", () => {
  const engine = new FlowEngine(demoFlow);
  const admin = { userId: "admin", isSuperAdmin: true };
  let fields: Record<string, unknown>;

  beforeEach(() => {
    fields = {
      [F.needPhaseOut]: "是",
      [F.needLaunchPlan]: "是",
      [F.needResearch]: "否",
      [F.needVideo]: "是",
      [F.needCert]: "是",
      [F.linkedModel]: "SKU-001",
    };
  });

  const start = () => engine.start(fields, ownersByRole).state;
  const at = (state: WorkItemState, key: string) => state.nodes[key]?.state;

  /** 把指定的进行中节点按它们自己的完成方式推过去。 */
  function pass(state: WorkItemState, ...keys: string[]) {
    for (const key of keys) {
      const node = engine.graph.node(key);
      const runtime = state.nodes[key];
      expect(runtime?.state, `${node.name} 应为进行中`).toBe("inProgress");
      if (!runtime) return;
      if (node.completion === "subItemDriven") engine.completeBySubItem(state, key, fields);
      else if (node.completion === "auto") engine.confirm(state, key, admin, fields);
      else if (node.completion === "allConfirm")
        for (const owner of runtime.owners) engine.confirm(state, key, { userId: owner }, fields);
      else engine.confirm(state, key, { userId: runtime.owners[0] as string }, fields);
    }
  }

  const throughProjectReview = [
    "doing",
    "state_51",
    "end",
    "state_1",
    "state_53",
    "state_54",
    "state_55",
    "state_56",
    "state_0",
    "state_2",
  ];

  it("imports 48 nodes, 52 edges, 17 leaves and passes validation", () => {
    expect(demoFlow.nodes).toHaveLength(48);
    expect(demoFlow.edges).toHaveLength(52);
    expect(new FlowGraph(demoFlow).leaves).toHaveLength(17);
    expect(validateFlow(demoFlow).errors).toEqual([]);
  });

  it("flags the stage regression on 物料成本初步核算", () => {
    expect(validateFlow(demoFlow).warnings).toContainEqual(expect.stringContaining("物料成本初步核算"));
  });

  it("auto-completes start and waits on the proposal in the concept stage", () => {
    const state = start();
    expect(at(state, "start")).toBe("completed");
    expect(at(state, "doing")).toBe("inProgress");
    expect(state.stage).toBe("概念阶段");
  });

  it("needs all three signers and a linked SKU on the proposal", () => {
    const state = start();
    engine.confirm(state, "doing", { userId: "NPD" }, fields);
    engine.confirm(state, "doing", { userId: "财务BP负责人" }, fields);
    expect(at(state, "doing")).toBe("inProgress");

    fields[F.linkedModel] = null;
    expect(() => engine.confirm(state, "doing", { userId: "开发" }, fields)).toThrow("流转条件");

    fields[F.linkedModel] = "SKU-001";
    engine.confirm(state, "doing", { userId: "开发" }, fields);
    expect(at(state, "doing")).toBe("completed");
  });

  it("skips the phase-out branch and lets project review wait only on scheduling", () => {
    fields[F.needPhaseOut] = "否";
    fields[F.needLaunchPlan] = "否";
    const state = start();
    pass(state, "doing", "state_51", "end");

    for (const key of ["state_53", "state_54", "state_55", "state_56", "state_0"])
      expect(at(state, key)).toBe("skipped");
    expect(at(state, "state_2")).toBe("notStarted");

    pass(state, "state_1");
    expect(at(state, "state_2")).toBe("inProgress");
  });

  it("auto-completes 设计冻结 when the field turns Y, and members cannot force it", () => {
    const state = start();
    pass(state, ...throughProjectReview, "state_3", "state_5");

    expect(at(state, "design_freeze")).toBe("inProgress");
    expect(() => engine.confirm(state, "design_freeze", { userId: "NPD" }, fields)).toThrow("超管");

    fields[F.designFrozen] = "Y";
    engine.onFieldsChanged(state, fields);
    expect(at(state, "design_freeze")).toBe("completed");
    for (const key of ["state_7", "state_9", "reliability_test", "performance_test"])
      expect(at(state, key)).toBe("inProgress");
  });

  it("fans out to five nodes after the launch review", () => {
    const state = start();
    // 兼容性测试、产品成本确认、安规送检没有卡点，到达即自动完成
    pass(state, ...throughProjectReview, "state_16", "state_20", "state_23", "state_26");

    for (const key of ["state_27", "state_29", "state_28", "state_30", "state_44"])
      expect(at(state, key)).toBe("inProgress");
    expect(state.stage).toBe("上市阶段");
  });

  it("makes legal review wait for both assets unless the video is turned off", () => {
    const state = start();
    pass(state, ...throughProjectReview, "state_16", "state_20", "state_23", "state_26", "state_30", "state_40");
    expect(at(state, "state_43")).toBe("notStarted");

    fields[F.needVideo] = "否";
    engine.onFieldsChanged(state, fields);
    expect(at(state, "state_42")).toBe("skipped");
    expect(at(state, "state_43")).toBe("inProgress");
  });

  it("completes the project once every visible leaf is done", () => {
    fields[F.designFrozen] = "Y";
    const state = start();

    for (let round = 0; round < 60 && state.status === "inProgress"; round++) {
      const open = Object.entries(state.nodes).find(([, n]) => n.state === "inProgress");
      expect(open, "流程卡住了：没有进行中的节点").toBeDefined();
      if (open) pass(state, open[0]);
    }

    expect(state.status).toBe("completed");
    expect(at(state, "state_25")).toBe("skipped");
  });
});
