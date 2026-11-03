import type { Day, NodeState, WorkCalendar } from "@fp/engine";
import { dayToIso } from "@fp/engine";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";

export interface GanttRow {
  key: string;
  label: string;
  start: Day;
  end: Day;
  state: NodeState;
  /** 手动定过日期。 */
  pinned: boolean;
  /** 0 天的节点画成菱形。 */
  milestone: boolean;
  actualStart: Day | null;
  actualEnd: Day | null;
  /** 当前用户能不能拖动它。 */
  editable: boolean;
  /** 缩进层级：空间甘特图里节点行挂在工作项行下面。 */
  depth?: number;
  /** 汇总行（工作项）：画成两端带角的细条，可以展开收起。 */
  summary?: boolean;
  expanded?: boolean;
}

const ROW = 30;
const HEADER = 44;
const LABEL_WIDTH = 220;
const DAY_WIDTH = 26;
const HANDLE = 6;

/** Canvas 画不了 CSS 变量，绘制时从主题变量里取实际颜色（换主题、切暗色都跟着变）。 */
function themeColors() {
  const css = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    grid: v("--semi-color-border", "#eff0f1"),
    weekend: v("--semi-color-fill-0", "#f5f6f7"),
    text: v("--semi-color-text-0", "#1f2329"),
    muted: v("--semi-color-text-2", "#8f959e"),
    today: v("--semi-color-danger", "#f54a45"),
    dep: v("--semi-color-disabled-text", "#bbbfc4"),
    actual: v("--semi-color-success-hover", "#2ea121"),
    bar: {
      notStarted: v("--semi-color-disabled-text", "#bbbfc4"),
      inProgress: v("--semi-color-primary", "#3370ff"),
      completed: v("--semi-color-success", "#34c724"),
      skipped: v("--semi-color-fill-1", "#eff0f1"),
    } as Record<NodeState, string>,
    pinned: v("--semi-color-text-0", "#1f2329"),
  };
}

type Drag = { key: string; mode: "move" | "resize"; originX: number; delta: number };

/**
 * 工作项的甘特图。Canvas 绘制，几十到上千行都不卡；左侧名称列是普通 DOM，方便选中和读屏。
 * 拖动横条整体平移，拖右边缘改结束日期，松手时回调 onChange。
 */
