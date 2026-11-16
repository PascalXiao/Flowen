// biome-ignore-all lint/a11y/useSemanticElements: 虚拟滚动要把每一行单独绝对定位，<table> 的行做不到，只能用 div 加 ARIA 角色
// biome-ignore-all lint/a11y/useFocusableInteractive: 键盘焦点落在格子里的链接、勾选框和按钮上，行和格子本身不用能聚焦
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** 表格的一列。frozen 的列要排在最前面，横向滚动时固定在左边。 */
export interface GridColumn<T> {
  key: string;
  header: ReactNode;
  width: number;
  frozen?: boolean;
  /** 设了就能拖表头右边缘改列宽，松手时回调新宽度。 */
  onResize?: (width: number) => void;
  cell: (row: T, index: number) => ReactNode;
}

/** 表体的一行：工作项，或分组的标题行。index 是工作项在全部行里的下标。 */
export type GridRow<T> =
  | { kind: "item"; item: T; index: number }
  | { kind: "group"; key: string; label: ReactNode; count: number };

const SELECT_WIDTH = 40;
const GROUP_HEIGHT = 34;
const HEADER_HEIGHT = 36;

/**
 * 工作项表格：表头和底部汇总吸附，名称等冻结列吸附在左边，行按需渲染（几千行也只画看得见的几十行）。
 * 行的底色用 --row-tint 叠在表面色上，冻结列和普通列的底色一致，悬停、勾选、着色都只改这一个变量。
 */
