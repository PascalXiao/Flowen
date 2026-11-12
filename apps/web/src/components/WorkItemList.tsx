import { Checkbox, Dropdown, Popover, Input as SemiInput, Table, Toast } from "@douyinfe/semi-ui";
import { type Condition, conditionFields, evaluate, PASTEABLE_FIELD_TYPES, parseFieldText } from "@fp/engine";
import { mutators, queries, type WorkItemFilterArgs } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { ArrowDownUp, Download, Group, Palette, Pin, Plus, Rows3, Search, Star, Trash2, X } from "lucide-react";
import { type ClipboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { BatchBar } from "@/components/BatchBar";
import { ConditionEditor, type ConditionField } from "@/components/ConditionEditor";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page";
import { env } from "@/lib/env";
import { exportListXlsx } from "@/lib/export-xlsx";
import { withLineOptions } from "@/lib/fields";
import {
  allColumns,
  cellText,
  columnSources,
  defaultColumnKeys,
  type ListColumn,
  type ListContext,
  type ListField,
  type ListItem,
  listNeeds,
} from "@/lib/list-columns";
import { foreignTypes, type RelDef } from "@/lib/relations";
import { cn } from "@/lib/utils";

/** 列表的显示设置：列、排序、分组、行着色（和视图里存的一样）。 */
export interface ListDisplay {
  columns?: { key: string; width?: number }[];
  sort?: { key: string; desc?: boolean }[];
  groupBy?: string | null;
  colors?: { when: Condition; color: string }[];
  /** 名称列之外再冻结前几列（横向滚动时固定在左边）。 */
  frozen?: number;
  /** 行高：低、中、高、超高。 */
  rowHeight?: "low" | "medium" | "high" | "xhigh";
  /** 底部汇总行：列键 → 统计方式。 */
  summary?: Record<string, SummaryKind>;
  /** 看板：泳道（creator、role:角色键、field:字段键）和卡片上显示的字段。 */
  board?: BoardDisplay;
}
export interface BoardDisplay {
  lanes?: string | null;
  cardFields?: string[];
}
type SummaryKind = "count" | "filled" | "empty" | "filledPct" | "sum" | "avg" | "max" | "min";
const SUMMARY_TEXT: Record<SummaryKind, string> = {
  count: "计数",
  filled: "已填写",
  empty: "未填写",
  filledPct: "已填写百分比",
  sum: "求和",
  avg: "平均值",
  max: "最大值",
  min: "最小值",
};
const ROW_HEIGHTS = { low: ["低", 36], medium: ["中", 52], high: ["高", 72], xhigh: ["超高", 96] } as const;
type RowHeight = keyof typeof ROW_HEIGHTS;
const SELECTION_WIDTH = 48;
type Cell = { r: number; c: number };

type Tab = "all" | "recent" | "created" | "involved" | "followed" | "starred";
const TABS: readonly (readonly [Tab, string])[] = [
  ["all", "全部"],
  ["recent", "最近浏览"],
  ["created", "我创建的"],
  ["involved", "我参与的"],
  ["followed", "我关注的"],
  ["starred", "我收藏的"],
];

const ROW_COLORS = [
  ["#fff3e0", "橙"],
  ["#e8f5e9", "绿"],
  ["#e3f2fd", "蓝"],
  ["#fce4ec", "红"],
  ["#f3e5f5", "紫"],
] as const;

type SpaceLike = {
  id: string;
  name: string;
  members: readonly { userId: string; user?: { name: string } | null | undefined }[];
  businessLines: readonly { id: string; name: string; parentId: string | null; disabled: boolean | null }[];
  workItemTypes: readonly {
    id: string;
    name: string;
    fields: readonly ListField[];
    roles: readonly { key: string; name: string }[];
    flowTemplates: readonly { currentVersion?: { definition: unknown } | null | undefined }[];
    relationDefs: readonly (RelDef & { toType?: ForeignTypeSource | null })[];
  }[];
  /** 别的空间指向本空间类型的跨空间关联。 */
  incomingRelationDefs?: readonly (RelDef & { fromType?: ForeignTypeSource | null })[];
};
type ForeignTypeSource = NonNullable<Parameters<typeof foreignTypes>[0]["incomingRelationDefs"]>[number]["fromType"];

/**
 * 工作项列表（表格）：页签（全部、最近浏览、我创建的…）、筛选之外的
 * 排序 / 分组 / 设置颜色 / 搜索，表头最右边的「+」随时加列，列宽可以拖，勾选后可以批量改字段、关注、收藏、终止和恢复。
 */
export function WorkItemList({
  space,
  filter,
  display,
  onDisplay,
  toolbar,
  onRows,
}: {
  space: SpaceLike;
  filter: WorkItemFilterArgs;
  display: ListDisplay;
  onDisplay: (display: ListDisplay) => void;
  /** 筛选栏（放在排序、分组前面）。 */
  toolbar: ReactNode;
  /** 当前显示的行（排序、搜索之后）的工作项 id，抽屉里切上一条、下一条用。 */
  onRows?: (ids: readonly string[]) => void;
}) {
  const zero = useZero();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  // 字段：筛了类型时只用这些类型的字段，同键字段合成一列；业务线字段补上空间的业务线树作为选项
  const fields = useMemo(() => {
    const map = new Map<string, ListField>();
    for (const t of space.workItemTypes) {
      if (filter.typeIds?.length && !filter.typeIds.includes(t.id)) continue;
      for (const f of withLineOptions(t.fields, space.businessLines))
        if (!map.has(f.key) && f.dataType !== "relation") map.set(f.key, f);
    }
    return map;
  }, [space, filter.typeIds]);
  const names = new Map(space.members.map((m) => [m.userId, m.user?.name ?? m.userId]));
  const ctx: ListContext = {
    fields,
    userName: (id) => names.get(id) ?? id,
    spaceName: space.name,
    typeName: (id) => space.workItemTypes.find((t) => t.id === id)?.name ?? "",
    ...columnSources(
      space.workItemTypes.filter((t) => !filter.typeIds?.length || filter.typeIds.includes(t.id)),
      // 跨空间关联另一端的类型也在里面：关联列、关联字段列要用它的字段
      [
        ...space.workItemTypes.map((t) => ({ ...t, fields: withLineOptions(t.fields, space.businessLines) })),
        ...foreignTypes(space).map((t) => ({ ...t, fields: t.fields as readonly ListField[] })),
      ],
    ),
  };
  const available = allColumns(ctx);
  const byKey = new Map(available.map((c) => [c.key, c]));
  const shown: { key: string; width?: number }[] = (
    display.columns ?? defaultColumnKeys(fields).map((key) => ({ key }))
  ).filter((c) => byKey.has(c.key));
  const setColumns = (columns: { key: string; width?: number }[]) => onDisplay({ ...display, columns });

  // 只同步要用的数据：显示的列、排序、分组、着色条件用到的字段、节点和关联
  const needs = listNeeds(
    [
      ...shown.map((c) => c.key),
      ...(display.sort ?? []).map((s) => s.key),
      ...(display.groupBy ? [display.groupBy] : []),
    ],
    (display.colors ?? []).flatMap((c) => conditionFields(c.when)),
  );
  // 只按创建、更新时间排序，不分组、不汇总时，排序在服务端做，一次加载 PAGE 条，往下点「加载更多」；
  // 其余情况要拿到全部行才能在前端排序、分组、汇总
  const sort = display.sort ?? [];
  const paged =
    tab !== "recent" &&
    !display.groupBy &&
    Object.keys(display.summary ?? {}).length === 0 &&
    sort.every((s) => SERVER_SORT.has(s.key));
  const keyword = useDebounced(search.trim(), 250);
  const [limit, setLimit] = useState(PAGE);
  const listArgs = {
    spaceId: space.id,
    filter,
    tab,
    needs,
    ...(keyword && { search: keyword }),
    ...(paged && {
      order: sort.map((s) => ({ key: s.key as "createdAt" | "updatedAt", desc: s.desc })),
    }),
  };
  const argsKey = JSON.stringify(listArgs);
  // 换了筛选、页签、排序、搜索时从第一批重新开始
  const [limitFor, setLimitFor] = useState(argsKey);
  if (limitFor !== argsKey) {
    setLimitFor(argsKey);
    setLimit(PAGE);
  }
  const [items, result] = useQuery(queries.workItems.list({ ...listArgs, ...(paged && { limit }) }));
  const more = paged && items.length >= limit;
  const stats = useListStats(space.id, filter.typeIds ?? [], items);

  // 排序（不在服务端排的）、着色、分组在已经同步下来的行上做
  const rows = useMemo(() => {
    let out = [...items];
    if (tab === "recent") out.sort((a, b) => (b.visits[0]?.visitedAt ?? 0) - (a.visits[0]?.visitedAt ?? 0));
    if (!paged)
      for (const s of [...sort].reverse()) {
        const col = byKey.get(s.key);
        if (!col) continue;
        out = [...out].sort((a, b) => {
          const x = col.value(a);
          const y = col.value(b);
          if (x === y) return 0;
          if (x === null) return 1;
          if (y === null) return -1;
          const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "zh");
          return s.desc ? -cmp : cmp;
        });
      }
    return out;
  }, [items, sort, tab, byKey, paged]);
  const rowKey = rows.map((r) => r.id).join(",");
  useEffect(() => {
    onRows?.(rowKey ? rowKey.split(",") : []);
  }, [rowKey, onRows]);
  const valuesOf = (i: ListItem) => Object.fromEntries(i.fieldValues.map((v) => [v.fieldKey, v.value]));
  const colorOf = (i: ListItem) =>
    display.colors?.find((c) => evaluate(c.when, { ...valuesOf(i), $stage: i.stage, $status: i.status }))?.color;
  const groupCol = display.groupBy ? byKey.get(display.groupBy) : undefined;

  const marks = (i: ListItem) => new Set(i.marks.map((m) => m.kind));

  const frozen = Math.min(display.frozen ?? 0, shown.length);
  const rowHeight: RowHeight = display.rowHeight ?? "low";

  // 单元格选区（行是 rows 里的下标，列是 shown 里的下标）：点选、Shift 点选扩成矩形，Ctrl+C 复制、Ctrl+V 粘贴
  const [sel, setSel] = useState<{ anchor: Cell; focus: Cell } | null>(null);
  const copied = useRef<{ text: string; keys: string[][]; values: unknown[][] } | null>(null);
  const rowIndex = new Map(rows.map((r, i) => [r.id, i]));
  const range = sel && {
    top: Math.min(sel.anchor.r, sel.focus.r),
    bottom: Math.max(sel.anchor.r, sel.focus.r),
    left: Math.min(sel.anchor.c, sel.focus.c),
    right: Math.max(sel.anchor.c, sel.focus.c),
  };
  const inRange = (r: number, c: number) =>
    !!range && r >= range.top && r <= range.bottom && c >= range.left && c <= range.right;
  const colAt = (c: number) => {
    const key = shown[c]?.key;
    return key ? byKey.get(key) : undefined;
  };
  const fieldValue = (item: ListItem, key: string) => item.fieldValues.find((v) => v.fieldKey === key)?.value ?? null;

  function onCopy(e: ClipboardEvent) {
    if (!range) return;
    e.preventDefault();
    const keys: string[][] = [];
    const values: unknown[][] = [];
    const lines: string[] = [];
    for (let r = range.top; r <= range.bottom; r++) {
      const item = rows[r];
      if (!item) continue;
      const k: string[] = [];
      const v: unknown[] = [];
      const t: string[] = [];
      for (let c = range.left; c <= range.right; c++) {
        const col = colAt(c);
        if (!col) continue;
        k.push(col.key);
        v.push(col.field ? fieldValue(item, col.field.key) : undefined);
        // 单元格里的换行和制表符会打乱表格，换成空格
        t.push(cellText(col, item).replace(/[\t\r\n]+/g, " "));
      }
      keys.push(k);
      values.push(v);
      lines.push(t.join("\t"));
    }
    const text = lines.join("\n");
    e.clipboardData.setData("text/plain", text);
    copied.current = { text, keys, values };
    Toast.info({ content: `已复制 ${lines.length * (range.right - range.left + 1)} 个单元格`, duration: 1.5 });
  }

  async function onPaste(e: ClipboardEvent) {
    if (!range) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const grid = text
      .replace(/\r?\n$/, "")
      .split(/\r?\n/)
      .map((line) => line.split("\t"));
    // 复制的是列表里同一列的单元格时直接用原值（选项、人员不用再按名字找）
    const own = copied.current?.text === text ? copied.current : null;
    // 只复制了一个单元格时填满整个选区，否则从选区左上角开始铺开
    const single = grid.length === 1 && grid[0]?.length === 1;
    const height = single ? range.bottom - range.top + 1 : grid.length;
    const width = single ? range.right - range.left + 1 : Math.max(...grid.map((l) => l.length));
    const jobs: Promise<string | null>[] = [];
    let skipped = 0;
    for (let dr = 0; dr < height; dr++) {
      const item = rows[range.top + dr];
      if (!item) break;
      const type = space.workItemTypes.find((t) => t.id === item.typeId);
      for (let dc = 0; dc < width; dc++) {
        const col = colAt(range.left + dc);
        if (!col) break;
        const sr = single ? 0 : dr;
        const sc = single ? 0 : dc;
        const source = grid[sr]?.[sc];
        if (source === undefined) continue;
        const field = col.field;
        if (
          !field ||
          !PASTEABLE_FIELD_TYPES.includes(field.dataType as never) ||
          !type?.fields.some((f) => f.key === field.key)
        ) {
          skipped++;
          continue;
        }
        let value: unknown;
        if (own && own.keys[sr]?.[sc] === col.key) value = own.values[sr]?.[sc];
        else {
          const parsed = parseFieldText(
            {
              name: field.name,
              dataType: field.dataType as never,
              options: field.options,
              config: field.config ?? null,
            },
            source,
            (name) => space.members.find((m) => (m.user?.name ?? m.userId) === name)?.userId,
          );
          if ("error" in parsed) {
            jobs.push(Promise.resolve(parsed.error));
            continue;
          }
          value = parsed.value;
        }
        if (JSON.stringify(value ?? null) === JSON.stringify(fieldValue(item, field.key))) continue;
        jobs.push(
          zero
            .mutate(
              mutators.fieldValue.set({ workItemId: item.id, fieldKey: field.key, value: (value ?? null) as never }),
            )
            .client.then((o) => (o.type === "error" ? `${item.name}：${o.error.message}` : null)),
        );
      }
    }
    const errors = (await Promise.all(jobs)).filter((x): x is string => x !== null);
    const done = jobs.length - errors.length;
    if (errors.length)
      Toast.warning({
        content: `粘贴了 ${done} 个单元格，${errors.length} 个没成功：${errors[0]}${errors.length > 1 ? " 等" : ""}`,
        duration: 4,
      });
    else if (done || skipped)
      Toast.success({
        content: `已粘贴 ${done} 个单元格${skipped ? `，${skipped} 个不能粘贴的单元格跳过了` : ""}`,
        duration: 2,
      });
  }

  const columns = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      width: 240,
      fixed: "left" as const,
      render: (_: unknown, item: ListItem) => (
        <span className="flex min-w-0 items-center gap-1.5">
          {/* 点名称在右侧抽屉里打开，列表留在后面，可以连续看 */}
          <Link
            className="min-w-0 truncate font-medium text-fg hover:text-brand-500"
            from="/spaces/$spaceId/$typeKey"
            to="."
            search={(prev) => ({ ...prev, item: item.id })}
          >
            {item.name}
          </Link>
          {marks(item).has("star") && <Star className="size-3.5 shrink-0 fill-warning-500 text-warning-500" />}
        </span>
      ),
    },
    ...shown.map((c, index) => {
      const col = byKey.get(c.key) as ListColumn;
      return {
        title: col.title,
        dataIndex: col.key,
        key: col.key,
        width: c.width ?? col.width,
        ...(index < frozen && { fixed: "left" as const }),
        render: (_: unknown, item: ListItem) => {
          const r = rowIndex.get(item.id) ?? -1;
          const selected = inRange(r, index);
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: 选中单元格用鼠标，复制粘贴走外层的键盘事件
            <div
              data-cell={col.title}
              data-selected={selected || undefined}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                const at = { r, c: index };
                setSel(e.shiftKey && sel ? { anchor: sel.anchor, focus: at } : { anchor: at, focus: at });
                if (e.shiftKey) e.preventDefault();
              }}
              className={cn(
                rowHeight === "low" ? "min-w-0 truncate" : "line-clamp-3 min-w-0 break-all",
                selected && "bg-brand-50 outline outline-2 -outline-offset-2 outline-brand-500",
              )}
            >
              {col.render(item)}
            </div>
          );
        },
      };
    }),
    {
      title: <ColumnPicker available={available} shown={shown} onChange={setColumns} />,
      key: "__add",
      width: 56,
    },
  ];

  const statCells = [
    ["总数", stats?.total],
    ["已完成", stats?.completed],
    ["成员", space.members.length],
    ["我参与的", stats?.involved],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="统计"
        className="grid grid-cols-4 divide-x divide-line-subtle rounded-lg border border-line-subtle bg-surface py-3"
      >
        {statCells.map(([label, n]) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <span className="text-xs text-fg-muted">{label}</span>
            <span className="text-xl font-semibold tabular-nums">{n ?? "—"}</span>
          </div>
        ))}
      </section>

      <div className="flex min-h-0 flex-col gap-3 rounded-lg border border-line-subtle bg-surface p-4">
        <div role="tablist" aria-label="列表页签" className="flex items-center gap-6 border-b border-line-subtle">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px border-b-2 pb-2 text-sm",
                tab === key
                  ? "border-brand-500 font-medium text-brand-500"
                  : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {toolbar}

        <div className="flex flex-wrap items-center gap-1">
          <SortButton
            columns={available}
            value={display.sort ?? []}
            onChange={(sort) => onDisplay({ ...display, sort })}
          />
          <GroupButton
            columns={available}
            value={display.groupBy ?? null}
            onChange={(groupBy) => onDisplay({ ...display, groupBy })}
          />
          <ColorButton
            fields={[...fields.values()]}
            value={display.colors ?? []}
            onChange={(colors) => onDisplay({ ...display, colors })}
          />
          <FreezeButton
            columns={shown.map((c) => byKey.get(c.key) as ListColumn)}
            value={frozen}
            onChange={(n) => onDisplay({ ...display, frozen: n || undefined })}
          />
          <RowHeightButton
            value={rowHeight}
            onChange={(h) => onDisplay({ ...display, rowHeight: h === "low" ? undefined : h })}
          />
          <button
            type="button"
            disabled={rows.length === 0}
            title="按当前的列、筛选、排序导出"
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-fg hover:bg-hover disabled:cursor-not-allowed disabled:text-fg-disabled"
            onClick={async () => {
              const typeName = filter.typeIds?.length === 1 ? ctx.typeName(filter.typeIds[0] as string) : "工作项";
              const day = new Date().toLocaleDateString("sv-SE");
              try {
                // 分批加载时还有没加载的行，导出前把全部取下来
                const out = more ? await zero.run(queries.workItems.list(listArgs), { type: "complete" }) : rows;
                await exportListXlsx(
                  `${space.name}-${typeName}-${day}`,
                  shown.map((c) => byKey.get(c.key) as ListColumn),
                  out,
                );
                Toast.success({ content: `已导出 ${out.length} 条`, duration: 2 });
              } catch (e) {
                Toast.error({ content: `导出失败：${e instanceof Error ? e.message : e}` });
              }
            }}
          >
            <Download className="size-4" />
            导出
          </button>
          <SemiInput
            aria-label="搜索工作项"
            prefix={<Search className="ml-2 size-4 text-fg-subtle" />}
            placeholder="搜索名称"
            showClear
            value={search}
            onChange={(v) => setSearch(v)}
            className="!w-56"
          />
          {selected.length > 0 && (
            <BatchBar
              items={items.filter((i) => selected.includes(i.id))}
              fields={[...fields.values()]}
              members={space.members.map((m) => ({ userId: m.userId, name: m.user?.name ?? m.userId }))}
              onClear={() => setSelected([])}
            />
          )}
        </div>

        {/* 单元格选区的复制粘贴：点过单元格后焦点在这一层，Ctrl+C / Ctrl+V 走原生剪贴板事件 */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 只接住键盘和剪贴板事件，表格本身是 grid */}
        <div
          tabIndex={-1}
          className="outline-none"
          onCopy={onCopy}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSel(null);
          }}
        >
          <Table
            size="small"
            bordered
            rowKey="id"
            columns={columns}
            dataSource={rows}
            pagination={!paged && rows.length > 50 ? { pageSize: 50 } : false}
            resizable={{
              // 拖完列宽记进显示设置（名称列和加列按钮不记）
              onResizeStop: ((column: { key?: string; width?: number | string }) => {
                if (column.key && column.key !== "name" && column.key !== "__add")
                  setColumns(
                    shown.map((c) =>
                      c.key === column.key ? { ...c, width: Math.round(Number(column.width) || 120) } : c,
                    ),
                  );
                return column;
              }) as never,
            }}
            scroll={{ x: "max-content" }}
            rowSelection={{
              width: SELECTION_WIDTH,
              fixed: true,
              selectedRowKeys: selected,
              onChange: (keys?: (string | number)[]) => setSelected((keys ?? []).map(String)),
            }}
            onRow={(item?: ListItem) => {
              const color = item && colorOf(item);
              return { style: { height: ROW_HEIGHTS[rowHeight][1], ...(color && { background: color }) } };
            }}
            footer={
              rows.length > 0 ? (
                <SummaryRow
                  cells={[
                    { key: "__select", width: SELECTION_WIDTH },
                    { key: "name", width: 240 },
                    ...shown.map((c) => {
                      const col = byKey.get(c.key) as ListColumn;
                      return { key: c.key, width: c.width ?? col.width, col };
                    }),
                    { key: "__add", width: 56 },
                  ]}
                  rows={rows}
                  partial={more}
                  value={display.summary ?? {}}
                  onChange={(summary) =>
                    onDisplay({ ...display, summary: Object.keys(summary).length ? summary : undefined })
                  }
                />
              ) : undefined
            }
            {...(groupCol && {
              groupBy: (item?: ListItem) => (item ? String(groupCol.value(item) ?? "") : "") || "（空）",
              renderGroupSection: (key?: string | number) => (
                <strong>
                  {groupCol.title}：{String(key)}
                </strong>
              ),
              expandAllGroupRows: true,
            })}
            empty={
              result.type === "complete" ? (
                <EmptyState
                  title={
                    search || Object.values(filter).some((v) => v?.length) ? "没有符合条件的工作项" : "还没有工作项"
                  }
                  description={tab === "all" ? "点右上角的「新建」创建第一个工作项。" : "这个页签下还没有工作项。"}
                />
              ) : (
                "加载中…"
              )
            }
          />
          {more && (
            <div className="flex justify-center pt-3">
              <Button variant="ghost" onClick={() => setLimit(limit + PAGE)}>
                加载更多
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 分批加载时每批几条。 */
const PAGE = 100;
/** 能在服务端排序的列。 */
const SERVER_SORT = new Set(["createdAt", "updatedAt"]);

/** 输入停下一会儿后才变的值（搜索框用，不用每敲一个字就查一次）。 */
function useDebounced<T>(value: T, ms: number): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setCurrent(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return current;
}

/**
 * 列表上方的统计数字，在服务端数（不用为了几个数字同步整个空间）。
 * 列表里的工作项新建、删除、改了状态时再数一次。
 */
function useListStats(
  spaceId: string,
  typeIds: readonly string[],
  items: readonly { id: string; status: string | null }[],
) {
  const [stats, setStats] = useState<{ total: number; completed: number; involved: number } | null>(null);
  const signal = useMemo(() => items.map((i) => `${i.id}:${i.status}`).join(","), [items]);
  const query = typeIds.map((id) => `type=${encodeURIComponent(id)}`).join("&");
  useEffect(() => {
    void signal;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${env.apiUrl}/api/spaces/${spaceId}/list-stats${query ? `?${query}` : ""}`, {
          credentials: "include",
        });
        if (res.ok && live) setStats(await res.json());
      } catch {
        // 统计数字拿不到时显示「—」，不影响列表
      }
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [spaceId, query, signal]);
  return stats;
}

/** 表头最右边的「+」：勾选要显示的列，调顺序。 */
function ColumnPicker({
  available,
  shown,
  onChange,
}: {
  available: ListColumn[];
  shown: { key: string; width?: number }[];
  onChange: (columns: { key: string; width?: number }[]) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const on = new Set(shown.map((c) => c.key));
  const move = (i: number, by: number) => {
    const next = [...shown];
    const [c] = next.splice(i, 1);
    if (c) next.splice(i + by, 0, c);
    onChange(next);
  };
  return (
    <Popover
      trigger="click"
      motion={false}
      position="bottomRight"
      content={
        <div className="flex max-h-[420px] w-72 flex-col gap-2 p-3">
          <SemiInput placeholder="搜索字段" value={keyword} onChange={(v) => setKeyword(v)} aria-label="搜索列" />
          <div className="text-xs text-fg-muted">显示的列（可调顺序）</div>
          <ul className="flex flex-col gap-0.5 overflow-y-auto">
            {shown.map((c, i) => {
              const col = available.find((a) => a.key === c.key);
              return (
                <li key={c.key} className="flex items-center gap-1 text-sm">
                  <Checkbox checked onChange={() => onChange(shown.filter((x) => x.key !== c.key))}>
                    {col?.title ?? c.key}
                  </Checkbox>
                  <span className="flex-1" />
                  <button
                    type="button"
                    aria-label={`上移列 ${col?.title}`}
                    disabled={i === 0}
                    className="px-1 text-fg-subtle disabled:opacity-30"
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`下移列 ${col?.title}`}
                    disabled={i === shown.length - 1}
                    className="px-1 text-fg-subtle disabled:opacity-30"
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="text-xs text-fg-muted">可以加的列</div>
          <ul className="flex flex-col gap-0.5 overflow-y-auto">
            {available
              .filter((c) => !on.has(c.key) && c.title.includes(keyword.trim()))
              .map((c) => (
                <li key={c.key}>
                  <Checkbox checked={false} onChange={() => onChange([...shown, { key: c.key }])}>
                    {c.title}
                  </Checkbox>
                </li>
              ))}
          </ul>
        </div>
      }
    >
      <button
        type="button"
        aria-label="添加列"
        className="flex size-6 items-center justify-center rounded text-fg-muted hover:bg-hover"
      >
        <Plus className="size-4" />
      </button>
    </Popover>
  );
}

/**
 * 底部汇总行：每列下面选一种统计方式（计数、已填写、求和…），按当前筛选和搜索后的全部行算。
 * 和表格列宽对齐，横向跟着表格滚动。
 */
function SummaryRow({
  cells,
  rows,
  partial = false,
  value,
  onChange,
}: {
  cells: { key: string; width: number; col?: ListColumn }[];
  rows: readonly ListItem[];
  /** 分批加载还没加载完（选了统计方式后会改成加载全部）。 */
  partial?: boolean;
  value: Record<string, SummaryKind>;
  onChange: (summary: Record<string, SummaryKind>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 表格会把列撑满宽度，所以按表头单元格的实际宽度排，并跟着表体横向滚动
  const [widths, setWidths] = useState<number[]>([]);
  useEffect(() => {
    const el = ref.current;
    const table = el?.closest(".semi-table-wrapper");
    const body = table?.querySelector<HTMLElement>(".semi-table-body");
    const head = table?.querySelector("thead tr:last-child");
    if (!el || !body || !head) return;
    const measure = () => {
      const next = [...head.children].map((th) => (th as HTMLElement).offsetWidth);
      setWidths((prev) => (prev.join() === next.join() ? prev : next));
      el.scrollLeft = body.scrollLeft;
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const th of head.children) observer.observe(th);
    body.addEventListener("scroll", measure);
    return () => {
      observer.disconnect();
      body.removeEventListener("scroll", measure);
    };
  });
  const compute = (col: ListColumn, kind: SummaryKind): string => {
    const values = rows.map((r) => col.value(r));
    const filled = values.filter((v) => v !== null && v !== "").length;
    const nums = values.filter((v): v is number => typeof v === "number");
    const round = (n: number) => String(Math.round(n * 100) / 100);
    switch (kind) {
      case "count":
        return String(values.length);
      case "filled":
        return String(filled);
      case "empty":
        return String(values.length - filled);
      case "filledPct":
        return `${round((filled / values.length) * 100)}%`;
      case "sum":
        return round(nums.reduce((a, b) => a + b, 0));
      case "avg":
        return nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length) : "—";
      case "max":
        return nums.length ? round(Math.max(...nums)) : "—";
      case "min":
        return nums.length ? round(Math.min(...nums)) : "—";
    }
  };
  const set = (key: string, kind: SummaryKind | null) => {
    const next = { ...value };
    if (kind) next[key] = kind;
    else delete next[key];
    onChange(next);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: 汇总行是表格底部的一组格子，用 fieldset 会带上表单的默认样式
    <div ref={ref} role="group" aria-label="汇总" className="-mx-4 -my-3 overflow-hidden">
      <div className="flex w-max text-sm">
        {cells.map(({ key, width: fallback, col }, index) => {
          const width = widths.length === cells.length ? widths[index] : fallback;
          const kind = value[key];
          const kinds = (Object.keys(SUMMARY_TEXT) as SummaryKind[]).filter(
            (k) => col?.numeric || !["sum", "avg", "max", "min"].includes(k),
          );
          return (
            <div key={key} style={{ width }} className="shrink-0 px-2 py-1.5">
              {key === "name" && (
                <span className="text-fg-muted">{partial ? `已加载 ${rows.length} 条` : `共 ${rows.length} 条`}</span>
              )}
              {col && (
                <Dropdown
                  trigger="click"
                  motion={false}
                  position="top"
                  render={
                    <Dropdown.Menu>
                      <Dropdown.Item active={!kind} onClick={() => set(key, null)}>
                        不统计
                      </Dropdown.Item>
                      {kinds.map((k) => (
                        <Dropdown.Item key={k} active={kind === k} onClick={() => set(key, k)}>
                          {SUMMARY_TEXT[k]}
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                  }
                >
                  <button
                    type="button"
                    aria-label={`${col.title}的汇总`}
                    className={cn(
                      "w-full truncate rounded px-1 text-left hover:bg-hover",
                      kind ? "text-fg" : "text-fg-subtle",
                    )}
                  >
                    {kind ? `${SUMMARY_TEXT[kind]} ${compute(col, kind)}` : "统计"}
                  </button>
                </Dropdown>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 冻结列：名称列总是冻结，这里选再冻结到第几列。 */
function FreezeButton({
  columns,
  value,
  onChange,
}: {
  columns: ListColumn[];
  value: number;
  onChange: (frozen: number) => void;
}) {
  return (
    <Dropdown
      trigger="click"
      motion={false}
      position="bottomLeft"
      render={
        <Dropdown.Menu>
          <Dropdown.Item active={value === 0} onClick={() => onChange(0)}>
            只冻结名称列
          </Dropdown.Item>
          {columns.slice(0, 10).map((c, i) => (
            <Dropdown.Item key={c.key} active={value === i + 1} onClick={() => onChange(i + 1)}>
              冻结到「{c.title}」
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      }
    >
      <button
        type="button"
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm hover:bg-hover",
          value ? "text-brand-500" : "text-fg",
        )}
      >
        <Pin className="size-4" />
        {value ? `冻结 ${value + 1} 列` : "冻结"}
      </button>
    </Dropdown>
  );
}

/** 行高：低、中、高、超高；高一些时单元格内容可以折行（最多 3 行）。 */
function RowHeightButton({ value, onChange }: { value: RowHeight; onChange: (h: RowHeight) => void }) {
  return (
    <Dropdown
      trigger="click"
      motion={false}
      position="bottomLeft"
      render={
        <Dropdown.Menu>
          {(Object.keys(ROW_HEIGHTS) as RowHeight[]).map((h) => (
            <Dropdown.Item key={h} active={value === h} onClick={() => onChange(h)}>
              {ROW_HEIGHTS[h][0]}
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      }
    >
      <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm hover:bg-hover">
        <Rows3 className="size-4" />
        行高：{ROW_HEIGHTS[value][0]}
      </button>
    </Dropdown>
  );
}

function ToolButton({
  icon,
  label,
  active,
  children,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Popover
      trigger="click"
      motion={false}
      position="bottomLeft"
      content={<div className="flex w-80 flex-col gap-2 p-3">{children}</div>}
    >
      <button
        type="button"
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm hover:bg-hover",
          active ? "text-brand-500" : "text-fg",
        )}
      >
        {icon}
        {label}
      </button>
    </Popover>
  );
}

function SortButton({
  columns,
  value,
  onChange,
}: {
  columns: ListColumn[];
  value: { key: string; desc?: boolean }[];
  onChange: (sort: { key: string; desc?: boolean }[]) => void;
}) {
  const options = [{ key: "name", title: "名称" }, ...columns];
  return (
    <ToolButton
      icon={<ArrowDownUp className="size-4" />}
      label={value.length ? `排序 ${value.length}` : "排序"}
      active={value.length > 0}
    >
      {value.map((s, i) => (
        <div key={`${s.key}-${i}`} className="flex items-center gap-2">
          <Select
            aria-label="排序字段"
            value={s.key}
            className="flex-1"
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
          >
            {options.map((c) => (
              <option key={c.key} value={c.key}>
                {c.title}
              </option>
            ))}
          </Select>
          <Select
            aria-label="排序方向"
            value={s.desc ? "desc" : "asc"}
            onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, desc: e.target.value === "desc" } : x)))}
          >
            <option value="asc">升序</option>
            <option value="desc">降序</option>
          </Select>
          <button
            type="button"
            aria-label="去掉这个排序"
            className="text-fg-subtle hover:text-danger-600"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="w-fit"
        onClick={() => onChange([...value, { key: "createdAt", desc: true }])}
      >
        <Plus />
        添加排序
      </Button>
    </ToolButton>
  );
}

function GroupButton({
  columns,
  value,
  onChange,
}: {
  columns: ListColumn[];
  value: string | null;
  onChange: (groupBy: string | null) => void;
}) {
  return (
    <Dropdown
      trigger="click"
      motion={false}
      position="bottomLeft"
      render={
        <Dropdown.Menu>
          <Dropdown.Item onClick={() => onChange(null)}>不分组</Dropdown.Item>
          {columns.map((c) => (
            <Dropdown.Item key={c.key} active={value === c.key} onClick={() => onChange(c.key)}>
              {c.title}
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      }
    >
      <button
        type="button"
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm hover:bg-hover",
          value ? "text-brand-500" : "text-fg",
        )}
      >
        <Group className="size-4" />
        {value ? `分组：${columns.find((c) => c.key === value)?.title ?? ""}` : "分组"}
      </button>
    </Dropdown>
  );
}

function ColorButton({
  fields,
  value,
  onChange,
}: {
  fields: ListField[];
  value: { when: Condition; color: string }[];
  onChange: (colors: { when: Condition; color: string }[]) => void;
}) {
  const conditionFields: ConditionField[] = fields.map((f) => ({
    key: f.key,
    name: f.name,
    dataType: f.dataType,
    options: f.options?.map((o) => ({ value: o.value, label: o.label || o.value })) ?? null,
  }));
  return (
    <ToolButton
      icon={<Palette className="size-4" />}
      label={value.length ? `设置颜色 ${value.length}` : "设置颜色"}
      active={value.length > 0}
    >
      <p className="text-xs text-fg-subtle">满足条件的行显示成对应的底色，从上到下第一个满足的生效。</p>
      {value.map((rule, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 着色规则没有 id
        <div key={i} className="flex flex-col gap-2 rounded-md border border-line-subtle p-2">
          <div className="flex items-center gap-2">
            <Select
              aria-label="行颜色"
              value={rule.color}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}
            >
              {ROW_COLORS.map(([c, label]) => (
                <option key={c} value={c}>
                  {label}
                </option>
              ))}
            </Select>
            <span className="size-5 rounded" style={{ background: rule.color }} />
            <span className="flex-1" />
            <button
              type="button"
              aria-label="删除着色规则"
              className="text-fg-subtle hover:text-danger-600"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <ConditionEditor
            label="满足"
            value={rule.when}
            fields={conditionFields}
            onChange={(when) => when && onChange(value.map((x, j) => (j === i ? { ...x, when } : x)))}
          />
        </div>
      ))}
      {conditionFields[0] && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() =>
            onChange([
              ...value,
              { when: { kind: "notEmpty", field: conditionFields[0]?.key ?? "" }, color: ROW_COLORS[0][0] },
            ])
          }
        >
          <Plus />
          添加着色规则
        </Button>
      )}
    </ToolButton>
  );
}
