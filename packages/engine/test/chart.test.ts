import { describe, expect, it } from "vitest";
import {
  type ChartContext,
  type ChartItem,
  checkChartConfig,
  computeChart,
  drillChart,
  OTHER_GROUP,
  periodRange,
} from "../src/index.ts";

const fields = [
  {
    key: "优先级",
    name: "优先级",
    dataType: "select",
    options: [
      { value: "P0", label: "P0" },
      { value: "P1", label: "P1" },
      { value: "P2", label: "P2" },
    ],
  },
  {
    key: "标签",
    name: "标签",
    dataType: "multiSelect",
    options: [
      { value: "a", label: "前端" },
      { value: "b", label: "后端" },
    ],
  },
  { key: "工时", name: "工时", dataType: "number" },
  { key: "上市", name: "上市", dataType: "date" },
];
const ctx: ChartContext = {
  fields,
  typeName: (id) => ({ req: "需求", bug: "缺陷" })[id] ?? id,
  userName: (id) => ({ u1: "小明", u2: "小红" })[id] ?? id,
  timeZone: "Asia/Shanghai",
};
const day = (iso: string) => Date.parse(`${iso}T08:00:00+08:00`);
const item = (over: Partial<ChartItem>): ChartItem => ({
  id: Math.random().toString(),
  typeId: "req",
  status: "inProgress",
  stage: null,
  createdBy: "u1",
  createdAt: day("2026-10-05"),
  values: {},
  roles: {},
  ...over,
});
const items = [
  item({ values: { 优先级: "P1", 标签: ["a", "b"], 工时: 3, 上市: "2026-11-02" }, roles: { pm: ["u1"] } }),
  item({ values: { 优先级: "P0", 标签: ["a"], 工时: 5 }, status: "completed", createdBy: "u2" }),
  item({ values: { 优先级: "P1", 工时: 2 }, typeId: "bug", createdAt: day("2026-11-01") }),
  item({ values: {}, createdAt: day("2026-11-03") }),
];

describe("computeChart", () => {
  it("counts by an option field, biggest first, empty values last", () => {
    const data = computeChart(
      items,
      { kind: "column", dimension: { by: "field", key: "优先级" }, metric: { agg: "count" } },
      ctx,
    );
    expect(data.groups.map((g) => g.label)).toEqual(["P1", "P0", "未填写"]);
    expect(data.series[0]?.values).toEqual([2, 1, 1]);
    expect(data.total).toBe(4);
  });

  it("keeps option order when sorted by label, and a multi-value item counts in each group", () => {
    const data = computeChart(
      items,
      { kind: "bar", dimension: { by: "field", key: "标签" }, metric: { agg: "count" }, sort: "label" },
      ctx,
    );
    expect(data.groups.map((g) => g.label)).toEqual(["前端", "后端", "未填写"]);
    expect(data.series[0]?.values).toEqual([2, 1, 2]);
  });

  it("sums and averages a number field", () => {
    const sum = computeChart(
      items,
      { kind: "column", dimension: { by: "type" }, metric: { agg: "sum", field: "工时" } },
      ctx,
    );
    expect(sum.groups.map((g) => g.label)).toEqual(["需求", "缺陷"]);
    expect(sum.series[0]?.values).toEqual([8, 2]);
    expect(sum.total).toBe(10);
    const avg = computeChart(items, { kind: "indicator", metric: { agg: "avg", field: "工时" } }, ctx);
    expect(avg.total).toBeCloseTo(3.33);
  });

  it("buckets creation time by month in the space time zone", () => {
    const data = computeChart(
      items,
      { kind: "line", dimension: { by: "createdAt", grain: "month" }, metric: { agg: "count" } },
      ctx,
    );
    expect(data.groups.map((g) => g.label)).toEqual(["2026-10", "2026-11"]);
    expect(data.series[0]?.values).toEqual([2, 2]);
  });

  it("splits into series and merges the tail into 其他", () => {
    const data = computeChart(
      items,
      {
        kind: "column",
        dimension: { by: "field", key: "优先级" },
        series: { by: "status" },
        metric: { agg: "count" },
        limit: 1,
      },
      ctx,
    );
    expect(data.groups.map((g) => g.label)).toEqual(["P1", "其他"]);
    expect(data.series.map((s) => [s.label, s.values])).toEqual([
      ["进行中", [2, 1]],
      ["已完成", [0, 1]],
    ]);
  });

  it("groups by a role's members and by creator", () => {
    const byRole = computeChart(
      items,
      { kind: "ring", dimension: { by: "role", key: "pm" }, metric: { agg: "count" } },
      ctx,
    );
    expect(byRole.groups.map((g) => g.label)).toEqual(["未填写", "小明"]);
    const byCreator = computeChart(
      items,
      { kind: "table", dimension: { by: "creator" }, metric: { agg: "count" } },
      ctx,
    );
    expect(byCreator.groups.map((g) => [g.label])).toEqual([["小明"], ["小红"]]);
  });
});

