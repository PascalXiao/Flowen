/**
 * 度量图表：把一批工作项（或它们的节点）按维度分组、按指标汇总，得到画图用的数据。
 * 纯计算，不碰数据库：前端拿同步下来的工作项（已经按权限过滤）直接算，服务端也可以复用。
 *
 * 一张图可以有多个指标（每个指标一个系列），指标可以是字段的计数、求和、平均…，也可以是指标公式：
 *
 *   SUMIF({估分}, {状态} = "completed") / SUM({估分}) * 100      已完成估分占比
 *   COUNTIF({延期天数} > 0) / COUNT()                             延期率
 *
 * 图上还能定义计算字段：对每个工作项算一个值（沿用公式字段的写法），再拿来分组或汇总：
 *
 *   DAYS(TODAY(), {创建时间})                                     存续天数
 *   IF({估分} > 5, "大", "小")                                    规模
 *
 * 度量对象可以选「节点」：每个工作项的每个流程节点算一行，可按节点、节点负责人、节点状态分组，
 * 汇总节点耗时、计划工期、延期天数、估分和工时。
 */

import type { FieldOption } from "../fields/field-value.ts";
import { compileFormula, FormulaError, type FormulaValue } from "../fields/formula.ts";
import { dayInTimeZone, dayToIso } from "../schedule/calendar.ts";

