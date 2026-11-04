import { describe, expect, it } from "vitest";
import {
  type ChartContext,
  type ChartItem,
  checkChartConfig,
  computeChart,
  drillChart,
  OTHER_GROUP,
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
