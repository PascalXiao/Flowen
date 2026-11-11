import { describe, expect, it } from "vitest";
import {
  baselineSlip,
  criticalPath,
  dayFromIso,
  dayToIso,
  type FlowDefinition,
  FlowGraph,
  type NodeState,
  type ScheduleNodeInput,
  schedule,
  validateFlow,
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

describe("dependencies and schedule rules", () => {
  // a(2) → b(1) → end(0)，c(3) 从 start 并行出来，也连到 end
  function withLinks(extra: (g: FlowDefinition) => void) {
    const definition: FlowDefinition = {
      key: "t",
      version: 1,
      nodes: [
        { key: "start", name: "start", completion: "auto", ownerRoles: [], duration: 0 },
        { key: "a", name: "a", completion: "singleConfirm", ownerRoles: [], duration: 2 },
        { key: "b", name: "b", completion: "singleConfirm", ownerRoles: [], duration: 1 },
        { key: "c", name: "c", completion: "singleConfirm", ownerRoles: [], duration: 3 },
        { key: "end", name: "end", completion: "auto", ownerRoles: [], duration: 0 },
      ],
      edges: [
        { from: "start", to: "a" },
        { from: "a", to: "b" },
        { from: "start", to: "c" },
        { from: "b", to: "end" },
        { from: "c", to: "end" },
      ],
    };
    extra(definition);
    return new FlowGraph(definition);
  }
  const node = (g: FlowDefinition, key: string) =>
    g.nodes.find((n) => n.key === key) as FlowDefinition["nodes"][number];
  const iso = (span: { start: number; end: number } | null | undefined) =>
    span ? `${dayToIso(span.start)}..${dayToIso(span.end)}` : null;
  const all = fresh("start", "a", "b", "c", "end");

  it("start-after-finish waits for the dependency, with a lag in workdays", () => {
    // c 要等 a 完成后再过 1 个工作日开始：a 10-21..22 → c 10-26 开始（跨周末）
    const graph = withLinks((g) => {
      node(g, "c").scheduleRules = [{ node: "a", edge: "end", offset: 1 }];
    });
    const spans = schedule(graph, calendar, { start: d("2026-10-21"), nodes: all });
    expect(iso(spans.c)).toBe("2026-10-26..2026-10-28");
    const r = plan(graph, all);
    expect(r.critical.has("a")).toBe(true);
    expect(r.critical.has("c")).toBe(true);
    expect(r.float.b).toBe(3);
  });

  it("start-after-start overlaps with the other node", () => {
    const graph = withLinks((g) => {
      node(g, "c").scheduleRules = [{ node: "a", edge: "start", offset: 1 }];
    });
    const spans = schedule(graph, calendar, { start: d("2026-10-21"), nodes: all });
    expect(iso(spans.c)).toBe("2026-10-22..2026-10-26");
  });

  it("finish-after-finish pushes the node so it ends no earlier than the dependency", () => {
    // b 要等 c 完成才能完成：c 10-21..23，b 本来 10-23 结束 → 推到 10-23 不变；把 c 拉长到 5 天看推迟
    const graph = withLinks((g) => {
      node(g, "c").duration = 5;
      node(g, "b").dependsOn = [{ node: "c", allow: "complete" }];
    });
    const spans = schedule(graph, calendar, { start: d("2026-10-21"), nodes: all });
    expect(iso(spans.c)).toBe("2026-10-21..2026-10-27");
    expect(iso(spans.b)).toBe("2026-10-27..2026-10-27");
  });

  it("a dependency added on the work item schedules like one from the template", () => {
    // 工作项上加：c 要等 a 完成才能开始 → c 排在 a 后面；等别的工作项的不影响排期
    const graph = withLinks(() => {});
    const dependencies = {
      c: [
        { allow: "start" as const, node: "a" },
        { allow: "start" as const, waiting: "新品 B · 采购" },
      ],
    };
    const spans = schedule(graph, calendar, { start: d("2026-10-21"), nodes: all, dependencies });
    expect(iso(spans.c)).toBe("2026-10-23..2026-10-27");
    const states: Record<string, NodeState> = Object.fromEntries(Object.keys(all).map((k) => [k, "notStarted"]));
    const r = criticalPath(graph, calendar, { spans, states, milestones: new Set(["start", "end"]), dependencies });
    expect([...r.critical].sort()).toEqual(["a", "c", "end", "start"]);
    expect(r.float.b).toBe(2);
  });

  it("validation rejects a dependency on a later node and a waiting loop", () => {
    const later = withLinks((g) => {
      node(g, "a").dependsOn = [{ node: "b", allow: "start" }];
    });
    expect(validateFlow(later.definition).errors.join()).toContain("后面的节点「b」");
    const loop = withLinks((g) => {
      node(g, "a").scheduleRules = [{ node: "c", edge: "start", offset: 0 }];
      node(g, "c").scheduleRules = [{ node: "a", edge: "start", offset: 0 }];
    });
    expect(validateFlow(loop.definition).errors.join()).toContain("互相等待");
  });
});