/** 图表样式。 */
export const CHART_KINDS = [
  "column",
  "bar",
  "line",
  "area",
  "ring",
  "indicator",
  "compare",
  "table",
  "pivot",
  "waterfall",
  "radar",
  "funnel",
] as const;
export type ChartKind = (typeof CHART_KINDS)[number];
export const CHART_KIND_LABEL: Record<ChartKind, string> = {
  column: "柱状图",
  bar: "条形图",
  line: "折线图",
  area: "面积图",
  ring: "环形图",
  indicator: "指标卡",
  compare: "指标对比卡",
  table: "数据表",
  pivot: "透视表",
  waterfall: "瀑布图",
  radar: "雷达图",
  funnel: "漏斗图",
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

/** 度量对象：一个工作项一行，或一个工作项的每个节点一行。 */
export type ChartObject = "item" | "node";

/**
 * 分组维度：工作项类型、状态、阶段、创建人、创建时间、某个角色的成员、某个字段（含计算字段），
 * 度量对象是节点时还有节点、节点负责人、节点状态、节点完成时间。
 * 时间（创建时间、日期字段、节点完成时间）按粒度分桶。
 */
export interface ChartDimension {
  by:
    | "type"
    | "status"
    | "stage"
    | "creator"
    | "createdAt"
    | "role"
    | "field"
    | "node"
    | "nodeOwner"
    | "nodeState"
    | "nodeEnd";
  /** by = field 时的字段键（计算字段是 calc:键），by = role 时的角色键。 */
  key?: string;
  grain?: TimeGrain;
}

export const METRIC_AGGS = ["count", "countDistinct", "sum", "avg", "max", "min", "median", "formula"] as const;
export type MetricAgg = (typeof METRIC_AGGS)[number];

/** 指标：计数、字段去重计数，数字字段的求和、平均、最大、最小、中位数，或指标公式。 */
export interface ChartMetric {
  agg: MetricAgg;
  field?: string;
  /** agg = formula 时的公式。 */
  expr?: string;
  /** 显示名；不填按字段和汇总方式生成。 */
  label?: string;
}
export const METRIC_AGG_LABEL: Record<MetricAgg, string> = {
  count: "计数",
  countDistinct: "去重计数",
  sum: "求和",
  avg: "平均值",
  max: "最大值",
  min: "最小值",
  median: "中位数",
  formula: "公式",
};

/** 图上定义的计算字段：对每一行算一个值。 */
export interface ChartCalcField {
  key: string;
  name: string;
  expr: string;
}
/** 计算字段在维度、指标里的字段键。 */
export const calcKey = (key: string) => `calc:${key}`;

/** 指标对比卡的统计周期。 */
export const COMPARE_PERIODS = [
  "today",
  "thisWeek",
  "weekToDate",
  "thisMonth",
  "monthToDate",
  "thisQuarter",
  "quarterToDate",
  "thisYear",
  "yearToDate",
  "pastDays",
] as const;
export type ComparePeriod = (typeof COMPARE_PERIODS)[number];
export const COMPARE_PERIOD_LABEL: Record<ComparePeriod, string> = {
  today: "今天",
  thisWeek: "本周",
  weekToDate: "本周至今",
  thisMonth: "本月",
  monthToDate: "本月至今",
  thisQuarter: "本季度",
  quarterToDate: "本季度至今",
  thisYear: "今年",
  yearToDate: "今年至今",
  pastDays: "过去 N 天",
};

/** 指标对比卡：主指标按时间字段只算统计周期内的，再和上一周期、去年同期、目标值比。 */
export interface ChartCompare {
  /** createdAt，或日期字段键。 */
  time: string;
  period: ComparePeriod;
  /** period = pastDays 时的天数。 */
  days?: number;
  against: ("prev" | "yoy")[];
  target?: number | null;
  /** 数值越大越好（默认）还是越小越好，决定箭头旁的好坏说明。 */
  better?: "up" | "down";
}

/** 参考线。 */
export interface ChartRefLine {
  kind: "avg" | "median" | "max" | "min" | "const";
  value?: number;
}

export interface ChartConfig {
  kind: ChartKind;
  object?: ChartObject;
  /** 度量对象是节点时只看这些节点；空表示所有节点。 */
  nodeKeys?: string[];
  calcFields?: ChartCalcField[];
  /** 指标卡、指标对比卡没有维度。 */
  dimension?: ChartDimension | null;
  /** 透视表的第二层行维度。 */
  dimension2?: ChartDimension | null;
  /** 二级分组（堆叠柱、多条折线、数据表和透视表的列）。只有一个指标时可用。 */
  series?: ChartDimension | null;
  /** 第一个指标（旧图表只有它）。 */
  metric: ChartMetric;
  /** 全部指标；不填时就是 metric 一个。 */
  metrics?: ChartMetric[];
  /** 分组排序：按值从大到小、从小到大，或按分组本身（时间、选项顺序）。 */
  sort?: "valueDesc" | "valueAsc" | "label";
  /** 只显示前几个分组，其余合并成「其他」。 */
  limit?: number | null;
  /** 多个系列时：堆叠、并排、百分比堆叠。 */
  stack?: "stacked" | "grouped" | "percent";
  /** 按分组顺序累计（时间维度上看累计趋势）。 */
  accumulate?: boolean;
  /** 在图上标出数值。 */
  labels?: boolean;
  refLine?: ChartRefLine | null;
  compare?: ChartCompare | null;
}

/** 全部指标。 */
export const metricsOf = (config: ChartConfig): ChartMetric[] =>
  config.metrics?.length ? config.metrics : [config.metric];

/** 节点：度量对象是节点时，每个节点算一行。时间是毫秒时间戳。 */
export interface ChartNode {
  key: string;
  name: string;
  state: string;
  owners: readonly string[];
  plannedStart?: number | null;
  plannedEnd?: number | null;
  actualStart?: number | null;
  actualEnd?: number | null;
  points?: number | null;
  actualHours?: number | null;
}

/** 算图要用的工作项：基本信息、字段值（只含自己能看到的）、角色成员，按节点度量时还有节点。 */
export interface ChartItem {
  id: string;
  typeId: string;
  status: string;
  stage: string | null;
  createdBy: string;
  createdAt: number;
  values: Readonly<Record<string, unknown>>;
  roles: Readonly<Record<string, readonly string[]>>;
  nodes?: readonly ChartNode[];
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
  /** 现在（毫秒），算耗时、今天、对比周期用；不给就用当前时间。 */
  now?: number;
}

/** 节点度量用的系统字段（数字），字段键以 $node. 开头。 */
export const NODE_MEASURES: readonly ChartFieldDef[] = [
  { key: "$node.duration", name: "节点耗时（天）", dataType: "number" },
  { key: "$node.planned", name: "计划工期（天）", dataType: "number" },
  { key: "$node.delay", name: "延期天数", dataType: "number" },
  { key: "$node.points", name: "节点估分", dataType: "number" },
  { key: "$node.hours", name: "实际工时", dataType: "number" },
];
/** 公式里能用的系统字段：创建时间（YYYY-MM-DD）、状态（进行中/已完成/已终止）、阶段、类型名。 */
const ITEM_SYSTEM: readonly ChartFieldDef[] = [
  { key: "$createdAt", name: "创建时间", dataType: "date" },
  { key: "$status", name: "状态", dataType: "text" },
  { key: "$stage", name: "阶段", dataType: "text" },
  { key: "$type", name: "类型", dataType: "text" },
];

/** 维度、指标、公式可用的全部字段：工作项字段、节点系统字段（按节点度量时）、计算字段。 */
export function chartFields(config: Pick<ChartConfig, "object" | "calcFields">, fields: readonly ChartFieldDef[]) {
  return [
    ...fields,
    ...(config.object === "node" ? NODE_MEASURES : []),
    ...(config.calcFields ?? []).map((c) => ({ key: calcKey(c.key), name: c.name, dataType: "formula" })),
  ];
}

export interface ChartGroup {
  key: string;
  label: string;
}

/** 透视表：行（可两层，第一层带小计）、列（列维度的分组，最后一列合计）、每格每个指标一个值。 */
export interface PivotData {
  metrics: string[];
  /** 列维度的分组；没有列维度时为空，只有合计列。 */
  columns: ChartGroup[];
  rows: {
    /** 0 = 第一层行，1 = 第二层行。 */
    level: 0 | 1;
    group: string;
    group2?: string;
    label: string;
    /** 第一层行有第二层时，它这一行就是小计。 */
    subtotal: boolean;
    /** 按 列 × 指标 排：[列0指标0, 列0指标1, …, 合计指标0, …]。 */
    values: number[];
  }[];
  /** 合计行。 */
  total: number[];
}

/** 指标对比卡算出的结果。 */
export interface CompareData {
  period: string;
  /** 统计周期 [开始, 结束]（YYYY-MM-DD）。 */
  range: [string, string];
  value: number;
  better: "up" | "down";
  rows: { key: "prev" | "yoy" | "target"; label: string; base: number; diff: number; rate: number | null }[];
}

/** 算好的图：分组（横轴）、系列（每个系列一组值，和分组一一对应）、总计。 */
export interface ChartData {
  groups: ChartGroup[];
  series: { key: string; label: string; values: number[] }[];
  /** 第一个指标对所有行的汇总（指标卡显示它）。 */
  total: number;
  /** 每个指标对所有行的汇总。 */
  totals: { label: string; value: number }[];
  /** 参与计算的行数（工作项数，按节点度量时是节点数）。 */
  count: number;
  /** 行是工作项还是节点。 */
  unit: "item" | "node";
  pivot?: PivotData;
  compare?: CompareData;
}

const STATUS_LABEL: Record<string, string> = { inProgress: "进行中", completed: "已完成", terminated: "已终止" };
const STATUS_ORDER = ["inProgress", "completed", "terminated"];
const NODE_STATE_LABEL: Record<string, string> = {
  notStarted: "未开始",
  inProgress: "进行中",
  completed: "已完成",
  skipped: "已跳过",
};
const NODE_STATE_ORDER = ["notStarted", "inProgress", "completed", "skipped"];
/** 没值的分组。 */
export const EMPTY_GROUP = "__empty__";
/** 前 N 个之外合并的分组。 */
export const OTHER_GROUP = "__other__";
/** 没有二级分组、只有一个指标时唯一系列的键。 */
const SINGLE = "__value__";
/** 多个指标时第 i 个指标的系列键。 */
export const metricSeriesKey = (i: number) => `__metric_${i}`;

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

/** 参与计算的一行：工作项，或工作项的一个节点。values 已经带上节点系统字段和计算字段。 */
interface Row extends ChartItem {
  /** 来自哪个工作项（钻取时回到工作项）。 */
  source: ChartItem;
  node?: ChartNode;
}

/** 一行在某个维度上落在哪些分组（多选字段、多个角色成员会落在多个分组）。 */
function groupsOf(row: Row, dim: ChartDimension, ctx: ChartContext): ChartGroup[] {
  const empty = [{ key: EMPTY_GROUP, label: "未填写" }];
  switch (dim.by) {
    case "type":
      return [{ key: row.typeId, label: ctx.typeName(row.typeId) }];
    case "status":
      return [{ key: row.status, label: STATUS_LABEL[row.status] ?? row.status }];
    case "stage":
      return row.stage ? [{ key: row.stage, label: row.stage }] : empty;
    case "creator":
      return [{ key: row.createdBy, label: ctx.userName(row.createdBy) }];
    case "createdAt":
      return [bucket(dayInTimeZone(row.createdAt, ctx.timeZone), dim.grain ?? "month")];
    case "role": {
      const users = row.roles[dim.key ?? ""] ?? [];
      return users.length ? users.map((u) => ({ key: u, label: ctx.userName(u) })) : empty;
    }
    case "node":
      return row.node ? [{ key: row.node.key, label: row.node.name }] : empty;
    case "nodeOwner":
      return row.node?.owners.length ? row.node.owners.map((u) => ({ key: u, label: ctx.userName(u) })) : empty;
    case "nodeState":
      return row.node ? [{ key: row.node.state, label: NODE_STATE_LABEL[row.node.state] ?? row.node.state }] : empty;
    case "nodeEnd":
      return row.node?.actualEnd
        ? [bucket(dayInTimeZone(row.node.actualEnd, ctx.timeZone), dim.grain ?? "month")]
        : empty;
    case "field": {
      const field = ctx.fields.find((f) => f.key === dim.key);
      const value = row.values[dim.key ?? ""];
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
          return list.map((r) => {
            const u = String((r as Record<string, unknown>)._user ?? "");
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
function naturalOrder(
  dim: ChartDimension,
  ctx: ChartContext,
  nodeOrder: readonly string[],
): (a: ChartGroup, b: ChartGroup) => number {
  const last = (g: ChartGroup) => (g.key === EMPTY_GROUP || g.key === OTHER_GROUP ? 1 : 0);
  let rank: ((g: ChartGroup) => number) | null = null;
  if (dim.by === "status") rank = (g) => STATUS_ORDER.indexOf(g.key);
  if (dim.by === "nodeState") rank = (g) => NODE_STATE_ORDER.indexOf(g.key);
  if (dim.by === "node") rank = (g) => nodeOrder.indexOf(g.key);
  if (dim.by === "field") {
    const field = ctx.fields.find((f) => f.key === dim.key);
    const options = field?.options ?? [];
    if (options.length) rank = (g) => options.findIndex((o) => o.value === g.key);
  }
  return (a, b) =>
    last(a) - last(b) || (rank ? rank(a) - rank(b) : 0) || a.key.localeCompare(b.key, "zh-CN", { numeric: true }) || 0;
}

const round = (n: number) => Math.round(n * 100) / 100;
const blank = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const numbers = (values: readonly unknown[]) =>
  values
    .filter((v) => !blank(v))
    .map(Number)
    .filter((n) => Number.isFinite(n));

/** 一组数按汇总方式算出一个值。 */
function reduce(agg: "sum" | "avg" | "max" | "min" | "median", nums: number[]): number {
  if (nums.length === 0) return 0;
  switch (agg) {
    case "sum":
      return round(nums.reduce((a, b) => a + b, 0));
    case "avg":
      return round(nums.reduce((a, b) => a + b, 0) / nums.length);
    case "max":
      return Math.max(...nums);
    case "min":
      return Math.min(...nums);
    case "median": {
      const s = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return round(s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2);
    }
  }
}

/** 一个值去重计数用的键（多选、人员逐个算）。 */
const distinctKeys = (v: unknown): string[] =>
  blank(v)
    ? []
    : (Array.isArray(v) ? v : [v]).map((x) =>
        typeof x === "object" && x !== null
          ? String((x as Record<string, unknown>)._user ?? JSON.stringify(x))
          : String(x),
      );

// ───────────── 公式：计算字段和指标公式 ─────────────

/** 公式里的字段名或字段键换成字段键。 */
function resolver(fields: readonly ChartFieldDef[]) {
  return (ref: string) => fields.find((f) => f.key === ref || f.name === ref)?.key;
}

/** 编译计算字段：只能用本行的字段（关联、子工作项要在服务端算，图表里不支持）。 */
function compileCalc(expr: string, fields: readonly ChartFieldDef[]) {
  const compiled = compileFormula(expr, resolver(fields));
  if (compiled.usesRelated || compiled.usesSubItems)
    throw new FormulaError("图表的计算字段只能用本工作项的字段，不能用关联、子工作项和节点函数。");
  return compiled;
}

/** 指标公式里的聚合函数：参数是对每一行算的表达式。 */
const METRIC_FUNCTIONS: Record<string, { args: [number, number]; doc: string }> = {
  COUNT: { args: [0, 0], doc: "COUNT() 行数" },
  COUNTIF: { args: [1, 1], doc: "COUNTIF(条件) 满足条件的行数" },
  COUNTDISTINCT: { args: [1, 1], doc: "COUNTDISTINCT({字段}) 去重后的值个数" },
  SUM: { args: [1, 1], doc: "SUM({字段}) 求和" },
  SUMIF: { args: [2, 2], doc: "SUMIF({字段}, 条件) 满足条件的行求和" },
  AVG: { args: [1, 1], doc: "AVG({字段}) 平均值" },
  AVGIF: { args: [2, 2], doc: "AVGIF({字段}, 条件) 满足条件的行的平均值" },
  MAX: { args: [1, 1], doc: "MAX({字段}) 最大值" },
  MIN: { args: [1, 1], doc: "MIN({字段}) 最小值" },
  MEDIAN: { args: [1, 1], doc: "MEDIAN({字段}) 中位数" },
};
/** 指标公式编辑器里列出的函数。 */
export const METRIC_FORMULA_FUNCTIONS: readonly { name: string; doc: string }[] = Object.entries(METRIC_FUNCTIONS).map(
  ([name, f]) => ({ name, doc: f.doc }),
);

type Aggregator = (rows: readonly Row[]) => number;

/** 找到和 open 位置的「(」配对的「)」，跳过字符串和 {字段}。 */
function closeParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) break;
      i = end;
    } else if (c === "{") {
      const end = src.indexOf("}", i + 1);
      if (end < 0) break;
      i = end;
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  throw new FormulaError("括号没有配对。");
}

/** 按顶层逗号切开参数。 */
function splitArgs(src: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") i = Math.max(i, src.indexOf(c, i + 1));
    else if (c === "{") i = Math.max(i, src.indexOf("}", i + 1));
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  const tail = src.slice(start);
  if (args.length > 0 || tail.trim()) args.push(tail);
  return args;
}

/**
 * 编译指标公式：先把每个聚合函数换成一个占位变量（参数按行编译），
 * 剩下的四则运算、IF、ROUND 等交给公式引擎，对占位变量的值求值。
 */
export function compileMetricFormula(expr: string, fields: readonly ChartFieldDef[]) {
  const resolve = resolver(fields);
  const aggs: { name: string; args: ReturnType<typeof compileFormula>[] }[] = [];
  let out = "";
  let i = 0;
  const name = /[A-Za-z_]+/y;
  while (i < expr.length) {
    const c = expr[i] as string;
    if (c === '"' || c === "'" || c === "{") {
      const end = expr.indexOf(c === "{" ? "}" : c, i + 1);
      const stop = end < 0 ? expr.length : end + 1;
      out += expr.slice(i, stop);
      i = stop;
      continue;
    }
    name.lastIndex = i;
    const m = /[A-Za-z_]/.test(c) && (i === 0 || !/[\w.]/.test(expr[i - 1] as string)) ? name.exec(expr) : null;
    if (m) {
      const word = m[0].toUpperCase();
      let j = i + m[0].length;
      while (expr[j] === " ") j++;
      const fn = METRIC_FUNCTIONS[word];
      if (fn && expr[j] === "(") {
        const close = closeParen(expr, j);
        const args = splitArgs(expr.slice(j + 1, close));
        if (args.length < fn.args[0] || args.length > fn.args[1])
          throw new FormulaError(`${word} 的参数个数不对：${fn.doc}。`);
        aggs.push({ name: word, args: args.map((a) => compileFormula(a.trim(), resolve)) });
        out += `{__agg${aggs.length - 1}}`;
        i = close + 1;
        continue;
      }
      out += m[0];
      i += m[0].length;
      continue;
    }
    out += c;
    i++;
  }
  const outer = compileFormula(out, (ref) => {
    if (/^__agg\d+$/.test(ref)) return ref;
    if (resolve(ref)) throw new FormulaError(`字段「${ref}」要放在 SUM、AVG、COUNTIF 等汇总函数里。`);
    return undefined;
  });
  if (aggs.length === 0) throw new FormulaError("指标公式里至少要有一个汇总函数，比如 COUNT() 或 SUM({估分})。");
  for (const a of aggs)
    for (const arg of a.args)
      if (arg.usesRelated || arg.usesSubItems)
        throw new FormulaError("指标公式只能用本行的字段，不能用关联、子工作项和节点函数。");
  const truthy = (v: FormulaValue) =>
    v === true || (typeof v === "number" && v !== 0) || (typeof v === "string" && v !== "");
  const aggregate: Aggregator = (rows) => {
    const vals: Record<string, number> = {};
    aggs.forEach((a, k) => {
      const at = (row: Row, n: number) =>
        a.args[n]?.evaluate({ field: (key) => row.values[key], today: todayOf(row) }) ?? null;
      let v: number;
      switch (a.name) {
        case "COUNT":
          v = rows.length;
          break;
        case "COUNTIF":
          v = rows.filter((r) => truthy(at(r, 0))).length;
          break;
        case "COUNTDISTINCT":
          v = new Set(rows.flatMap((r) => distinctKeys(at(r, 0)))).size;
          break;
        default: {
          const conditional = a.name.endsWith("IF");
          const picked = conditional ? rows.filter((r) => truthy(at(r, 1))) : rows;
          const agg = a.name.replace(/IF$/, "").toLowerCase() as "sum" | "avg" | "max" | "min" | "median";
          v = reduce(agg, numbers(picked.map((r) => at(r, 0))));
        }
      }
      vals[`__agg${k}`] = v;
    });
    const result = outer.evaluate({ field: (key) => vals[key] ?? null });
    const n = typeof result === "number" ? result : Number(result);
    return Number.isFinite(n) ? round(n) : 0;
  };
  return { aggregate, source: expr };
}

/** 今天（公式里 TODAY() 用）：准备行时写进 values.$today。 */
const todayOf = (row: Row) => (typeof row.values.$today === "string" ? row.values.$today : undefined);

/** 指标的显示名。 */
export function metricLabel(metric: ChartMetric, fields: readonly ChartFieldDef[]): string {
  if (metric.label?.trim()) return metric.label.trim();
  if (metric.agg === "count") return "计数";
  if (metric.agg === "formula") return "公式指标";
  const field = fields.find((f) => f.key === metric.field)?.name ?? metric.field ?? "";
  return `${field}${METRIC_AGG_LABEL[metric.agg]}`;
}

/** 一个指标的汇总函数。 */
function aggregatorOf(metric: ChartMetric, fields: readonly ChartFieldDef[]): Aggregator {
  const field = metric.field ?? "";
  switch (metric.agg) {
    case "count":
      return (rows) => rows.length;
    case "countDistinct":
      return (rows) => new Set(rows.flatMap((r) => distinctKeys(r.values[field]))).size;
    case "formula":
      return compileMetricFormula(metric.expr ?? "", [...fields, ...ITEM_SYSTEM]).aggregate;
    default: {
      const agg = metric.agg;
      if (!metric.field) return (rows) => rows.length;
      return (rows) => reduce(agg, numbers(rows.map((r) => r.values[field])));
    }
  }
}

// ───────────── 准备行 ─────────────

const days1 = (ms: number) => Math.round((ms / DAY_MS) * 10) / 10;

/** 节点的系统度量字段。 */
function nodeMeasures(node: ChartNode, now: number): Record<string, number | null> {
  const start = node.actualStart ?? null;
  const end = node.actualEnd ?? null;
  const pStart = node.plannedStart ?? null;
  const pEnd = node.plannedEnd ?? null;
  return {
    "$node.duration": start !== null ? Math.max(0, days1((end ?? now) - start)) : null,
    "$node.planned": pStart !== null && pEnd !== null ? Math.round((pEnd - pStart) / DAY_MS) + 1 : null,
    "$node.delay": pEnd !== null ? Math.max(0, Math.floor(((end ?? now) - pEnd) / DAY_MS)) : null,
    "$node.points": node.points ?? null,
    "$node.hours": node.actualHours ?? null,
  };
}

/** 准备参与计算的行：按度量对象展开节点，补上系统字段，再按顺序算计算字段。 */
function prepare(items: readonly ChartItem[], config: ChartConfig, ctx: ChartContext) {
  const now = ctx.now ?? Date.now();
  const today = dayToIso(dayInTimeZone(now, ctx.timeZone));
  const fields = chartFields(config, ctx.fields);
  const nodeOrder: string[] = [];
  const rows: Row[] = [];
  for (const item of items) {
    const base = {
      ...item.values,
      $createdAt: dayToIso(dayInTimeZone(item.createdAt, ctx.timeZone)),
      $status: STATUS_LABEL[item.status] ?? item.status,
      $stage: item.stage,
      $type: ctx.typeName(item.typeId),
      $today: today,
    };
    if (config.object === "node") {
      for (const node of item.nodes ?? []) {
        if (!nodeOrder.includes(node.key)) nodeOrder.push(node.key);
        if (config.nodeKeys?.length && !config.nodeKeys.includes(node.key)) continue;
        rows.push({
          ...item,
          id: `${item.id}#${node.key}`,
          source: item,
          node,
          values: { ...base, ...nodeMeasures(node, now) },
        });
      }
    } else rows.push({ ...item, source: item, values: base });
  }
  const calcs = config.calcFields ?? [];
  if (calcs.length) {
    const available = [...ctx.fields, ...ITEM_SYSTEM, ...(config.object === "node" ? NODE_MEASURES : [])];
    for (const c of calcs) {
      const compiled = compileCalc(c.expr, available);
      const key = calcKey(c.key);
      for (const row of rows) {
        const values = row.values as Record<string, unknown>;
        values[key] = compiled.evaluate({ field: (k) => values[k], today });
      }
      available.push({ key, name: c.name, dataType: "formula" });
    }
  }
  const metrics = metricsOf(config);
  return {
    rows,
    nodeOrder,
    fields,
    metrics: metrics.map((m) => ({ label: metricLabel(m, fields), aggregate: aggregatorOf(m, fields) })),
    ctx: { ...ctx, fields } as ChartContext,
    today,
  };
}

/** 按维度分好的行，按 ChartGroup 键。 */
function partition(rows: readonly Row[], dim: ChartDimension, ctx: ChartContext) {
  const groups = new Map<string, { group: ChartGroup; rows: Row[] }>();
  for (const row of rows)
    for (const g of groupsOf(row, dim, ctx)) {
      const entry = groups.get(g.key) ?? { group: g, rows: [] };
      entry.rows.push(row);
      groups.set(g.key, entry);
    }
  return groups;
}

/** 分组排序、合并「其他」后的分组，每组带上第一个指标的值（排序用）。 */
function orderedGroups(rows: readonly Row[], dim: ChartDimension, config: ChartConfig, p: Prepared) {
  const first = p.metrics[0]?.aggregate ?? ((r: readonly Row[]) => r.length);
  let groups = [...partition(rows, dim, p.ctx).values()].map((g) => ({ ...g, value: first(g.rows) }));
  const time = ["createdAt", "nodeEnd"].includes(dim.by) || !!dim.grain;
  const sort = config.sort ?? (time ? "label" : "valueDesc");
  const natural = naturalOrder(dim, p.ctx, p.nodeOrder);
  groups.sort((a, b) =>
    sort === "label"
      ? natural(a.group, b.group)
      : (sort === "valueDesc" ? b.value - a.value : a.value - b.value) || natural(a.group, b.group),
  );
  // 前 N 个之外合并成「其他」
  if (config.limit && groups.length > config.limit) {
    const rest = groups.slice(config.limit);
    const restRows = [...new Set(rest.flatMap((g) => g.rows))];
    groups = [
      ...groups.slice(0, config.limit),
      { group: { key: OTHER_GROUP, label: "其他" }, rows: restRows, value: first(restRows) },
    ];
  }
  return groups;
}

type Prepared = ReturnType<typeof prepare>;

/** 样式是否用二级分组。 */
const seriesOf = (config: ChartConfig) =>
  config.series &&
  !["ring", "waterfall", "funnel", "indicator", "compare"].includes(config.kind) &&
  metricsOf(config).length === 1
    ? config.series
    : null;

const hasDimension = (kind: ChartKind) => kind !== "indicator" && kind !== "compare";

/** 按图表设置算出画图数据。 */
export function computeChart(items: readonly ChartItem[], config: ChartConfig, ctx: ChartContext): ChartData {
  const p = prepare(items, config, ctx);
  const totals = p.metrics.map((m) => ({ label: m.label, value: m.aggregate(p.rows) }));
  const base = {
    total: totals[0]?.value ?? 0,
    totals,
    count: p.rows.length,
    unit: config.object === "node" ? ("node" as const) : ("item" as const),
  };
  if (config.kind === "compare") {
    const compare = computeCompare(p, config);
    return {
      ...base,
      groups: [{ key: SINGLE, label: "全部" }],
      series: [{ key: SINGLE, label: totals[0]?.label ?? "", values: [compare?.value ?? 0] }],
      ...(compare && { compare }),
    };
  }
  const dim = hasDimension(config.kind) ? (config.dimension ?? null) : null;
  if (!dim)
    return {
      ...base,
      groups: [{ key: SINGLE, label: "全部" }],
      series: totals.map((t, i) => ({
        key: totals.length > 1 ? metricSeriesKey(i) : SINGLE,
        label: t.label,
        values: [t.value],
      })),
    };

  const groups = orderedGroups(p.rows, dim, config, p);
  const pivot = config.kind === "pivot" ? computePivot(p, config, groups) : undefined;
  const series = seriesOf(config);
  let out: ChartData["series"];
  if (!series)
    out = p.metrics.map((m, i) => ({
      key: p.metrics.length > 1 ? metricSeriesKey(i) : SINGLE,
      label: m.label,
      values: groups.map((g) => m.aggregate(g.rows)),
    }));
  else {
    // 二级分组：每个系列在每个分组里再汇总一次
    const aggregate = p.metrics[0]?.aggregate ?? ((r: readonly Row[]) => r.length);
    const seriesParts = [...partition(p.rows, series, p.ctx).values()].map((s) => s.group);
    seriesParts.sort(naturalOrder(series, p.ctx, p.nodeOrder));
    out = seriesParts.map((s) => ({
      key: s.key,
      label: s.label,
      values: groups.map((g) =>
        aggregate(g.rows.filter((r) => groupsOf(r, series, p.ctx).some((x) => x.key === s.key))),
      ),
    }));
  }
  if (config.accumulate)
    out = out.map((s) => {
      let sum = 0;
      return {
        ...s,
        values: s.values.map((v) => {
          sum += v;
          return round(sum);
        }),
      };
    });
  return { ...base, groups: groups.map((g) => g.group), series: out, ...(pivot && { pivot }) };
}

/** 透视表：行维度（可两层）× 列维度（二级分组）× 指标。 */
function computePivot(p: Prepared, config: ChartConfig, groups: ReturnType<typeof orderedGroups>): PivotData {
  const colDim = config.series ?? null;
  const columns = colDim
    ? [...partition(p.rows, colDim, p.ctx).values()].map((c) => c.group).sort(naturalOrder(colDim, p.ctx, p.nodeOrder))
    : [];
  const cells = (rows: readonly Row[]) => {
    const values: number[] = [];
    if (colDim)
      for (const c of columns) {
        const inCol = rows.filter((r) => groupsOf(r, colDim, p.ctx).some((g) => g.key === c.key));
        for (const m of p.metrics) values.push(m.aggregate(inCol));
      }
    for (const m of p.metrics) values.push(m.aggregate(rows));
    return values;
  };
  const dim2 = config.dimension2 ?? null;
  const rows: PivotData["rows"] = [];
  for (const g of groups) {
    rows.push({ level: 0, group: g.group.key, label: g.group.label, subtotal: !!dim2, values: cells(g.rows) });
    if (!dim2) continue;
    const subs = [...partition(g.rows, dim2, p.ctx).values()].sort((a, b) =>
      naturalOrder(dim2, p.ctx, p.nodeOrder)(a.group, b.group),
    );
    for (const s of subs)
      rows.push({
        level: 1,
        group: g.group.key,
        group2: s.group.key,
        label: s.group.label,
        subtotal: false,
        values: cells(s.rows),
      });
  }
  return { metrics: p.metrics.map((m) => m.label), columns, rows, total: cells(p.rows) };
}

// ───────────── 指标对比卡 ─────────────

const ymd = (day: number) => {
  const d = new Date(day * DAY_MS);
  return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()] as const;
};
const dayFrom = (y: number, m: number, d: number) => Math.floor(Date.UTC(y, m, d) / DAY_MS);

/** 统计周期往前推 back 个周期的 [开始, 结束]（天数）。 */
export function periodRange(period: ComparePeriod, today: number, back = 0, days = 7): [number, number] {
  const [y, m] = ymd(today);
  const monday = today - ((((today + 3) % 7) + 7) % 7);
  const calendar = (start: number, nextStart: (k: number) => number, toDate: boolean): [number, number] => {
    const s = nextStart(-back);
    const full = nextStart(-back + 1) - 1;
    return [s, toDate ? Math.min(full, s + (today - start)) : full];
  };
  const months = (n: number) => (k: number) => dayFrom(y, Math.floor(m / n) * n + k * n, 1);
  switch (period) {
    case "today":
      return [today - back, today - back];
    case "thisWeek":
    case "weekToDate":
      return calendar(monday, (k) => monday + 7 * k, period === "weekToDate");
    case "thisMonth":
    case "monthToDate":
      return calendar(dayFrom(y, m, 1), months(1), period === "monthToDate");
    case "thisQuarter":
    case "quarterToDate":
      return calendar(months(3)(0), months(3), period === "quarterToDate");
    case "thisYear":
    case "yearToDate":
      return calendar(dayFrom(y, 0, 1), months(12), period === "yearToDate");
    case "pastDays": {
      const n = Math.max(1, days);
      return [today - n + 1 - back * n, today - back * n];
    }
  }
}

/** 去年同期。 */
const lastYear = (day: number) => {
  const [y, m, d] = ymd(day);
  return dayFrom(y - 1, m, d);
};

/** 一行在对比卡时间字段上的日期（天数）。 */
function timeDay(row: Row, time: string, ctx: ChartContext): number | null {
  if (time === "createdAt") return dayInTimeZone(row.createdAt, ctx.timeZone);
  const v = row.values[time];
  if (blank(v)) return null;
  const s = typeof v === "object" && v && "start" in v ? String((v as { start: unknown }).start) : String(v);
  return isoDay(s);
}

function inRange(p: Prepared, compare: ChartCompare, range: [number, number]) {
  return p.rows.filter((r) => {
    const d = timeDay(r, compare.time, p.ctx);
    return d !== null && d >= range[0] && d <= range[1];
  });
}

function computeCompare(p: Prepared, config: ChartConfig): CompareData | undefined {
  const compare = config.compare;
  const metric = p.metrics[0];
  if (!compare || !metric) return undefined;
  const today = isoDay(p.today) ?? 0;
  const current = periodRange(compare.period, today, 0, compare.days);
  const value = metric.aggregate(inRange(p, compare, current));
  const rows: CompareData["rows"] = [];
  const row = (key: CompareData["rows"][number]["key"], label: string, base: number) =>
    rows.push({
      key,
      label,
      base,
      diff: round(value - base),
      rate: base === 0 ? null : round((value - base) / Math.abs(base)),
    });
  for (const a of compare.against) {
    const range: [number, number] =
      a === "prev" ? periodRange(compare.period, today, 1, compare.days) : [lastYear(current[0]), lastYear(current[1])];
    row(a, a === "prev" ? "环比" : "同比", metric.aggregate(inRange(p, compare, range)));
  }
  if (compare.target !== null && compare.target !== undefined && Number.isFinite(compare.target))
    row("target", "目标", compare.target);
  const label = COMPARE_PERIOD_LABEL[compare.period].replace("N", String(compare.days ?? 7));
  return {
    period: label,
    range: [dayToIso(current[0]), dayToIso(current[1])],
    value,
    better: compare.better ?? "up",
    rows,
  };
}

// ───────────── 钻取 ─────────────

/** 钻取的目标：点中的分组（横轴上的一格、透视表的一行），可再加第二层行、一个系列（堆叠里的一段、透视表的一列）。 */
export interface ChartDrill {
  group?: string | null;
  group2?: string | null;
  series?: string | null;
}

/**
 * 钻取：点中图上的一格，找出构成它的工作项（「查看明细」）。
 * 「其他」是前 N 个分组之外的；没有分组（指标卡）时是全部，指标对比卡是统计周期内的。
 * 按节点度量时返回这些节点所在的工作项（去重）。
 */
export function drillChart(
  items: readonly ChartItem[],
  config: ChartConfig,
  ctx: ChartContext,
  drill: ChartDrill,
): ChartItem[] {
  const p = prepare(items, config, ctx);
  let picked: readonly Row[] = p.rows;
  if (config.kind === "compare" && config.compare) {
    const today = isoDay(p.today) ?? 0;
    picked = inRange(p, config.compare, periodRange(config.compare.period, today, 0, config.compare.days));
  }
  const dim = hasDimension(config.kind) ? (config.dimension ?? null) : null;
  if (dim && drill.group) {
    if (drill.group === OTHER_GROUP) {
      const shown = new Set(orderedGroups(p.rows, dim, config, p).map((g) => g.group.key));
      picked = picked.filter((r) => groupsOf(r, dim, p.ctx).some((g) => !shown.has(g.key)));
    } else picked = picked.filter((r) => groupsOf(r, dim, p.ctx).some((g) => g.key === drill.group));
  }
  const dim2 = config.kind === "pivot" ? (config.dimension2 ?? null) : null;
  if (dim2 && drill.group2) picked = picked.filter((r) => groupsOf(r, dim2, p.ctx).some((g) => g.key === drill.group2));
  const series = config.kind === "pivot" ? (config.series ?? null) : seriesOf(config);
  if (series && drill.series && drill.series !== SINGLE)
    picked = picked.filter((r) => groupsOf(r, series, p.ctx).some((g) => g.key === drill.series));
  return [...new Set(picked.map((r) => r.source))];
}

/** 检查图表设置能不能算：维度、指标引用的字段要存在，求和平均要用数字字段，公式要能编译。 */
export function checkChartConfig(config: ChartConfig, baseFields: readonly ChartFieldDef[]): string | null {
  const numeric = ["number", "formula"];
  const available = [...baseFields, ...ITEM_SYSTEM, ...(config.object === "node" ? NODE_MEASURES : [])];
  for (const c of config.calcFields ?? []) {
    if (!c.name.trim()) return "计算字段要有名称。";
    try {
      compileCalc(c.expr, available);
    } catch (e) {
      return `计算字段「${c.name}」：${e instanceof Error ? e.message : String(e)}`;
    }
    available.push({ key: calcKey(c.key), name: c.name, dataType: "formula" });
  }
  const fields = chartFields(config, baseFields);
  const metrics = metricsOf(config);
  if (metrics.length > 10) return "一张图最多 10 个指标。";
  for (const metric of metrics) {
    if (metric.agg === "count") continue;
    if (metric.agg === "formula") {
      if (!metric.expr?.trim()) return "请填写指标公式。";
      try {
        compileMetricFormula(metric.expr, [...fields, ...ITEM_SYSTEM]);
      } catch (e) {
        return `指标公式：${e instanceof Error ? e.message : String(e)}`;
      }
      continue;
    }
    const field = fields.find((f) => f.key === metric.field);
    if (!field) return metric.agg === "countDistinct" ? "请选择要去重计数的字段。" : "请选择要汇总的数字字段。";
    if (metric.agg !== "countDistinct" && !numeric.includes(field.dataType))
      return `「${field.name}」不是数字字段，只能计数。`;
  }
  for (const dim of [config.dimension, config.dimension2, config.series]) {
    if (!dim) continue;
    if (dim.by === "field" && !fields.some((f) => f.key === dim.key)) return "分组字段不存在。";
    if (dim.by === "role" && !dim.key) return "请选择按哪个角色分组。";
    if (["node", "nodeOwner", "nodeState", "nodeEnd"].includes(dim.by) && config.object !== "node")
      return "按节点分组要把度量对象选为「节点」。";
  }
  if (hasDimension(config.kind) && !config.dimension) return "请选择分组维度。";
  if (config.kind === "radar" && !config.dimension) return "雷达图要选分组维度。";
  if (config.kind === "compare") {
    const c = config.compare;
    if (!c) return "请设置统计周期。";
    if (c.time !== "createdAt") {
      const f = baseFields.find((x) => x.key === c.time);
      if (!f || !["date", "datetime", "dateRange"].includes(f.dataType)) return "统计周期要按创建时间或日期字段算。";
    }
  }
  return null;
}
