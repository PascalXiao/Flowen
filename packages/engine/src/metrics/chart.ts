/**
 * 度量图表（对照飞书项目的度量）：把一批工作项按维度分组、按指标汇总，得到画图用的数据。
 * 纯计算，不碰数据库：前端拿同步下来的工作项（已经按权限过滤）直接算，服务端也可以复用。
 */

import type { FieldOption } from "../fields/field-value.ts";
import { dayInTimeZone, dayToIso } from "../schedule/calendar.ts";

/** 图表样式：柱状、条形、折线、面积、环形、指标卡、数据表。 */
export const CHART_KINDS = ["column", "bar", "line", "area", "ring", "indicator", "table"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];
export const CHART_KIND_LABEL: Record<ChartKind, string> = {
  column: "柱状图",
  bar: "条形图",
  line: "折线图",
  area: "面积图",
  ring: "环形图",
  indicator: "指标卡",
  table: "数据表",
};

/** 时间维度的粒度。 */
export const TIME_GRAINS = ["day", "week", "month", "quarter", "year"] as const;
export type TimeGrain = (typeof TIME_GRAINS)[number];
export const TIME_GRAIN_LABEL: Record<TimeGrain, string> = {
  day: "按天",
  week: "按周",
  month: "按月",
  quarter: "按季度",
  year: "按年",
};

/**
 * 分组维度：工作项类型、状态、阶段、创建人、创建时间、某个角色的成员，或某个字段。
 * 时间（创建时间、日期字段）按粒度分桶。
 */
export interface ChartDimension {
  by: "type" | "status" | "stage" | "creator" | "createdAt" | "role" | "field";
  /** by = field 时的字段键，by = role 时的角色键。 */
  key?: string;
  grain?: TimeGrain;
}

/** 指标：计数，或数字字段的求和、平均、最大、最小。 */
export interface ChartMetric {
  agg: "count" | "sum" | "avg" | "max" | "min";
  field?: string;
}
export const METRIC_AGG_LABEL: Record<ChartMetric["agg"], string> = {
  count: "计数",
  sum: "求和",
  avg: "平均值",
  max: "最大值",
  min: "最小值",
};

export interface ChartConfig {
  kind: ChartKind;
  /** 指标卡没有维度。 */
  dimension?: ChartDimension | null;
  /** 二级分组（堆叠柱、多条折线、数据表的列）。 */
  series?: ChartDimension | null;
  metric: ChartMetric;
  /** 分组排序：按值从大到小、从小到大，或按分组本身（时间、选项顺序）。 */
  sort?: "valueDesc" | "valueAsc" | "label";
  /** 只显示前几个分组，其余合并成「其他」。 */
  limit?: number | null;
}

/** 算图要用的工作项：基本信息、字段值（只含自己能看到的）、角色成员。 */
export interface ChartItem {
  id: string;
  typeId: string;
  status: string;
  stage: string | null;
  createdBy: string;
  createdAt: number;
  values: Readonly<Record<string, unknown>>;
  roles: Readonly<Record<string, readonly string[]>>;
}

export interface ChartFieldDef {
  key: string;
  name: string;
  dataType: string;
  options?: readonly FieldOption[] | null;
}

/** 分组键换成显示名要用的东西。 */
export interface ChartContext {
  fields: readonly ChartFieldDef[];
  typeName: (typeId: string) => string;
  userName: (userId: string) => string;
  /** 时间分桶用的时区（空间时区）。 */
  timeZone: string;
}

export interface ChartGroup {
  key: string;
  label: string;
}

/** 算好的图：分组（横轴）、系列（每个系列一组值，和分组一一对应）、总计。 */
export interface ChartData {
  groups: ChartGroup[];
  series: { key: string; label: string; values: number[] }[];
  /** 所有工作项按指标汇总的值（指标卡显示它）。 */
  total: number;
  /** 参与计算的工作项数。 */
  count: number;
}

const STATUS_LABEL: Record<string, string> = { inProgress: "进行中", completed: "已完成", terminated: "已终止" };
const STATUS_ORDER = ["inProgress", "completed", "terminated"];
/** 没值的分组。 */
export const EMPTY_GROUP = "__empty__";
/** 前 N 个之外合并的分组。 */
export const OTHER_GROUP = "__other__";
/** 没有二级分组时唯一系列的键。 */
const SINGLE = "__value__";

const DAY_MS = 86_400_000;

