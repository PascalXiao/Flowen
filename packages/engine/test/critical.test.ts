import { describe, expect, it } from "vitest";
import {
  baselineSlip,
  criticalPath,
  dayFromIso,
  type FlowDefinition,
  FlowGraph,
  type NodeState,
  type ScheduleNodeInput,
  schedule,
  WorkCalendar,
  workdayDelta,
} from "../src/index.ts";

const d = dayFromIso;
const calendar = new WorkCalendar();

function flow(...specs: [key: string, preds: string[], duration?: number][]): FlowGraph {
  const definition: FlowDefinition = {
    key: "t",
    version: 1,
    nodes: specs.map(([key, , duration]) => ({
      key,
      name: key,
      completion: duration === 0 ? "auto" : "singleConfirm",
      ownerRoles: [],
      ...(duration !== undefined && { duration }),
    })),
    edges: specs.flatMap(([key, preds]) => preds.map((from) => ({ from, to: key }))),
  };
  return new FlowGraph(definition);
}

function plan(graph: FlowGraph, nodes: Record<string, ScheduleNodeInput>, deadline?: number) {
  const spans = schedule(graph, calendar, { start: d("2026-10-21"), nodes });
  const states: Record<string, NodeState> = Object.fromEntries(Object.entries(nodes).map(([k, v]) => [k, v.state]));
  const milestones = new Set(graph.definition.nodes.filter((n) => n.duration === 0).map((n) => n.key));
  return criticalPath(graph, calendar, { spans, states, milestones, deadline });
}

const fresh = (...keys: string[]): Record<string, ScheduleNodeInput> =>
  Object.fromEntries(keys.map((k) => [k, { state: "notStarted" }]));

describe("critical path", () => {
  // start(0) → a(2) ┐
  //          → b(4) ┴→ c(1) → end(0)
  const graph = flow(
    ["start", [], 0],
    ["a", ["start"], 2],
    ["b", ["start"], 4],
    ["c", ["a", "b"], 1],
    ["end", ["c"], 0],
  );

  it("finds the longest chain and how long the short branch can slip", () => {
    const r = plan(graph, fresh("start", "a", "b", "c", "end"));
    expect([...r.critical].sort()).toEqual(["b", "c", "end", "start"]);
    expect(r.float.a).toBe(2);
    expect(r.float.b).toBe(0);
  });

  it("a pinned late node moves the critical path onto its branch", () => {
    const r = plan(graph, {
      ...fresh("start", "b", "c", "end"),
      a: { state: "notStarted", pinned: { start: d("2026-10-26"), end: d("2026-10-30") } },
    });
    expect(r.critical.has("a")).toBe(true);
    expect(r.critical.has("b")).toBe(false);
    expect(r.float.b).toBe(4);
  });

  it("completed and skipped nodes are never critical", () => {
    const r = plan(graph, {
      ...fresh("a", "c", "end"),
      start: { state: "completed", actualEnd: d("2026-10-21") },
      b: { state: "skipped" },
    });
    expect(r.float.start).toBeNull();
    expect(r.float.b).toBeNull();
    expect(r.critical.has("a")).toBe(true);
  });

  it("measures against a deadline: negative float means it already misses it", () => {
    // 计划 10-27 结束；上市日 10-26 → 关键链上都差 1 天
    const late = plan(graph, fresh("start", "a", "b", "c", "end"), d("2026-10-26"));
    expect(late.float.c).toBe(-1);
    expect(late.float.a).toBe(1);
    // 上市日 10-30 → 关键链上有 3 个工作日余量，没有节点压线
    const roomy = plan(graph, fresh("start", "a", "b", "c", "end"), d("2026-10-30"));
    expect(roomy.critical.size).toBe(0);
    expect(roomy.float.c).toBe(3);
  });
});

describe("baseline", () => {
  it("counts the slip in workdays across weekends", () => {
    // 周五 → 下周二：晚 2 个工作日
    expect(workdayDelta(calendar, d("2026-10-23"), d("2026-10-27"))).toBe(2);
    expect(baselineSlip(calendar, { start: 0, end: d("2026-10-22") }, { start: 0, end: d("2026-10-27") })).toBe(-3);
    expect(baselineSlip(calendar, null, { start: 0, end: 0 })).toBeNull();
  });
});