describe("checkChartConfig", () => {
  it("needs a numeric field to sum, and a dimension except for indicator cards", () => {
    expect(checkChartConfig({ kind: "column", metric: { agg: "sum", field: "优先级" } }, fields)).toContain(
      "不是数字字段",
    );
    expect(checkChartConfig({ kind: "column", metric: { agg: "count" } }, fields)).toContain("分组维度");
    expect(checkChartConfig({ kind: "indicator", metric: { agg: "count" } }, fields)).toBeNull();
  });
});

describe("drillChart", () => {
  const byPriority = {
    kind: "column" as const,
    dimension: { by: "field" as const, key: "优先级" },
    metric: { agg: "count" as const },
  };
  it("returns the items behind one group, including empty values", () => {
    expect(drillChart(items, byPriority, ctx, { group: "P1" })).toEqual([items[0], items[2]]);
    expect(drillChart(items, byPriority, ctx, { group: "__empty__" })).toEqual([items[3]]);
  });
  it("narrows by series and covers the merged 其他 group", () => {
    const stacked = { ...byPriority, series: { by: "type" as const } };
    expect(drillChart(items, stacked, ctx, { group: "P1", series: "bug" })).toEqual([items[2]]);
    const top1 = { ...byPriority, limit: 1 };
    expect(drillChart(items, top1, ctx, { group: OTHER_GROUP })).toEqual([items[1], items[3]]);
  });
  it("returns everything for an indicator card", () => {
    expect(drillChart(items, { kind: "indicator", metric: { agg: "count" } }, ctx, {})).toHaveLength(4);
  });
});

describe("multiple metrics, calculated fields and metric formulas", () => {
  it("puts each metric in its own series", () => {
    const data = computeChart(
      items,
      {
        kind: "column",
        dimension: { by: "type" },
        metric: { agg: "count" },
        metrics: [{ agg: "count" }, { agg: "sum", field: "工时" }, { agg: "median", field: "工时" }],
      },
      ctx,
    );
    expect(data.series.map((s) => [s.label, s.values])).toEqual([
      ["计数", [3, 1]],
      ["工时求和", [8, 2]],
      ["工时中位数", [4, 2]],
    ]);
    expect(data.totals.map((t) => t.value)).toEqual([4, 10, 3]);
  });

  it("groups by a calculated field and sums another", () => {
    const config = {
      kind: "bar" as const,
      calcFields: [
        { key: "size", name: "规模", expr: 'IF({工时} > 2, "大", "小")' },
        { key: "double", name: "双倍工时", expr: "{工时} * 2" },
      ],
      dimension: { by: "field" as const, key: "calc:size" },
      metric: { agg: "sum" as const, field: "calc:double" },
      sort: "label" as const,
    };
    expect(checkChartConfig(config, fields)).toBeNull();
    const data = computeChart(items, config, ctx);
    expect(data.groups.map((g) => g.label)).toEqual(["大", "小"]);
    expect(data.series[0]?.values).toEqual([16, 4]);
    expect(data.series[0]?.label).toBe("双倍工时求和");
  });

  it("evaluates a metric formula per group", () => {
    const config = {
      kind: "table" as const,
      dimension: { by: "type" as const },
      metric: {
        agg: "formula" as const,
        expr: 'ROUND(COUNTIF({状态} = "已完成") / COUNT() * 100, 1)',
        label: "完成率",
      },
    };
    expect(checkChartConfig(config, fields)).toBeNull();
    const data = computeChart(items, config, ctx);
    expect(data.series[0]?.values).toEqual([33.3, 0]);
    const avg = computeChart(
      items,
      { kind: "indicator", metric: { agg: "formula", expr: "SUMIF({工时}, {工时} > 2) / SUM({工时})" } },
      ctx,
    );
    expect(avg.total).toBe(0.8);
  });

  it("rejects bad formulas with a readable message", () => {
    expect(checkChartConfig({ kind: "indicator", metric: { agg: "formula", expr: "{工时} * 2" } }, fields)).toContain(
      "汇总函数",
    );
    expect(
      checkChartConfig({ kind: "indicator", metric: { agg: "formula", expr: "SUM({不存在})" } }, fields),
    ).toContain("不存在");
  });

  it("accumulates along time", () => {
    const data = computeChart(
      items,
      { kind: "line", dimension: { by: "createdAt", grain: "month" }, metric: { agg: "count" }, accumulate: true },
      ctx,
    );
    expect(data.series[0]?.values).toEqual([2, 4]);
  });
});

