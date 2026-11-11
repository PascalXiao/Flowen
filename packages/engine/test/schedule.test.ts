import { describe, expect, it } from "vitest";
import {
  dayFromIso,
  dayInTimeZone,
  dayToIso,
  demoSample,
  type FlowDefinition,
  FlowGraph,
  type ScheduleNodeInput,
  schedule,
  WorkCalendar,
} from "../src/index.ts";

const d = dayFromIso;
const iso = (span: { start: number; end: number } | null | undefined) =>
  span ? `${dayToIso(span.start)}..${dayToIso(span.end)}` : null;

describe("WorkCalendar", () => {
  const calendar = new WorkCalendar({ holidays: [d("2026-10-01")], extraWorkdays: [d("2026-10-10")] });

  it("skips weekends and holidays, counts make-up workdays", () => {
    expect(calendar.isWorkday(d("2026-10-19"))).toBe(true); // 周一
    expect(calendar.isWorkday(d("2026-10-24"))).toBe(false); // 周六
    expect(calendar.isWorkday(d("2026-10-01"))).toBe(false); // 国庆，周四
    expect(calendar.isWorkday(d("2026-10-10"))).toBe(true); // 调休上班的周六
    expect(dayToIso(calendar.addWorkdays(d("2026-10-23"), 1))).toBe("2026-10-26"); // 周五 + 1 = 周一
    expect(calendar.workdaysBetween(d("2026-10-19"), d("2026-10-25"))).toBe(5);
  });

  it("reads the stored config", () => {
    const stored = WorkCalendar.fromConfig({ holidays: ["2026-10-01"], extraWorkdays: ["2026-10-10"] });
    expect(stored.isWorkday(d("2026-10-01"))).toBe(false);
    expect(stored.isWorkday(d("2026-10-10"))).toBe(true);
    expect(WorkCalendar.fromConfig(null).isWorkday(d("2026-10-01"))).toBe(true);
  });

  it("finds the calendar day in a time zone", () => {
    // 北京时间 10 月 22 日 01:00 还是 UTC 的 21 日
    expect(dayToIso(dayInTimeZone(Date.parse("2026-10-21T17:00:00Z"), "Asia/Shanghai"))).toBe("2026-10-22");
  });
});

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

const calendar = new WorkCalendar();
const notStarted = (keys: string[]): Record<string, ScheduleNodeInput> =>
  Object.fromEntries(keys.map((k) => [k, { state: "notStarted" }]));

describe("schedule", () => {
  // 2026-10-21 是周三
  const start = d("2026-10-21");

  it("chains nodes on workdays and waits for every predecessor at a join", () => {
    const graph = flow(["start", [], 0], ["a", ["start"], 2], ["b", ["start"], 4], ["c", ["a", "b"], 1]);
    const plan = schedule(graph, calendar, { start, nodes: notStarted(["start", "a", "b", "c"]) });
    expect(iso(plan.start)).toBe("2026-10-21..2026-10-21");
    expect(iso(plan.a)).toBe("2026-10-21..2026-10-22");
    expect(iso(plan.b)).toBe("2026-10-21..2026-10-26"); // 跨周末
    expect(iso(plan.c)).toBe("2026-10-27..2026-10-27");
  });

  it("lets skipped nodes pass time through without taking any", () => {
    const graph = flow(["a", [], 1], ["b", ["a"], 3], ["c", ["b"], 1]);
    const plan = schedule(graph, calendar, {
      start,
      nodes: { ...notStarted(["a", "c"]), b: { state: "skipped" } },
    });
    expect(plan.b).toBeNull();
    expect(iso(plan.c)).toBe("2026-10-22..2026-10-22");
  });

  it("keeps pinned dates and schedules successors after them", () => {
    const graph = flow(["a", [], 1], ["b", ["a"], 1], ["c", ["b"], 2]);
    const plan = schedule(graph, calendar, {
      start,
      nodes: {
        ...notStarted(["a", "c"]),
        b: { state: "notStarted", pinned: { start: d("2026-11-02"), end: d("2026-11-04") } },
      },
    });
    expect(iso(plan.b)).toBe("2026-11-02..2026-11-04");
    expect(iso(plan.c)).toBe("2026-11-05..2026-11-06");
  });

  it("pushes successors out when a node finishes late", () => {
    const graph = flow(["a", [], 1], ["b", ["a"], 1]);
    const plan = schedule(graph, calendar, {
      start,
      nodes: { a: { state: "completed", actualEnd: d("2026-10-26") }, b: { state: "inProgress" } },
    });
    expect(iso(plan.a)).toBe("2026-10-21..2026-10-21");
    expect(iso(plan.b)).toBe("2026-10-26..2026-10-26");
  });

  it("schedules every reachable node of 示例流程", () => {
    const graph = new FlowGraph(demoSample.demoFlow);
    const plan = schedule(graph, calendar, {
      start,
      nodes: Object.fromEntries(graph.nodes.map((n) => [n.key, { state: "notStarted" as const }])),
    });
    const spans = Object.values(plan).filter((s) => s !== null);
    expect(spans).toHaveLength(graph.nodes.length);
    for (const s of spans) {
      expect(s.end).toBeGreaterThanOrEqual(s.start);
      expect(calendar.isWorkday(s.start) || s.start === s.end).toBe(true);
    }
  });
});
