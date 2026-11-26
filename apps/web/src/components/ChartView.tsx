import type { ChartConfig, ChartData, ChartDrill, ChartKind, PivotData } from "@fp/engine";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { createContext, useContext, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 分类配色：固定顺序，按系列出现的先后取色，不循环；超过 8 个系列合并成「其他」。
 * 只用中性灰、青、紫（色值在 index.css 的 --fl-chart-*，亮暗各一套）：蓝色只表示「当前」，
 * 红/橙/绿只表示逾期/临期/完成，图表不占用这些语义。只有一个系列时用中性灰。
 */
const PALETTE = Array.from({ length: 8 }, (_, i) => `var(--fl-chart-${i + 1})`);
const MAX_SERIES = PALETTE.length;
const SINGLE_COLOR = "var(--fl-chart-1)";

/** 画图时的显示选项：堆叠方式、数值标签、参考线。 */
export type ChartOptions = Pick<ChartConfig, "stack" | "labels" | "refLine">;

/** 点图上的一格时回调（钻取看明细）；没有时图只能看不能点。 */
const PickContext = createContext<((drill: ChartDrill) => void) | null>(null);
const usePick = () => useContext(PickContext);

const fmt = (n: number) => n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const pct = (n: number) => `${(n * 100).toLocaleString("zh-CN", { maximumFractionDigits: 1 })}%`;
/** 系列是不是指标（多个指标时每个指标一个系列，不能相加）。 */
const isMetricSeries = (key: string) => key.startsWith("__metric_");

/** 系列超过调色板时，把多出来的合并成「其他」。 */
function capSeries(series: ChartData["series"]): ChartData["series"] {
  if (series.length <= MAX_SERIES) return series;
  const head = series.slice(0, MAX_SERIES - 1);
  const rest = series.slice(MAX_SERIES - 1);
  return [
    ...head,
    {
      key: "__other_series__",
      label: "其他",
      values: rest[0]?.values.map((_, i) => rest.reduce((sum, s) => sum + (s.values[i] ?? 0), 0)) ?? [],
    },
  ];
}

/** 刻度取整：上限取 1、2、2.5、5 乘 10 的幂。 */
function niceMax(value: number) {
  if (value <= 0) return 4;
  if (value <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= value) return m * step;
  return 10 * step;
}

/** 参考线的值：按第一个系列算平均、中位、最大、最小，或常量。 */
function refValue(
  options: ChartOptions | undefined,
  values: readonly number[],
): { value: number; label: string } | null {
  const ref = options?.refLine;
  if (!ref || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  switch (ref.kind) {
    case "avg":
      return { value: values.reduce((a, b) => a + b, 0) / values.length, label: "平均" };
    case "median": {
      const mid = Math.floor(sorted.length / 2);
      const v = sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
      return { value: v, label: "中位数" };
    }
    case "max":
      return { value: sorted[sorted.length - 1] ?? 0, label: "最大" };
    case "min":
      return { value: sorted[0] ?? 0, label: "最小" };
    case "const":
      return Number.isFinite(ref.value) ? { value: ref.value ?? 0, label: "参考" } : null;
  }
}

function Legend({ items }: { items: { key: string; label: string; color: string }[] }) {
  return (
    <ul aria-label="图例" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
      {items.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** 悬停提示：分组名和每个系列的值。 */
function Tooltip({
  title,
  rows,
  style,
}: {
  title: string;
  rows: { label: string; value: string; color: string }[];
  style: React.CSSProperties;
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-28 rounded-md border border-line-subtle bg-surface px-2.5 py-1.5 text-xs shadow-card"
      style={style}
    >
      <div className="mb-1 font-medium">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm" style={{ background: r.color }} />
          <span className="text-fg-muted">{r.label}</span>
          <span className="ml-auto pl-3 tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** 一张图：按样式画柱状、条形、折线、面积、环形、瀑布、雷达、漏斗、指标卡、指标对比卡、数据表或透视表。 */
export function ChartView({
  data,
  kind,
  label,
  className,
  onPick,
  options,
}: {
  data: ChartData;
  kind: ChartKind;
  label: string;
  className?: string;
  onPick?: (drill: ChartDrill) => void;
  options?: ChartOptions;
}) {
  return (
    <PickContext.Provider value={onPick ?? null}>
      <ChartBody data={data} kind={kind} label={label} className={className} options={options} />
    </PickContext.Provider>
  );
}

function ChartBody({
  data,
  kind,
  label,
  className,
  options,
}: {
  data: ChartData;
  kind: ChartKind;
  label: string;
  className?: string;
  options?: ChartOptions;
}) {
  const series = capSeries(data.series);
  const colors = series.length === 1 ? [SINGLE_COLOR] : series.map((_, i) => PALETTE[i] ?? "var(--fl-chart-4)");
  if (kind === "indicator") return <Indicator data={data} label={label} />;
  if (kind === "compare") return <CompareCard data={data} label={label} />;
  if (data.count === 0 || data.groups.length === 0)
    return <p className="py-10 text-center text-sm text-fg-subtle">暂无数据</p>;
  if (kind === "pivot" && data.pivot) return <PivotTable pivot={data.pivot} label={label} />;
  if (kind === "table") return <DataTable data={{ ...data, series }} label={label} />;
  if (kind === "ring") return <Ring data={data} label={label} />;
  if (kind === "waterfall") return <Waterfall data={data} label={label} options={options} />;
  if (kind === "funnel") return <Funnel data={data} label={label} />;
  if (kind === "radar") return <Radar data={{ ...data, series }} colors={colors} label={label} />;
  // 多个指标默认并排（不同指标相加没有意义），二级分组默认堆叠
  const stack = options?.stack ?? (series.some((s) => isMetricSeries(s.key)) ? "grouped" : "stacked");
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {series.length > 1 && (
        <Legend items={series.map((s, i) => ({ key: s.key, label: s.label, color: colors[i] ?? "" }))} />
      )}
      {kind === "bar" ? (
        <Bars data={{ ...data, series }} colors={colors} label={label} stack={stack} options={options} />
      ) : kind === "column" ? (
        <Columns data={{ ...data, series }} colors={colors} label={label} stack={stack} options={options} />
      ) : (
        <Lines data={{ ...data, series }} colors={colors} label={label} area={kind === "area"} options={options} />
      )}
    </div>
  );
}

/** 指标卡：一个或几个大数字，下面是参与计算的行数。 */
function Indicator({ data, label }: { data: ChartData; label: string }) {
  const pick = usePick();
  const unit = data.unit === "node" ? "个节点" : "个工作项";
  const big = (value: number, size: string) => {
    const text = <span className={cn(size, "font-semibold tabular-nums")}>{fmt(value)}</span>;
    return pick ? (
      <button
        type="button"
        aria-label={`查看明细：${fmt(value)}`}
        className="cursor-pointer rounded text-left hover:text-accent"
        onClick={() => pick({})}
      >
        {text}
      </button>
    ) : (
      text
    );
  };
  if (data.totals.length > 1)
    return (
      <figure aria-label={label} className="flex flex-col gap-3 py-2">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-4">
          {data.totals.map((t) => (
            <div key={t.label} className="flex flex-col gap-0.5">
              <span className="truncate text-xs text-fg-muted">{t.label}</span>
              {big(t.value, "text-2xl")}
            </div>
          ))}
        </div>
        <figcaption className="text-xs text-fg-subtle">
          共 {data.count} {unit}
        </figcaption>
      </figure>
    );
  return (
    <figure aria-label={label} className="flex flex-col items-start gap-1 py-4">
      {big(data.total, "text-4xl")}
      <figcaption className="text-xs text-fg-subtle">
        共 {data.count} {unit}
      </figcaption>
    </figure>
  );
}

/**
 * 指标对比卡：统计周期内的主指标，下面每行一组对比（环比、同比、目标）：基准值、差值、差异率。
 * 涨跌用箭头和文字表达，不用红绿（红绿留给逾期和完成）；「更好 / 更差」按设置的方向写出来。
 */
function CompareCard({ data, label }: { data: ChartData; label: string }) {
  const pick = usePick();
  const c = data.compare;
  if (!c) return <p className="py-10 text-center text-sm text-fg-subtle">请设置统计周期</p>;
  const value = <span className="text-4xl font-semibold tabular-nums">{fmt(c.value)}</span>;
  return (
    <figure aria-label={label} className="flex flex-col gap-3 py-2">
      <div className="flex flex-col items-start gap-1">
        <span className="text-xs text-fg-muted">
          {c.period} · {c.range[0] === c.range[1] ? c.range[0] : `${c.range[0]} ~ ${c.range[1]}`}
        </span>
        {pick ? (
          <button
            type="button"
            aria-label={`查看明细：${fmt(c.value)}`}
            className="cursor-pointer rounded hover:text-accent"
            onClick={() => pick({})}
          >
            {value}
          </button>
        ) : (
          value
        )}
      </div>
      {c.rows.length > 0 && (
        <table aria-label="对比" className="w-full text-sm">
          <thead className="text-left text-xs text-fg-subtle">
            <tr>
              <th className="h-7 font-normal">对比</th>
              <th className="text-right font-normal">基准值</th>
              <th className="text-right font-normal">差值</th>
              <th className="text-right font-normal">差异率</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => {
              const dir = r.diff > 0 ? "up" : r.diff < 0 ? "down" : "flat";
              const Icon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : Minus;
              const verdict = dir === "flat" ? "持平" : dir === c.better ? "更好" : "更差";
              return (
                <tr key={r.key} className="border-t border-line-subtle">
                  <td className="h-8 text-fg-muted">{r.label}</td>
                  <td className="text-right tabular-nums">{fmt(r.base)}</td>
                  <td className="text-right tabular-nums">
                    <span className="inline-flex items-center gap-0.5">
                      <Icon aria-hidden className="size-3.5 text-fg-muted" />
                      <span className="sr-only">{dir === "up" ? "增加" : dir === "down" ? "减少" : ""}</span>
                      {fmt(Math.abs(r.diff))}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">
                    {r.rate === null ? "—" : pct(Math.abs(r.rate))}
                    <span className="ml-1.5 text-xs text-fg-subtle">{verdict}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </figure>
  );
}

/** 纵轴刻度和网格线，可带一条参考线。 */
function Grid({
  top,
  percent,
  refLine,
}: {
  top: number;
  percent?: boolean;
  refLine?: { value: number; label: string } | null;
}) {
  return (
    <>
      {[top, top / 2, 0].map((t) => (
        <div
          key={t}
          className="absolute right-0 left-10 border-t border-line-subtle"
          style={{ top: `${(1 - t / top) * 100}%` }}
        >
          <span className="absolute -top-2 -left-10 w-8 text-right text-[11px] tabular-nums text-fg-subtle">
            {percent ? `${Math.round(t * 100)}%` : fmt(t)}
          </span>
        </div>
      ))}
      {refLine && (
        <div
          role="img"
          aria-label={`参考线 ${refLine.label} ${fmt(refLine.value)}`}
          className="pointer-events-none absolute right-0 left-10 z-[1] border-t border-dashed border-fg-muted"
          style={{ top: `${(1 - refLine.value / top) * 100}%` }}
        >
          <span className="absolute -top-4 left-0 rounded-sm bg-surface/90 px-1 text-[11px] tabular-nums text-fg-muted">
            {refLine.label} {fmt(refLine.value)}
          </span>
        </div>
      )}
    </>
  );
}

type Stack = NonNullable<ChartOptions["stack"]>;

/** 每个分组里每个系列画多高（百分比堆叠时按分组合计换成占比）。 */
function shares(data: ChartData, stack: Stack) {
  const totals = data.groups.map((_, i) => data.series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0));
  const height = (k: number, i: number) => {
    const v = Math.max(0, data.series[k]?.values[i] ?? 0);
    return stack === "percent" ? (totals[i] ? v / (totals[i] ?? 1) : 0) : v;
  };
  return { totals, height };
}

/** 悬停提示的行：百分比堆叠时值后面带占比。 */
const tipRows = (data: ChartData, colors: string[], i: number, stack: Stack, totals: number[]) =>
  data.series.map((s, k) => ({
    label: s.label,
    value:
      stack === "percent" && totals[i]
        ? `${fmt(s.values[i] ?? 0)}（${pct((s.values[i] ?? 0) / (totals[i] ?? 1))}）`
        : fmt(s.values[i] ?? 0),
    color: colors[k] ?? "",
  }));

const ariaOf = (data: ChartData, g: { label: string }, i: number) =>
  `${g.label}：${data.series.map((s) => `${s.label} ${fmt(s.values[i] ?? 0)}`).join("，")}`;

/** 柱状图：多个系列时堆叠、并排或百分比堆叠，悬停整列显示提示。 */
function Columns({
  data,
  colors,
  label,
  stack,
  options,
}: {
  data: ChartData;
  colors: string[];
  label: string;
  stack: Stack;
  options?: ChartOptions;
}) {
  const pick = usePick();
  const [hover, setHover] = useState<number | null>(null);
  const { totals, height } = shares(data, stack);
  const single = data.series.length === 1;
  const ref = single && stack !== "percent" ? refValue(options, data.series[0]?.values ?? []) : null;
  const peak =
    stack === "grouped"
      ? Math.max(...data.series.flatMap((s) => s.values))
      : stack === "percent"
        ? 1
        : Math.max(...totals);
  const top = stack === "percent" ? 1 : niceMax(Math.max(peak, ref?.value ?? 0));
  return (
    <div className="flex flex-col gap-1">
      <figure aria-label={label} className="relative flex h-52 items-end gap-1.5 pl-10">
        <Grid top={top} percent={stack === "percent"} refLine={ref} />
        {data.groups.map((g, i) => (
          <button
            type="button"
            key={g.key}
            aria-label={ariaOf(data, g, i)}
            className={cn(
              "relative flex h-full min-w-0 flex-1 flex-col justify-end outline-none",
              pick ? "cursor-pointer" : "cursor-default",
            )}
            onClick={() => pick?.({ group: g.key })}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            {stack === "grouped" && !single ? (
              // 并排：每个系列一根细柱，柱间 2px 缝
              <div
                className={cn("mx-auto flex h-full w-full max-w-16 items-end gap-[2px]", hover === i && "opacity-85")}
              >
                {data.series.map((s, k) => (
                  <div key={s.key} className="relative flex h-full min-w-0 flex-1 flex-col justify-end">
                    {options?.labels && (
                      <span className="pb-0.5 text-center text-[10px] tabular-nums text-fg-muted">
                        {fmt(s.values[i] ?? 0)}
                      </span>
                    )}
                    <div
                      className="w-full rounded-t-[4px]"
                      style={{ height: `${(height(k, i) / top) * 100}%`, minHeight: 2, background: colors[k] }}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {options?.labels && (
                  <span className="pb-0.5 text-center text-[11px] tabular-nums text-fg-muted">
                    {stack === "percent" ? "100%" : fmt(totals[i] ?? 0)}
                  </span>
                )}
                {/* 堆叠段之间留 2px 表面色的缝；顶端圆角 */}
                <div
                  className={cn("mx-auto flex w-full max-w-12 flex-col-reverse gap-[2px]", hover === i && "opacity-85")}
                  style={{
                    height: `${((stack === "percent" ? (totals[i] ? 1 : 0) : (totals[i] ?? 0)) / top) * 100}%`,
                  }}
                >
                  {data.series.map((s, k) => {
                    const v = height(k, i);
                    if (v === 0) return null;
                    return (
                      <div
                        key={s.key}
                        className="w-full first:rounded-b-none last:rounded-t-[4px]"
                        style={{ flexGrow: v, flexBasis: 0, minHeight: 2, background: colors[k] }}
                      />
                    );
                  })}
                </div>
              </>
            )}
            {hover === i && (
              <Tooltip
                title={g.label}
                rows={tipRows(data, colors, i, stack, totals)}
                style={{ bottom: "100%", left: "50%", transform: "translateX(-50%)" }}
              />
            )}
          </button>
        ))}
      </figure>
      <div className="flex gap-1.5 pl-10">
        {data.groups.map((g) => (
          <span key={g.key} className="min-w-0 flex-1 truncate text-center text-[11px] text-fg-muted" title={g.label}>
            {g.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 条形图：横向，标签在左；多个系列时堆叠、并排或百分比堆叠；单系列时条尾标数值。 */
function Bars({
  data,
  colors,
  label,
  stack,
  options,
}: {
  data: ChartData;
  colors: string[];
  label: string;
  stack: Stack;
  options?: ChartOptions;
}) {
  const pick = usePick();
  const [hover, setHover] = useState<number | null>(null);
  const { totals, height } = shares(data, stack);
  const single = data.series.length === 1;
  const ref = single ? refValue(options, data.series[0]?.values ?? []) : null;
  const max =
    stack === "percent"
      ? 1
      : Math.max(1, ref?.value ?? 0, ...(stack === "grouped" ? data.series.flatMap((s) => s.values) : totals));
  return (
    <div className="relative">
      {ref && (
        <div
          role="img"
          aria-label={`参考线 ${ref.label} ${fmt(ref.value)}`}
          className="pointer-events-none absolute inset-y-0 z-[1] border-l border-dashed border-fg-muted"
          style={{ left: `calc(8rem + (100% - 8rem) * ${(ref.value / max) * 0.8})` }}
        >
          <span className="absolute -top-4 -translate-x-1/2 bg-surface px-1 text-[11px] tabular-nums text-fg-muted">
            {ref.label} {fmt(ref.value)}
          </span>
        </div>
      )}
      <ul aria-label={label} className="flex flex-col">
        {data.groups.map((g, i) => (
          <li key={g.key} className="relative">
            <button
              type="button"
              aria-label={ariaOf(data, g, i)}
              className={cn(
                "grid w-full grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 rounded px-1 py-1 text-left hover:bg-hover/50",
                pick ? "cursor-pointer" : "cursor-default",
              )}
              onClick={() => pick?.({ group: g.key })}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <span className="truncate text-sm text-fg-muted" title={g.label}>
                {g.label}
              </span>
              {stack === "grouped" && !single ? (
                <span className="flex flex-col gap-[2px]">
                  {data.series.map((s, k) => (
                    <span key={s.key} className="flex items-center gap-2">
                      <span
                        className="h-2.5 rounded-r-[4px]"
                        style={{ width: `${(height(k, i) / max) * 80}%`, minWidth: 2, background: colors[k] }}
                      />
                      {options?.labels && <span className="text-[11px] tabular-nums">{fmt(s.values[i] ?? 0)}</span>}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <span
                    className="flex h-4 gap-[2px]"
                    style={{
                      width: `${((stack === "percent" ? (totals[i] ? 1 : 0) : (totals[i] ?? 0)) / max) * 80}%`,
                      minWidth: 2,
                    }}
                  >
                    {data.series.map((s, k) => {
                      const v = height(k, i);
                      if (v === 0) return null;
                      return (
                        <span
                          key={s.key}
                          className="h-full last:rounded-r-[4px]"
                          style={{ flexGrow: v, flexBasis: 0, minWidth: 2, background: colors[k] }}
                        />
                      );
                    })}
                  </span>
                  {stack !== "percent" && <span className="text-sm tabular-nums">{fmt(totals[i] ?? 0)}</span>}
                </span>
              )}
            </button>
            {hover === i && !single && (
              <Tooltip
                title={g.label}
                rows={tipRows(data, colors, i, stack, totals)}
                style={{ top: "100%", left: "8rem" }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 折线图、面积图：每个系列一条 2px 线，悬停显示竖线和这一点各系列的值。 */
function Lines({
  data,
  colors,
  label,
  area,
  options,
}: {
  data: ChartData;
  colors: string[];
  label: string;
  area: boolean;
  options?: ChartOptions;
}) {
  const pick = usePick();
  const [hover, setHover] = useState<number | null>(null);
  const ref = data.series.length === 1 ? refValue(options, data.series[0]?.values ?? []) : null;
  const top = niceMax(Math.max(ref?.value ?? 0, ...data.series.flatMap((s) => s.values)));
  const n = data.groups.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - (v / top) * 100;
  return (
    <div className="flex flex-col gap-1">
      <figure aria-label={label} className="relative h-52 pl-10">
        <Grid top={top} refLine={ref} />
        <div className="relative h-full">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            <title>{label}</title>
            {data.series.map((s, k) => {
              const points = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
              return (
                <g key={s.key}>
                  {area && (
                    <polygon
                      points={`${x(0)},100 ${points} ${x(n - 1)},100`}
                      style={{ fill: colors[k] }}
                      fillOpacity={data.series.length > 1 ? 0.12 : 0.18}
                    />
                  )}
                  <polyline
                    points={points}
                    fill="none"
                    style={{ stroke: colors[k] }}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}
            {hover !== null && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={0}
                y2={100}
                stroke="var(--color-line)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {/* 点：HTML 画，不随 SVG 拉伸变形；带一圈表面色 */}
          {data.series.map((s, k) =>
            s.values.map((v, i) => (
              <span
                key={`${s.key}-${i}`}
                className={cn("absolute size-2 rounded-full ring-2 ring-surface", hover !== i && n > 12 && "hidden")}
                style={{ left: `${x(i)}%`, top: `${y(v)}%`, background: colors[k], transform: "translate(-50%, -50%)" }}
              />
            )),
          )}
          {/* 数值标签：只给单系列、点不太密时标 */}
          {options?.labels &&
            data.series.length === 1 &&
            n <= 16 &&
            data.series[0]?.values.map((v, i) => (
              <span
                key={data.groups[i]?.key}
                className="pointer-events-none absolute text-[10px] tabular-nums text-fg-muted"
                style={{ left: `${x(i)}%`, top: `${y(v)}%`, transform: "translate(-50%, -150%)" }}
              >
                {fmt(v)}
              </span>
            ))}
          {/* 悬停区：每个分组一条竖带 */}
          <div className="absolute inset-0 flex">
            {data.groups.map((g, i) => (
              <button
                type="button"
                key={g.key}
                aria-label={ariaOf(data, g, i)}
                className={cn("h-full flex-1 outline-none", pick ? "cursor-pointer" : "cursor-default")}
                onClick={() => pick?.({ group: g.key })}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            ))}
          </div>
          {hover !== null && (
            <Tooltip
              title={data.groups[hover]?.label ?? ""}
              rows={data.series.map((s, k) => ({
                label: s.label,
                value: fmt(s.values[hover] ?? 0),
                color: colors[k] ?? "",
              }))}
              style={{
                top: 0,
                left: `${x(hover)}%`,
                transform: x(hover) > 60 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
              }}
            />
          )}
        </div>
      </figure>
      <div className="relative h-4 pl-10">
        <div className="relative h-full">
          {data.groups.map((g, i) =>
            n <= 12 || i % Math.ceil(n / 12) === 0 ? (
              <span
                key={g.key}
                className="absolute -translate-x-1/2 truncate text-[11px] whitespace-nowrap text-fg-muted"
                style={{ left: `${x(i)}%` }}
              >
                {g.label}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 瀑布图：每个分组是一段增减，柱子从上一段的累计值起步；最后一根是合计。
 * 增加用中性灰、减少用紫、合计用青（不用红绿，红绿留给逾期和完成），图例写明。
 */
function Waterfall({ data, label, options }: { data: ChartData; label: string; options?: ChartOptions }) {
  const pick = usePick();
  const [hover, setHover] = useState<number | null>(null);
  const values = data.series[0]?.values ?? [];
  const steps: { key: string; label: string; from: number; to: number; kind: "up" | "down" | "total" }[] = [];
  let run = 0;
  data.groups.forEach((g, i) => {
    const v = values[i] ?? 0;
    steps.push({ key: g.key, label: g.label, from: run, to: run + v, kind: v >= 0 ? "up" : "down" });
    run += v;
  });
  steps.push({ key: "__total__", label: "合计", from: 0, to: run, kind: "total" });
  const color = { up: "var(--fl-chart-1)", down: "var(--fl-chart-3)", total: "var(--fl-chart-2)" };
  const hi = Math.max(0, ...steps.flatMap((s) => [s.from, s.to]));
  const lo = Math.min(0, ...steps.flatMap((s) => [s.from, s.to]));
  const top = niceMax(hi);
  const bottom = lo < 0 ? -niceMax(-lo) : 0;
  const span = top - bottom || 1;
  const yPct = (v: number) => ((top - v) / span) * 100;
  return (
    <div className="flex flex-col gap-2">
      <Legend
        items={[
          { key: "up", label: "增加", color: color.up },
          { key: "down", label: "减少", color: color.down },
          { key: "total", label: "合计", color: color.total },
        ]}
      />
      <figure aria-label={label} className="relative flex h-52 gap-1.5 pl-10">
        {[top, (top + bottom) / 2, bottom].map((t) => (
          <div key={t} className="absolute right-0 left-10 border-t border-line-subtle" style={{ top: `${yPct(t)}%` }}>
            <span className="absolute -top-2 -left-10 w-8 text-right text-[11px] tabular-nums text-fg-subtle">
              {fmt(t)}
            </span>
          </div>
        ))}
        {steps.map((s, i) => {
          const delta = s.kind === "total" ? s.to : s.to - s.from;
          return (
            <button
              type="button"
              key={s.key}
              aria-label={`${s.label}：${s.kind === "total" ? "合计" : delta >= 0 ? "增加" : "减少"} ${fmt(Math.abs(delta))}`}
              className={cn(
                "relative h-full min-w-0 flex-1 outline-none",
                pick && s.kind !== "total" ? "cursor-pointer" : "cursor-default",
              )}
              onClick={() => s.kind !== "total" && pick?.({ group: s.key })}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <div
                className={cn("absolute inset-x-0 mx-auto max-w-12 rounded-[4px]", hover === i && "opacity-85")}
                style={{
                  top: `${yPct(Math.max(s.from, s.to))}%`,
                  height: `max(2px, ${(Math.abs(s.to - s.from) / span) * 100}%)`,
                  background: color[s.kind],
                }}
              />
              {options?.labels && (
                <span
                  className="absolute inset-x-0 text-center text-[10px] tabular-nums text-fg-muted"
                  style={{ top: `calc(${yPct(Math.max(s.from, s.to))}% - 14px)` }}
                >
                  {fmt(delta)}
                </span>
              )}
              {hover === i && (
                <Tooltip
                  title={s.label}
                  rows={[
                    {
                      label: s.kind === "total" ? "合计" : delta >= 0 ? "增加" : "减少",
                      value: fmt(Math.abs(delta)),
                      color: color[s.kind],
                    },
                    ...(s.kind === "total" ? [] : [{ label: "累计", value: fmt(s.to), color: "transparent" }]),
                  ]}
                  style={{ top: `${yPct(Math.max(s.from, s.to))}%`, left: "50%", transform: "translate(-50%, -110%)" }}
                />
              )}
            </button>
          );
        })}
      </figure>
      <div className="flex gap-1.5 pl-10">
        {steps.map((s) => (
          <span key={s.key} className="min-w-0 flex-1 truncate text-center text-[11px] text-fg-muted" title={s.label}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 漏斗图：按分组顺序从上到下，宽度按数值，相邻两层之间标出转化率。 */
function Funnel({ data, label }: { data: ChartData; label: string }) {
  const pick = usePick();
  const values = data.series[0]?.values ?? [];
  const max = Math.max(1, ...values);
  return (
    <ol aria-label={label} className="flex flex-col items-stretch">
      {data.groups.map((g, i) => {
        const v = values[i] ?? 0;
        const prev = values[i - 1];
        return (
          <li key={g.key} className="flex flex-col items-center">
            {i > 0 && (
              <span className="py-0.5 text-[11px] tabular-nums text-fg-subtle">转化 {prev ? pct(v / prev) : "—"}</span>
            )}
            <button
              type="button"
              aria-label={`${g.label}：${fmt(v)}`}
              className={cn(
                "grid w-full grid-cols-[7rem_minmax(0,1fr)_4rem] items-center gap-3 rounded px-1 text-left hover:bg-hover/50",
                pick ? "cursor-pointer" : "cursor-default",
              )}
              onClick={() => pick?.({ group: g.key })}
            >
              <span className="truncate text-sm text-fg-muted" title={g.label}>
                {g.label}
              </span>
              <span className="flex justify-center">
                <span
                  className="h-7 rounded-[4px]"
                  style={{ width: `${(v / max) * 100}%`, minWidth: 2, background: SINGLE_COLOR }}
                />
              </span>
              <span className="text-right text-sm tabular-nums">{fmt(v)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** 雷达图：分组是轴（3 个起），每个系列一个多边形；点轴名看这一轴的明细。 */
function Radar({ data, colors, label }: { data: ChartData; colors: string[]; label: string }) {
  const pick = usePick();
  const [hover, setHover] = useState<number | null>(null);
  const groups = data.groups.slice(0, 12);
  const n = groups.length;
  if (n < 3) return <p className="py-10 text-center text-sm text-fg-subtle">雷达图至少要 3 个分组</p>;
  const top = niceMax(Math.max(...data.series.flatMap((s) => s.values.slice(0, n))));
  const R = 38;
  const at = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r] as const;
  };
  const ring = (r: number) => groups.map((_, i) => at(i, r).join(",")).join(" ");
  return (
    <div className="flex flex-col gap-2">
      {data.series.length > 1 && (
        <Legend items={data.series.map((s, i) => ({ key: s.key, label: s.label, color: colors[i] ?? "" }))} />
      )}
      <figure aria-label={label} className="relative mx-auto aspect-square w-full max-w-72">
        <svg viewBox="0 0 100 100" className="size-full overflow-visible">
          <title>{label}</title>
          {[1, 0.5].map((f) => (
            <polygon key={f} points={ring(R * f)} fill="none" stroke="var(--color-line-subtle)" strokeWidth={0.4} />
          ))}
          {groups.map((g, i) => {
            const [x2, y2] = at(i, R);
            return (
              <line key={g.key} x1={50} y1={50} x2={x2} y2={y2} stroke="var(--color-line-subtle)" strokeWidth={0.4} />
            );
          })}
          {data.series.map((s, k) => {
            const pts = groups.map((_, i) => at(i, (Math.max(0, s.values[i] ?? 0) / top) * R).join(",")).join(" ");
            return (
              <polygon
                key={s.key}
                points={pts}
                style={{ fill: colors[k], stroke: colors[k] }}
                fillOpacity={0.14}
                strokeWidth={0.8}
                strokeLinejoin="round"
              />
            );
          })}
          {data.series.map((s, k) =>
            groups.map((g, i) => {
              const [cx, cy] = at(i, (Math.max(0, s.values[i] ?? 0) / top) * R);
              return (
                <circle
                  key={`${s.key}-${g.key}`}
                  cx={cx}
                  cy={cy}
                  r={hover === i ? 1.8 : 1.3}
                  style={{ fill: colors[k], stroke: "var(--color-surface)" }}
                  strokeWidth={0.6}
                />
              );
            }),
          )}
          <text x={50} y={50 - R - 1} textAnchor="middle" className="fill-fg-subtle" fontSize={2.6}>
            {fmt(top)}
          </text>
        </svg>
        {groups.map((g, i) => {
          const [x, y] = at(i, R + 7);
          return (
            <button
              type="button"
              key={g.key}
              aria-label={ariaOf(data, g, i)}
              className={cn(
                "absolute max-w-24 -translate-x-1/2 -translate-y-1/2 truncate rounded px-1 text-[11px] text-fg-muted hover:bg-hover",
                pick ? "cursor-pointer" : "cursor-default",
              )}
              style={{ left: `${x}%`, top: `${y}%` }}
              onClick={() => pick?.({ group: g.key })}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              {g.label}
            </button>
          );
        })}
        {hover !== null && (
          <Tooltip
            title={groups[hover]?.label ?? ""}
            rows={data.series.map((s, k) => ({
              label: s.label,
              value: fmt(s.values[hover] ?? 0),
              color: colors[k] ?? "",
            }))}
            style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
          />
        )}
      </figure>
    </div>
  );
}

/** 环形图：单系列，每个分组一个扇区（分组多时由图表设置合并成「其他」），右侧图例带数值和占比。 */
function Ring({ data, label }: { data: ChartData; label: string }) {
  const pick = usePick();
  const [hover, setHover] = useState<number | null>(null);
  const values = (data.series[0]?.values ?? []).slice(0, MAX_SERIES);
  const groups = data.groups.slice(0, MAX_SERIES);
  const sum = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const r = 40;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const colors = groups.map((_, i) => PALETTE[i] ?? "var(--fl-chart-4)");
  return (
    <figure aria-label={label} className="flex flex-wrap items-center gap-6">
      <div className="relative size-40 shrink-0">
        <svg viewBox="0 0 100 100" className="size-full -rotate-90">
          <title>{label}</title>
          {values.map((v, i) => {
            const len = (Math.max(0, v) / sum) * circumference;
            // 扇区之间留 2px 缝
            const gap = values.length > 1 ? Math.min(1.2, len / 2) : 0;
            const el = (
              // biome-ignore lint/a11y/noStaticElementInteractions: 扇区悬停只是高亮，旁边的图例有同样的数值
              <circle
                key={groups[i]?.key}
                cx={50}
                cy={50}
                r={r}
                fill="none"
                stroke={colors[i]}
                strokeWidth={hover === i ? 16 : 14}
                strokeDasharray={`${Math.max(0, len - gap)} ${circumference}`}
                strokeDashoffset={-offset}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold tabular-nums">
            {fmt(hover !== null ? (values[hover] ?? 0) : data.total)}
          </span>
          <span className="max-w-20 truncate text-[11px] text-fg-subtle">
            {hover !== null ? groups[hover]?.label : "合计"}
          </span>
        </div>
      </div>
      <ul aria-label="图例" className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
        {groups.map((g, i) => (
          <li key={g.key}>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 rounded px-1 text-left",
                hover === i && "bg-hover",
                pick ? "cursor-pointer" : "cursor-default",
              )}
              onClick={() => pick?.({ group: g.key })}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: colors[i] }} />
              <span className="min-w-0 flex-1 truncate text-fg-muted">{g.label}</span>
              <span className="tabular-nums">{fmt(values[i] ?? 0)}</span>
              <span className="w-12 text-right text-xs tabular-nums text-fg-subtle">
                {Math.round(((values[i] ?? 0) / sum) * 100)}%
              </span>
            </button>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** 表格里可点的数字：点开看明细。 */
function useCell() {
  const pick = usePick();
  return (text: string, drill: ChartDrill, name: string) =>
    pick ? (
      <button
        type="button"
        aria-label={`查看明细：${name} ${text}`}
        className="cursor-pointer tabular-nums hover:text-accent hover:underline"
        onClick={() => pick(drill)}
      >
        {text}
      </button>
    ) : (
      text
    );
}

/** 数据表：分组为行，系列（二级分组或指标）为列；二级分组时最后一列合计。 */
function DataTable({ data, label }: { data: ChartData; label: string }) {
  const cell = useCell();
  const multi = data.series.length > 1;
  const sumColumn = multi && !data.series.some((s) => isMetricSeries(s.key));
  return (
    <div className="max-h-72 overflow-auto">
      <table aria-label={label} className="w-full text-sm">
        <thead className="sticky top-0 bg-surface text-left text-xs text-fg-muted">
          <tr className="border-b border-line-subtle">
            <th className="h-8 font-normal">分组</th>
            {data.series.map((s) => (
              <th key={s.key} className="text-right font-normal">
                {s.label}
              </th>
            ))}
            {sumColumn && <th className="text-right font-normal">合计</th>}
          </tr>
        </thead>
        <tbody>
          {data.groups.map((g, i) => (
            <tr key={g.key} className="border-b border-line-subtle last:border-0">
              <td className="h-8">{g.label}</td>
              {data.series.map((s) => (
                <td key={s.key} className="text-right tabular-nums">
                  {cell(
                    fmt(s.values[i] ?? 0),
                    { group: g.key, series: s.key },
                    multi ? `${g.label} ${s.label}` : g.label,
                  )}
                </td>
              ))}
              {sumColumn && (
                <td className="text-right tabular-nums">
                  {cell(
                    fmt(data.series.reduce((a, s) => a + (s.values[i] ?? 0), 0)),
                    { group: g.key },
                    `${g.label} 合计`,
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 透视表：行维度（第二层缩进，第一层行就是小计）× 列维度 × 指标，最后一列和最后一行是合计。
 * 每格都能点开看明细。
 */
function PivotTable({ pivot, label }: { pivot: PivotData; label: string }) {
  const cell = useCell();
  const M = pivot.metrics.length;
  const cols = [...pivot.columns, { key: "__total__", label: "合计" }];
  const hasCols = pivot.columns.length > 0;
  const twoHeaders = hasCols && M > 1;
  const drillOf = (row: { group?: string; group2?: string } | null, c: number) => ({
    ...(row?.group && { group: row.group }),
    ...(row?.group2 && { group2: row.group2 }),
    ...(hasCols && c < pivot.columns.length && { series: pivot.columns[c]?.key }),
  });
  const head = (c: number, m: number) =>
    [hasCols ? cols[c]?.label : "", M > 1 || !hasCols ? pivot.metrics[m] : ""].filter(Boolean).join(" ");
  const valuesRow = (values: number[], row: { group?: string; group2?: string } | null, rowLabel: string) =>
    cols.map((col, c) =>
      pivot.metrics.map((metric, m) => (
        <td
          key={`${col.key}-${metric}`}
          className={cn("px-2 text-right tabular-nums", c === cols.length - 1 && hasCols && "bg-raised/60")}
        >
          {cell(fmt(values[c * M + m] ?? 0), drillOf(row, c), `${rowLabel} ${head(c, m)}`)}
        </td>
      )),
    );
  return (
    <div className="max-h-80 overflow-auto">
      <table aria-label={label} className="w-full text-sm">
        <thead className="sticky top-0 z-[1] bg-surface text-xs text-fg-muted">
          <tr className="border-b border-line-subtle">
            <th rowSpan={twoHeaders ? 2 : 1} className="h-8 pr-2 text-left font-normal">
              分组
            </th>
            {twoHeaders
              ? cols.map((c) => (
                  <th key={c.key} colSpan={M} className="border-l border-line-subtle px-2 text-center font-normal">
                    {c.label}
                  </th>
                ))
              : cols.flatMap((c, ci) =>
                  pivot.metrics.map((m, mi) => (
                    <th key={`${c.key}-${m}`} className="px-2 text-right font-normal">
                      {head(ci, mi)}
                    </th>
                  )),
                )}
          </tr>
          {twoHeaders && (
            <tr className="border-b border-line-subtle">
              {cols.map((c) =>
                pivot.metrics.map((m) => (
                  <th key={`${c.key}-${m}`} className="h-7 px-2 text-right font-normal">
                    {m}
                  </th>
                )),
              )}
            </tr>
          )}
        </thead>
        <tbody>
          {pivot.rows.map((r) => (
            <tr
              key={`${r.group}-${r.group2 ?? ""}`}
              className={cn("border-b border-line-subtle", r.subtotal && "bg-raised/40 font-medium")}
            >
              <td className={cn("h-8 pr-2", r.level === 1 && "pl-5 text-fg-muted")}>
                {r.label}
                {r.subtotal && <span className="ml-1.5 text-xs font-normal text-fg-subtle">小计</span>}
              </td>
              {valuesRow(r.values, r, r.label)}
            </tr>
          ))}
          <tr className="font-medium">
            <td className="h-8 pr-2">合计</td>
            {valuesRow(pivot.total, null, "合计")}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