export function GanttChart({
  rows,
  deps,
  calendar,
  today,
  onChange,
  onToggle,
  labelTitle = "节点",
}: {
  rows: GanttRow[];
  deps: { from: string; to: string }[];
  calendar: WorkCalendar;
  today: Day;
  onChange: (key: string, start: Day, end: Day) => void;
  onToggle?: (key: string) => void;
  labelTitle?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLCanvasElement>(null);
  const body = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState("default");

  const range = useMemo(() => {
    const days = rows.flatMap((r) => [r.start, r.end, r.actualEnd ?? r.start]);
    const first = Math.min(today, ...days) - 3;
    const last = Math.max(today, ...days) + 14;
    return { first, count: last - first + 1 };
  }, [rows, today]);
  const width = range.count * DAY_WIDTH;
  const height = rows.length * ROW;
  const x = (day: Day) => (day - range.first) * DAY_WIDTH;

  /** 拖动中的行用预览日期。 */
  const spanOf = (row: GanttRow) => {
    if (drag?.key !== row.key || drag.delta === 0) return { start: row.start, end: row.end };
    return drag.mode === "move"
      ? { start: row.start + drag.delta, end: row.end + drag.delta }
      : { start: row.start, end: Math.max(row.start, row.end + drag.delta) };
  };

  useEffect(() => {
    const COLORS = themeColors();
    const ratio = window.devicePixelRatio || 1;
    const setup = (canvas: HTMLCanvasElement | null, h: number) => {
      if (!canvas) return null;
      canvas.width = width * ratio;
      canvas.height = h * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
      return ctx;
    };

    const top = setup(header.current, HEADER);
    if (top) {
      top.clearRect(0, 0, width, HEADER);
      top.font = "11px system-ui, sans-serif";
      top.textBaseline = "middle";
      for (let i = 0; i < range.count; i++) {
        const day = range.first + i;
        const iso = dayToIso(day);
        const [, month, date] = iso.split("-");
        if (!calendar.isWorkday(day)) {
          top.fillStyle = COLORS.weekend;
          top.fillRect(i * DAY_WIDTH, HEADER / 2, DAY_WIDTH, HEADER / 2);
        }
        if (date === "01" || i === 0) {
          top.fillStyle = COLORS.text;
          top.fillText(`${Number(month)} 月`, i * DAY_WIDTH + 4, HEADER / 4);
        }
        top.fillStyle = day === today ? COLORS.today : COLORS.muted;
        top.textAlign = "center";
        top.fillText(String(Number(date)), i * DAY_WIDTH + DAY_WIDTH / 2, (HEADER * 3) / 4);
        top.textAlign = "start";
      }
      top.strokeStyle = COLORS.grid;
      top.beginPath();
      top.moveTo(0, HEADER - 0.5);
      top.lineTo(width, HEADER - 0.5);
      top.stroke();
    }

    const ctx = setup(body.current, height);
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < range.count; i++)
      if (!calendar.isWorkday(range.first + i)) {
        ctx.fillStyle = COLORS.weekend;
        ctx.fillRect(i * DAY_WIDTH, 0, DAY_WIDTH, height);
      }
    ctx.strokeStyle = COLORS.grid;
    for (let r = 1; r <= rows.length; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * ROW - 0.5);
      ctx.lineTo(width, r * ROW - 0.5);
      ctx.stroke();
    }

    const index = new Map(rows.map((r, i) => [r.key, i]));
    // 依赖线：前序横条的末端 → 后续横条的开头
    ctx.strokeStyle = COLORS.dep;
    for (const { from, to } of deps) {
      const a = index.get(from);
      const b = index.get(to);
      if (a === undefined || b === undefined) continue;
      const sa = spanOf(rows[a] as GanttRow);
      const sb = spanOf(rows[b] as GanttRow);
      const x1 = x(sa.end + 1);
      const y1 = a * ROW + ROW / 2;
      const x2 = x(sb.start);
      const y2 = b * ROW + ROW / 2;
      const bend = x1 + 6;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(bend, y1);
      ctx.lineTo(bend, y2);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - 4, y2 - 3);
      ctx.lineTo(x2 - 4, y2 + 3);
      ctx.fillStyle = COLORS.dep;
      ctx.fill();
    }

    rows.forEach((row, i) => {
      const { start, end } = spanOf(row);
      const y = i * ROW;
      ctx.fillStyle = COLORS.bar[row.state];
      if (row.summary) {
        // 汇总条：上方细条加两端向下的角
        const bx = x(start) + 1;
        const bw = (end - start + 1) * DAY_WIDTH - 2;
        ctx.fillRect(bx, y + 9, bw, 6);
        for (const tip of [bx, bx + bw]) {
          ctx.beginPath();
          ctx.moveTo(tip - (tip === bx ? 0 : 6), y + 15);
          ctx.lineTo(tip + (tip === bx ? 6 : 0), y + 15);
          ctx.lineTo(tip, y + 21);
          ctx.closePath();
          ctx.fill();
        }
      } else if (row.milestone) {
        const cx = x(start) + DAY_WIDTH / 2;
        const cy = y + ROW / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 7);
        ctx.lineTo(cx + 7, cy);
        ctx.lineTo(cx, cy + 7);
        ctx.lineTo(cx - 7, cy);
        ctx.closePath();
        ctx.fill();
      } else {
        const bx = x(start) + 1;
        const bw = (end - start + 1) * DAY_WIDTH - 2;
        ctx.beginPath();
        ctx.roundRect(bx, y + 7, bw, ROW - 16, 4);
        ctx.fill();
        if (row.pinned) {
          ctx.strokeStyle = COLORS.pinned;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.lineWidth = 1;
        }
      }
      // 实际进度：横条下方的细线，进行中的画到今天
      if (row.actualStart !== null) {
        const until = row.actualEnd ?? (row.state === "inProgress" ? today : null);
        if (until !== null) {
          ctx.fillStyle = COLORS.actual;
          ctx.fillRect(x(row.actualStart) + 1, y + ROW - 7, (until - row.actualStart + 1) * DAY_WIDTH - 2, 3);
        }
      }
    });

    ctx.strokeStyle = COLORS.today;
    ctx.beginPath();
    ctx.moveTo(x(today) + DAY_WIDTH / 2, 0);
    ctx.lineTo(x(today) + DAY_WIDTH / 2, height);
    ctx.stroke();
  });

  // 打开（或数据第一次到达）时把今天滚到左侧附近
  const hasRows = rows.length > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在有数据后定位一次
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, (today - range.first - 3) * DAY_WIDTH);
  }, [hasRows]);

  function hit(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const row = rows[Math.floor((event.clientY - rect.top) / ROW)];
    if (!row?.editable || row.milestone || row.summary) return null;
    const left = x(row.start);
    const right = x(row.end + 1);
    if (px < left || px > right) return null;
    return { row, mode: px > right - HANDLE ? ("resize" as const) : ("move" as const) };
  }

  return (
    <div ref={scroller} className="h-full overflow-auto">
      {/* 用 flex 而不是 grid：grid 单元格会把 sticky 限制在本列里，横向滚动时名称列会被滚走 */}
      <div style={{ width: LABEL_WIDTH + width }}>
        <div className="sticky top-0 z-20 flex bg-surface">
          <div
            className="sticky left-0 z-30 flex shrink-0 items-end border-r border-b border-line-subtle bg-surface px-3 pb-2 text-xs text-fg-muted"
            style={{ width: LABEL_WIDTH, height: HEADER }}
          >
            {labelTitle}
          </div>
          <canvas ref={header} className="shrink-0" />
        </div>
        <div className="flex">
          <ol
            className="sticky left-0 z-10 shrink-0 border-r border-line-subtle bg-surface"
            style={{ width: LABEL_WIDTH }}
          >
            {rows.map((row) => (
              <li
                key={row.key}
                className="flex items-center gap-1 truncate border-b border-line-subtle pr-3 text-xs"
                style={{ height: ROW, paddingLeft: 12 + (row.depth ?? 0) * 16 }}
                title={row.label}
              >
                {row.summary && onToggle ? (
                  <button
                    type="button"
                    aria-expanded={row.expanded ?? false}
                    className="flex min-w-0 items-center gap-1 font-medium hover:text-brand-600"
                    onClick={() => onToggle(row.key)}
                  >
                    <span className="w-3 shrink-0 text-fg-subtle">{row.expanded ? "▾" : "▸"}</span>
                    <span className="truncate">{row.label}</span>
                  </button>
                ) : (
                  <span className="truncate">{row.label}</span>
                )}
                {row.pinned && <span className="shrink-0 text-[10px] text-fg-subtle">手动</span>}
              </li>
            ))}
          </ol>
          <canvas
            ref={body}
            role="img"
            aria-label="甘特图"
            data-first-day={range.first}
            style={{ cursor: drag ? (drag.mode === "move" ? "grabbing" : "ew-resize") : cursor, touchAction: "none" }}
            onPointerDown={(event) => {
              const target = hit(event);
              if (!target) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setDrag({ key: target.row.key, mode: target.mode, originX: event.clientX, delta: 0 });
            }}
            onPointerMove={(event) => {
              if (drag) {
                const delta = Math.round((event.clientX - drag.originX) / DAY_WIDTH);
                if (delta !== drag.delta) setDrag({ ...drag, delta });
                return;
              }
              const target = hit(event);
              setCursor(target ? (target.mode === "move" ? "grab" : "ew-resize") : "default");
            }}
            onPointerUp={() => {
              if (!drag) return;
              const row = rows.find((r) => r.key === drag.key);
              setDrag(null);
              if (!row || drag.delta === 0) return;
              const { start, end } =
                drag.mode === "move"
                  ? { start: row.start + drag.delta, end: row.end + drag.delta }
                  : { start: row.start, end: Math.max(row.start, row.end + drag.delta) };
              onChange(row.key, start, end);
            }}
            onPointerCancel={() => setDrag(null)}
            className="shrink-0"
          />
        </div>
      </div>
    </div>
  );
}

export const GANTT_LAYOUT = { ROW, HEADER, LABEL_WIDTH, DAY_WIDTH };