/** 天数（1970-01-01 起）按粒度分桶，返回可排序的键和显示名。 */
function bucket(day: number, grain: TimeGrain): ChartGroup {
  const iso = dayToIso(day);
  const [y, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
  switch (grain) {
    case "day":
      return { key: iso, label: iso.slice(5) };
    case "week": {
      // 周一开始；1970-01-01 是星期四
      const monday = day - ((((day + 3) % 7) + 7) % 7);
      const start = dayToIso(monday);
      return { key: start, label: `${start.slice(5)} 周` };
    }
    case "month":
      return { key: iso.slice(0, 7), label: `${y}-${String(m).padStart(2, "0")}` };
    case "quarter": {
      const q = Math.ceil(m / 3);
      return { key: `${y}-Q${q}`, label: `${y} Q${q}` };
    }
    case "year":
      return { key: String(y), label: `${y} 年` };
  }
}

/** YYYY-MM-DD（或带时间）换成天数。 */
function isoDay(value: string): number | null {
  const t = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.floor(t / DAY_MS);
}

/** 一个选项值的显示名；级联选项带上上级。 */
function optionLabel(options: readonly FieldOption[], value: string): string {
  const o = options.find((x) => x.value === value);
  if (!o) return value;
  const parent = o.parent ? options.find((x) => x.value === o.parent) : undefined;
  const label = o.label || o.value;
  return parent ? `${optionLabel(options, parent.value)}/${label}` : label;
}

/** 一个工作项在某个维度上落在哪些分组（多选字段、多个角色成员会落在多个分组）。 */
function groupsOf(item: ChartItem, dim: ChartDimension, ctx: ChartContext): ChartGroup[] {
  const empty = [{ key: EMPTY_GROUP, label: "未填写" }];
  switch (dim.by) {
    case "type":
      return [{ key: item.typeId, label: ctx.typeName(item.typeId) }];
    case "status":
      return [{ key: item.status, label: STATUS_LABEL[item.status] ?? item.status }];
    case "stage":
      return item.stage ? [{ key: item.stage, label: item.stage }] : empty;
    case "creator":
      return [{ key: item.createdBy, label: ctx.userName(item.createdBy) }];
    case "createdAt":
      return [bucket(dayInTimeZone(item.createdAt, ctx.timeZone), dim.grain ?? "month")];
    case "role": {
      const users = item.roles[dim.key ?? ""] ?? [];
      return users.length ? users.map((u) => ({ key: u, label: ctx.userName(u) })) : empty;
    }
    case "field": {
      const field = ctx.fields.find((f) => f.key === dim.key);
      const value = item.values[dim.key ?? ""];
      if (!field || value === null || value === undefined || value === "") return empty;
      const list = Array.isArray(value) ? value : [value];
      if (list.length === 0) return empty;
      switch (field.dataType) {
        case "date":
        case "datetime":
        case "dateRange": {
          const start = typeof value === "object" && value && "start" in value ? String(value.start) : String(value);
          const day = isoDay(start);
          return day === null ? empty : [bucket(day, dim.grain ?? "month")];
        }
        case "user":
        case "singleUser":
          return list.map((u) => ({ key: String(u), label: ctx.userName(String(u)) }));
        case "bool":
          return [{ key: String(value === true), label: value === true ? "是" : "否" }];
        case "multiPerson":
          return list.map((row) => {
            const u = String((row as Record<string, unknown>)._user ?? "");
            return { key: u, label: ctx.userName(u) };
          });
        default:
          if (field.options?.length)
            return list.map((v) => ({ key: String(v), label: optionLabel(field.options ?? [], String(v)) }));
          return list.map((v) => ({ key: String(v), label: String(v) }));
      }
    }
  }
}

/** 维度的自然顺序：状态按流程顺序、选项按配置顺序、时间按先后，其余按名称。 */
function naturalOrder(dim: ChartDimension, ctx: ChartContext): (a: ChartGroup, b: ChartGroup) => number {
  const last = (g: ChartGroup) => (g.key === EMPTY_GROUP || g.key === OTHER_GROUP ? 1 : 0);
  let rank: ((g: ChartGroup) => number) | null = null;
  if (dim.by === "status") rank = (g) => STATUS_ORDER.indexOf(g.key);
  if (dim.by === "field") {
    const field = ctx.fields.find((f) => f.key === dim.key);
    const options = field?.options ?? [];
    if (options.length) rank = (g) => options.findIndex((o) => o.value === g.key);
  }
  return (a, b) =>
    last(a) - last(b) || (rank ? rank(a) - rank(b) : 0) || a.key.localeCompare(b.key, "zh-CN", { numeric: true }) || 0;
}

/** 一组工作项按指标汇总。 */
function aggregate(items: readonly ChartItem[], metric: ChartMetric): number {
  if (metric.agg === "count" || !metric.field) return items.length;
  const nums = items
    .map((i) => i.values[metric.field ?? ""])
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (nums.length === 0) return 0;
  switch (metric.agg) {
    case "sum":
      return round(nums.reduce((a, b) => a + b, 0));
    case "avg":
      return round(nums.reduce((a, b) => a + b, 0) / nums.length);
    case "max":
      return Math.max(...nums);
    case "min":
      return Math.min(...nums);
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

/** 按维度分好的工作项，按 ChartGroup 键。 */
function partition(items: readonly ChartItem[], dim: ChartDimension, ctx: ChartContext) {
  const groups = new Map<string, { group: ChartGroup; items: ChartItem[] }>();
  for (const item of items)
    for (const g of groupsOf(item, dim, ctx)) {
      const entry = groups.get(g.key) ?? { group: g, items: [] };
      entry.items.push(item);
      groups.set(g.key, entry);
    }
  return groups;
}

/** 按图表设置算出画图数据。 */
export function computeChart(items: readonly ChartItem[], config: ChartConfig, ctx: ChartContext): ChartData {
  const total = aggregate(items, config.metric);
  const dim = config.kind === "indicator" ? null : (config.dimension ?? null);
  if (!dim)
    return {
      groups: [{ key: SINGLE, label: "全部" }],
      series: [{ key: SINGLE, label: METRIC_AGG_LABEL[config.metric.agg], values: [total] }],
      total,
      count: items.length,
    };

  const parts = partition(items, dim, ctx);
  let groups = [...parts.values()].map((p) => ({ ...p, value: aggregate(p.items, config.metric) }));
  const sort = config.sort ?? (dim.by === "createdAt" || dim.grain ? "label" : "valueDesc");
  const natural = naturalOrder(dim, ctx);
  groups.sort((a, b) =>
    sort === "label"
      ? natural(a.group, b.group)
      : (sort === "valueDesc" ? b.value - a.value : a.value - b.value) || natural(a.group, b.group),
  );
  // 前 N 个之外合并成「其他」
  if (config.limit && groups.length > config.limit) {
    const rest = groups.slice(config.limit);
    const restItems = [...new Set(rest.flatMap((g) => g.items))];
    groups = [
      ...groups.slice(0, config.limit),
      {
        group: { key: OTHER_GROUP, label: "其他" },
        items: restItems,
        value: aggregate(restItems, config.metric),
      },
    ];
  }

  const series = config.series && config.kind !== "ring" ? config.series : null;
  if (!series)
    return {
      groups: groups.map((g) => g.group),
      series: [{ key: SINGLE, label: METRIC_AGG_LABEL[config.metric.agg], values: groups.map((g) => g.value) }],
      total,
      count: items.length,
    };

  // 二级分组：每个系列在每个分组里再汇总一次
  const seriesParts = [...partition(items, series, ctx).values()].map((p) => p.group);
  seriesParts.sort(naturalOrder(series, ctx));
  return {
    groups: groups.map((g) => g.group),
    series: seriesParts.map((s) => ({
      key: s.key,
      label: s.label,
      values: groups.map((g) =>
        aggregate(
          g.items.filter((i) => groupsOf(i, series, ctx).some((x) => x.key === s.key)),
          config.metric,
        ),
      ),
    })),
    total,
    count: items.length,
  };
}

/** 检查图表设置能不能算：维度、指标引用的字段要存在，求和平均要用数字字段。 */
export function checkChartConfig(config: ChartConfig, fields: readonly ChartFieldDef[]): string | null {
  const numeric = ["number", "formula"];
  if (config.metric.agg !== "count") {
    const field = fields.find((f) => f.key === config.metric.field);
    if (!field) return "请选择要汇总的数字字段。";
    if (!numeric.includes(field.dataType)) return `「${field.name}」不是数字字段，只能计数。`;
  }
  for (const dim of [config.dimension, config.series]) {
    if (!dim) continue;
    if (dim.by === "field" && !fields.some((f) => f.key === dim.key)) return "分组字段不存在。";
    if (dim.by === "role" && !dim.key) return "请选择按哪个角色分组。";
  }
  if (config.kind !== "indicator" && !config.dimension) return "请选择分组维度。";
  return null;
}