export function ListGrid<T extends { id: string }>({
  label,
  columns,
  rows,
  rowHeight,
  compact = false,
  selected,
  onSelect,
  rowTint,
  footer,
  empty,
}: {
  label: string;
  columns: GridColumn<T>[];
  rows: GridRow<T>[];
  rowHeight: number;
  compact?: boolean;
  selected: readonly string[];
  onSelect: (ids: string[]) => void;
  rowTint?: (item: T) => string | undefined;
  /** 底部汇总行：每列下面放什么。 */
  footer?: { label: string; cell: (key: string) => ReactNode };
  empty?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // 拖列宽时先只改本地，松手再存
  const [drag, setDrag] = useState<{ key: string; width: number } | null>(null);

  const visible = useMemo(() => {
    const out: GridRow<T>[] = [];
    let hidden = false;
    for (const r of rows) {
      if (r.kind === "group") {
        hidden = collapsed.has(r.key);
        out.push(r);
      } else if (!hidden) out.push(r);
    }
    return out;
  }, [rows, collapsed]);
  const items = useMemo(() => rows.flatMap((r) => (r.kind === "item" ? [r.item.id] : [])), [rows]);

  const widthOf = (c: GridColumn<T>) => (drag?.key === c.key ? drag.width : c.width);
  const layout = useMemo(() => {
    let left = SELECT_WIDTH;
    let lastFrozen = -1;
    const out = columns.map((c, i) => {
      const width = drag?.key === c.key ? drag.width : c.width;
      const at = c.frozen ? left : undefined;
      if (c.frozen) {
        left += width;
        lastFrozen = i;
      }
      return { col: c, width, left: at };
    });
    return { cols: out, lastFrozen, total: SELECT_WIDTH + out.reduce((s, c) => s + c.width, 0) };
  }, [columns, drag]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (visible[i]?.kind === "group" ? GROUP_HEIGHT : rowHeight),
    overscan: 12,
  });
  // 行高换了要重新排
  // biome-ignore lint/correctness/useExhaustiveDependencies: rowHeight 和 visible 变了才需要重新量
  useEffect(() => virtualizer.measure(), [rowHeight, visible, virtualizer]);

  const chosen = new Set(selected);
  const allChosen = items.length > 0 && items.every((id) => chosen.has(id));
  const someChosen = items.some((id) => chosen.has(id));

  const pad = compact ? "px-2" : "px-3";
  const cellBase = "flex shrink-0 items-center overflow-hidden border-b border-line-subtle";
  const frozenStyle = (left: number | undefined): CSSProperties | undefined =>
    left === undefined ? undefined : { position: "sticky", left, zIndex: 1 };
  const edge = (i: number) => i === layout.lastFrozen && "shadow-[inset_-1px_0_0_var(--fl-line)]";
  // 单元格自己画底色：表面色打底，上面叠一层 --row-tint
  const paint = "bg-surface bg-[linear-gradient(var(--row-tint),var(--row-tint))]";

  function startResize(e: React.PointerEvent, c: GridColumn<T>) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthOf(c);
    let width = startWidth;
    const move = (ev: PointerEvent) => {
      width = Math.max(60, Math.round(startWidth + ev.clientX - startX));
      setDrag({ key: c.key, width });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (width !== startWidth) c.onResize?.(width);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const rowStyle = { width: layout.total, minWidth: "100%" };

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={label}
      aria-rowcount={items.length + 1}
      aria-multiselectable
      className="relative max-h-[calc(100dvh-240px)] min-h-[180px] overflow-auto rounded-lg border border-line-subtle text-sm [--row-tint:transparent]"
    >
      {/* 表头 */}
      <div role="rowgroup" className="sticky top-0 z-[3]" style={rowStyle}>
        <div role="row" className="flex text-fg-muted" style={{ height: HEADER_HEIGHT }}>
          <div
            role="columnheader"
            tabIndex={-1}
            data-frozen
            className={cn(cellBase, paint, "justify-center border-line")}
            style={{ width: SELECT_WIDTH, ...frozenStyle(0) }}
          >
            <Checkbox
              aria-label="全选"
              checked={allChosen}
              indeterminate={someChosen}
              disabled={items.length === 0}
              onChange={(e) => onSelect(e.target.checked ? items : [])}
            />
          </div>
          {layout.cols.map(({ col, width, left }, i) => (
            <div
              key={col.key}
              role="columnheader"
              data-frozen={col.frozen || undefined}
              className={cn(cellBase, paint, pad, "group/th relative border-line font-medium", edge(i))}
              style={{ width, ...frozenStyle(left) }}
            >
              <span className="min-w-0 truncate">{col.header}</span>
              {col.onResize && (
                <span
                  aria-hidden
                  onPointerDown={(e) => startResize(e, col)}
                  className="absolute inset-y-0 -right-1 z-[2] w-2 cursor-col-resize after:absolute after:inset-y-2 after:left-[3px] after:w-0.5 after:rounded after:bg-accent after:opacity-0 hover:after:opacity-100 group-hover/th:after:opacity-40"
                />
              )}
            </div>
          ))}
          <div aria-hidden className={cn(cellBase, paint, "flex-1 border-line")} />
        </div>
      </div>

      {/* 表体：只渲染看得见的行 */}
      <div role="rowgroup" className="relative" style={{ ...rowStyle, height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const r = visible[v.index];
          if (!r) return null;
          const place: CSSProperties = { position: "absolute", top: 0, transform: `translateY(${v.start}px)` };
          if (r.kind === "group") {
            const open = !collapsed.has(r.key);
            return (
              <div key={`g:${r.key}`} role="row" className="flex w-full" style={{ ...place, height: GROUP_HEIGHT }}>
                <div role="gridcell" aria-colspan={columns.length + 1} className={cn(cellBase, "flex-1 bg-raised")}>
                  <button
                    type="button"
                    aria-expanded={open}
                    className={cn("sticky left-0 flex h-full items-center gap-1.5 font-medium text-fg", pad)}
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (open) next.add(r.key);
                        else next.delete(r.key);
                        return next;
                      })
                    }
                  >
                    <ChevronRight className={cn("size-3.5 text-fg-subtle transition-transform", open && "rotate-90")} />
                    {r.label}
                    <span className="font-normal text-fg-subtle tabular-nums">{r.count}</span>
                  </button>
                </div>
              </div>
            );
          }
          const isOn = chosen.has(r.item.id);
          const tint = rowTint?.(r.item);
          return (
            <div
              key={r.item.id}
              role="row"
              aria-selected={isOn}
              className={cn(
                "flex w-full",
                isOn ? "[--row-tint:var(--fl-accent-soft)]" : !tint && "hover:[--row-tint:var(--fl-hover)]",
              )}
              style={{ ...place, height: rowHeight, ...(tint && !isOn && ({ "--row-tint": tint } as CSSProperties)) }}
            >
              <div
                role="gridcell"
                tabIndex={-1}
                className={cn(cellBase, paint, "justify-center")}
                style={{ width: SELECT_WIDTH, ...frozenStyle(0) }}
              >
                <Checkbox
                  aria-label={`选择第 ${r.index + 1} 行`}
                  checked={isOn}
                  onChange={(e) =>
                    onSelect(e.target.checked ? [...selected, r.item.id] : selected.filter((id) => id !== r.item.id))
                  }
                />
              </div>
              {layout.cols.map(({ col, width, left }, i) => (
                <div
                  key={col.key}
                  role="gridcell"
                  className={cn(cellBase, paint, pad, edge(i))}
                  style={{ width, ...frozenStyle(left) }}
                >
                  {col.cell(r.item, r.index)}
                </div>
              ))}
              <div aria-hidden className={cn(cellBase, paint, "flex-1")} />
            </div>
          );
        })}
      </div>

      {items.length === 0 && empty && <div className="sticky left-0 flex w-full justify-center py-10">{empty}</div>}

      {/* 底部汇总：吸在表格底部，横向跟着表格滚 */}
      {footer && items.length > 0 && (
        <div
          role="group"
          aria-label={footer.label}
          className="sticky bottom-0 z-[3] flex text-fg-muted"
          style={{ ...rowStyle, height: HEADER_HEIGHT }}
        >
          <div
            className={cn(cellBase, paint, "border-t border-b-0 border-line")}
            style={{ width: SELECT_WIDTH, ...frozenStyle(0) }}
          />
          {layout.cols.map(({ col, width, left }, i) => (
            <div
              key={col.key}
              className={cn(cellBase, paint, compact ? "px-1" : "px-2", "border-t border-b-0 border-line", edge(i))}
              style={{ width, ...frozenStyle(left) }}
            >
              {footer.cell(col.key)}
            </div>
          ))}
          <div className={cn(cellBase, paint, "flex-1 border-t border-b-0 border-line")} />
        </div>
      )}
    </div>
  );
}
