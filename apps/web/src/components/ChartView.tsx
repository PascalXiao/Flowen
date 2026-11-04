import type { ChartData, ChartDrill, ChartKind } from "@fp/engine";
import { createContext, useContext, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 分类配色：固定顺序，按系列出现的先后取色，不循环；超过 8 个系列合并成「其他」。
 * 这组颜色用配色校验脚本检查过（相邻色的色盲区分度、正常视力区分度）。只有一个系列时用品牌蓝。
 */
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const MAX_SERIES = PALETTE.length;
const SINGLE_COLOR = "var(--semi-color-primary)";

/** 点图上的一格时回调（钻取看明细）；没有时图只能看不能点。 */
const PickContext = createContext<((drill: ChartDrill) => void) | null>(null);
const usePick = () => useContext(PickContext);

const fmt = (n: number) => n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

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

function Legend({ series, colors }: { series: ChartData["series"]; colors: string[] }) {
  return (
    <ul aria-label="图例" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
      {series.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: colors[i] }} />
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
  rows: { label: string; value: number; color: string }[];
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
          <span className="ml-auto pl-3 tabular-nums">{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** 一张图：按样式画柱状、条形、折线、面积、环形、指标卡或数据表。 */
export function ChartView({
  data,
  kind,
  label,
  className,
  onPick,
}: {
  data: ChartData;
  kind: ChartKind;
  label: string;
  className?: string;
  onPick?: (drill: ChartDrill) => void;
}) {
  return (
    <PickContext.Provider value={onPick ?? null}>
      <ChartBody data={data} kind={kind} label={label} className={className} />
    </PickContext.Provider>
  );
}

function ChartBody({
  data,
  kind,
  label,
  className,
}: {
  data: ChartData;
  kind: ChartKind;
  label: string;
  className?: string;
}) {
  const series = capSeries(data.series);
  const colors = series.length === 1 ? [SINGLE_COLOR] : series.map((_, i) => PALETTE[i] ?? "#888");
  if (kind === "indicator") return <Indicator data={data} label={label} />;
  if (data.count === 0 || data.groups.length === 0)
    return <p className="py-10 text-center text-sm text-fg-subtle">暂无数据</p>;
  if (kind === "table") return <DataTable data={{ ...data, series }} label={label} />;
  if (kind === "ring") return <Ring data={data} label={label} />;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {series.length > 1 && <Legend series={series} colors={colors} />}
      {kind === "bar" ? (
        <Bars data={{ ...data, series }} colors={colors} label={label} />
      ) : kind === "column" ? (
        <Columns data={{ ...data, series }} colors={colors} label={label} />
      ) : (
        <Lines data={{ ...data, series }} colors={colors} label={label} area={kind === "area"} />
      )}
    </div>
  );
}

/** 指标卡：一个大数字，下面是参与计算的工作项数。 */
function Indicator({ data, label }: { data: ChartData; label: string }) {
  const pick = usePick();
  const value = <span className="text-4xl font-semibold tabular-nums">{fmt(data.total)}</span>;
  return (
    <figure aria-label={label} className="flex flex-col items-start gap-1 py-4">
      {pick ? (
        <button
          type="button"
          aria-label={`查看明细：${fmt(data.total)}`}
          className="cursor-pointer rounded hover:text-brand-500"
          onClick={() => pick({})}
        >
          {value}
        </button>
      ) : (
        value
      )}
      <figcaption className="text-xs text-fg-subtle">共 {data.count} 个工作项</figcaption>
    </figure>
  );
}

/** 纵轴刻度和网格线。 */
function Grid({ top }: { top: number }) {
  return (
    <>
      {[top, top / 2, 0].map((t) => (
        <div
          key={t}
          className="absolute right-0 left-10 border-t border-line-subtle"
          style={{ top: `${(1 - t / top) * 100}%` }}
        >
          <span className="absolute -top-2 -left-10 w-8 text-right text-[11px] tabular-nums text-fg-subtle">
            {fmt(t)}
          </span>
        </div>
      ))}
    </>
  );
}

/** 柱状图（多个系列时堆叠），悬停整列显示提示。 */
function Columns({ data, colors, label }: { data: ChartData; colors: string[]; label: string }) {
  const pick = usePick();
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.groups.map((_, i) => data.series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0));
  const top = niceMax(Math.max(...totals));
  return (
    <div className="flex flex-col gap-1">
      <figure aria-label={label} className="relative flex h-52 items-end gap-1.5 pl-10">
        <Grid top={top} />
        {data.groups.map((g, i) => (
          <button
            type="button"
            key={g.key}
            aria-label={`${g.label}：${data.series.map((s) => `${s.label} ${fmt(s.values[i] ?? 0)}`).join("，")}`}
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
            {/* 堆叠段之间留 2px 表面色的缝；顶端圆角 */}
            <div
              className={cn("mx-auto flex w-full max-w-12 flex-col-reverse gap-[2px]", hover === i && "opacity-85")}
              style={{ height: `${((totals[i] ?? 0) / top) * 100}%` }}
            >
              {data.series.map((s, k) => {
                const v = Math.max(0, s.values[i] ?? 0);
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
            {hover === i && (
              <Tooltip
                title={g.label}
                rows={data.series.map((s, k) => ({ label: s.label, value: s.values[i] ?? 0, color: colors[k] ?? "" }))}
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

/** 条形图：横向，标签在左，多个系列时堆叠；单系列时条尾标数值。 */
function Bars({ data, colors, label }: { data: ChartData; colors: string[]; label: string }) {
  const pick = usePick();
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.groups.map((_, i) => data.series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  return (
    <ul aria-label={label} className="flex flex-col">
      {data.groups.map((g, i) => (
        <li key={g.key} className="relative">
          <button
            type="button"
            aria-label={`${g.label}：${data.series.map((s) => `${s.label} ${fmt(s.values[i] ?? 0)}`).join("，")}`}
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
            <span className="flex items-center gap-2">
              <span className="flex h-4 gap-[2px]" style={{ width: `${((totals[i] ?? 0) / max) * 80}%`, minWidth: 2 }}>
                {data.series.map((s, k) => {
                  const v = Math.max(0, s.values[i] ?? 0);
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
              <span className="text-sm tabular-nums">{fmt(totals[i] ?? 0)}</span>
            </span>
          </button>
          {hover === i && data.series.length > 1 && (
            <Tooltip
              title={g.label}
              rows={data.series.map((s, k) => ({ label: s.label, value: s.values[i] ?? 0, color: colors[k] ?? "" }))}
              style={{ top: "100%", left: "8rem" }}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** 折线图、面积图：每个系列一条 2px 线，悬停显示竖线和这一点各系列的值。 */
function Lines({ data, colors, label, area }: { data: ChartData; colors: string[]; label: string; area: boolean }) {
  const pick = usePick();
  const [hover, setHover] = useState<number | null>(null);
  const top = niceMax(Math.max(...data.series.flatMap((s) => s.values)));
  const n = data.groups.length;
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - (v / top) * 100;
  return (
    <div className="flex flex-col gap-1">
      <figure aria-label={label} className="relative h-52 pl-10">
        <Grid top={top} />
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
          {/* 悬停区：每个分组一条竖带 */}
          <div className="absolute inset-0 flex">
            {data.groups.map((g, i) => (
              <button
                type="button"
                key={g.key}
                aria-label={`${g.label}：${data.series.map((s) => `${s.label} ${fmt(s.values[i] ?? 0)}`).join("，")}`}
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
                value: s.values[hover] ?? 0,
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
  const colors = groups.map((_, i) => PALETTE[i] ?? "#888");
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

/** 数据表：分组为行，系列为列（只有一个系列时就是一列值），最后一行合计。 */
function DataTable({ data, label }: { data: ChartData; label: string }) {
  const pick = usePick();
  const multi = data.series.length > 1;
  const cell = (text: string, drill: ChartDrill, name: string) =>
    pick ? (
      <button
        type="button"
        aria-label={`查看明细：${name} ${text}`}
        className="cursor-pointer tabular-nums hover:text-brand-500 hover:underline"
        onClick={() => pick(drill)}
      >
        {text}
      </button>
    ) : (
      text
    );
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
            {multi && <th className="text-right font-normal">合计</th>}
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
              {multi && (
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