describe("node metrics", () => {
  const D = 86_400_000;
  const t0 = Date.parse("2026-11-01T00:00:00Z");
  const withNodes = [
    item({
      id: "a",
      nodes: [
        {
          key: "design",
          name: "设计",
          state: "completed",
          owners: ["u1"],
          actualStart: t0,
          actualEnd: t0 + 3 * D,
          plannedStart: t0,
          plannedEnd: t0 + D,
        },
        { key: "dev", name: "开发", state: "inProgress", owners: ["u2"], actualStart: t0 + 3 * D },
      ],
    }),
    item({
      id: "b",
      nodes: [
        { key: "design", name: "设计", state: "completed", owners: ["u2"], actualStart: t0, actualEnd: t0 + D },
        { key: "dev", name: "开发", state: "notStarted", owners: [] },
      ],
    }),
  ];
  const nctx = { ...ctx, now: t0 + 5 * D };

  it("averages node duration by node, in flow order", () => {
    const config = {
      kind: "column" as const,
      object: "node" as const,
      dimension: { by: "node" as const },
      metric: { agg: "avg" as const, field: "$node.duration" },
      sort: "label" as const,
    };
    expect(checkChartConfig(config, fields)).toBeNull();
    const data = computeChart(withNodes, config, nctx);
    expect(data.groups.map((g) => g.label)).toEqual(["设计", "开发"]);
    expect(data.series[0]?.values).toEqual([2, 2]);
    expect(data.count).toBe(4);
    expect(data.unit).toBe("node");
  });

  it("filters nodes, groups by owner, measures delay and drills back to work items", () => {
    const config = {
      kind: "bar" as const,
      object: "node" as const,
      nodeKeys: ["design"],
      dimension: { by: "nodeOwner" as const },
      metric: { agg: "sum" as const, field: "$node.delay" },
    };
    const data = computeChart(withNodes, config, nctx);
    expect(data.groups.map((g) => [g.label, data.series[0]?.values[data.groups.indexOf(g)]])).toEqual([
      ["小明", 2],
      ["小红", 0],
    ]);
    expect(drillChart(withNodes, config, nctx, { group: "u1" }).map((i) => i.id)).toEqual(["a"]);
  });

  it("refuses node dimensions on item charts", () => {
    expect(checkChartConfig({ kind: "column", dimension: { by: "node" }, metric: { agg: "count" } }, fields)).toContain(
      "节点",
    );
  });
});

describe("pivot and compare cards", () => {
  it("crosses rows and columns with subtotals and totals", () => {
    const config = {
      kind: "pivot" as const,
      dimension: { by: "type" as const },
      dimension2: { by: "field" as const, key: "优先级" },
      series: { by: "status" as const },
      metric: { agg: "count" as const },
      metrics: [{ agg: "count" as const }, { agg: "sum" as const, field: "工时" }],
      sort: "label" as const,
    };
    const { pivot } = computeChart(items, config, ctx);
    expect(pivot?.columns.map((c) => c.label)).toEqual(["进行中", "已完成"]);
    expect(pivot?.rows.map((r) => [r.level, r.label, r.values])).toEqual([
      [0, "缺陷", [1, 2, 0, 0, 1, 2]],
      [1, "P1", [1, 2, 0, 0, 1, 2]],
      [0, "需求", [2, 3, 1, 5, 3, 8]],
      [1, "P0", [0, 0, 1, 5, 1, 5]],
      [1, "P1", [1, 3, 0, 0, 1, 3]],
      [1, "未填写", [1, 0, 0, 0, 1, 0]],
    ]);
    expect(pivot?.total).toEqual([3, 5, 1, 5, 4, 10]);
    expect(drillChart(items, config, ctx, { group: "req", group2: "P1", series: "inProgress" })).toEqual([items[0]]);
  });

  it("compares this month with last month, last year and a target", () => {
    const config = {
      kind: "compare" as const,
      metric: { agg: "count" as const },
      compare: {
        time: "createdAt",
        period: "thisMonth" as const,
        against: ["prev" as const, "yoy" as const],
        target: 4,
      },
    };
    const now = Date.parse("2026-11-20T04:00:00Z");
    const data = computeChart(items, config, { ...ctx, now });
    expect(data.compare?.range).toEqual(["2026-11-01", "2026-11-30"]);
    expect(data.compare?.value).toBe(2);
    expect(data.compare?.rows.map((r) => [r.label, r.base, r.diff, r.rate])).toEqual([
      ["环比", 2, 0, 0],
      ["同比", 0, 2, null],
      ["目标", 4, -2, -0.5],
    ]);
    expect(drillChart(items, config, { ...ctx, now }, {})).toEqual([items[2], items[3]]);
  });

  it("computes to-date and past-N-day ranges", () => {
    const today = Math.floor(Date.parse("2026-11-26T00:00:00Z") / 86_400_000);
    const iso = (r: [number, number]) => r.map((d) => new Date(d * 86_400_000).toISOString().slice(0, 10));
    expect(iso(periodRange("monthToDate", today, 1))).toEqual(["2026-10-01", "2026-10-26"]);
    expect(iso(periodRange("weekToDate", today))).toEqual(["2026-11-23", "2026-11-26"]);
    expect(iso(periodRange("thisQuarter", today, 1))).toEqual(["2026-07-01", "2026-09-30"]);
    expect(iso(periodRange("pastDays", today, 1, 7))).toEqual(["2026-11-13", "2026-11-19"]);
  });
});
