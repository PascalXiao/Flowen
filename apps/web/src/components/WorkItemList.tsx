import { type Condition, conditionFields, evaluate, PASTEABLE_FIELD_TYPES, parseFieldText } from "@fp/engine";
import { compactFilter, mutators, queries, type WorkItemFilterArgs } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { ArrowDownUp, Download, Group, Palette, Pin, Plus, Rows3, Star, Trash2, X } from "lucide-react";
import { type ClipboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { BatchBar, type BatchLink } from "@/components/BatchBar";
import { ConditionEditor, type ConditionField } from "@/components/ConditionEditor";
import { MultiPick } from "@/components/FilterConditions";
import { type GridColumn, type GridRow, ListGrid } from "@/components/ListGrid";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, SearchInput, Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toast } from "@/components/ui/toast";
import { type Density, setDensity, useDensity } from "@/lib/density";
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
import { foreignTypes, type RelDef, spaceRelationDefs } from "@/lib/relations";
import { cn } from "@/lib/utils";

/** 列表的显示设置：列、排序、分组、行着色（和视图里存的一样）。 */
export interface ListDisplay {
  columns?: { key: string; width?: number; group?: string }[];
  sort?: { key: string; desc?: boolean }[];
  groupBy?: string | null;
  /** 第二、三级分组。 */
  subGroupBy?: string[];
  colors?: { when: Condition; color: string; cells?: string[] }[];
  /** 名称列之外再冻结前几列（横向滚动时固定在左边）。 */
  frozen?: number;
  /** 行高：低、中、高、超高。 */
  rowHeight?: "low" | "medium" | "high" | "xhigh";
  /** 底部汇总行：列键 → 统计方式。 */
  summary?: Record<string, SummaryKind>;
  /** 看板：泳道（creator、role:角色键、field:字段键）和卡片上显示的字段。 */
  board?: BoardDisplay;
  /** 快捷筛选：显示在筛选条上的字段键。 */
  quick?: string[];
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

/** 行着色：存的值（老数据里的浅色）、名字、显示时用的色相。 */
const ROW_COLORS = [
  ["#fff3e0", "橙", "#f59e0b"],
  ["#e8f5e9", "绿", "#22c55e"],
  ["#e3f2fd", "蓝", "#3b82f6"],
  ["#fce4ec", "红", "#ef4444"],
  ["#f3e5f5", "紫", "#a855f7"],
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
 * 批量同步创建能走的关联：本端有字段的每条关联（正向用关联名，反向用对端字段名），
 * 新工作项建在另一端的类型里（跨空间关联就在另一个空间）。
 */
function batchLinks(space: SpaceLike): BatchLink[] {
  const types = [...space.workItemTypes, ...foreignTypes(space)];
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? "?";
  const own = new Set(space.workItemTypes.map((t) => t.id));
  const out: BatchLink[] = [];
  for (const d of spaceRelationDefs(space)) {
    if (own.has(d.fromTypeId))
      out.push({
        relationDefId: d.id,
        side: "to",
        itemTypeId: d.fromTypeId,
        name: d.name,
        target: typeName(d.toTypeId),
      });
    if (d.reverseName && own.has(d.toTypeId))
      out.push({
        relationDefId: d.id,
        side: "from",
        itemTypeId: d.toTypeId,
        name: d.reverseName,
        target: typeName(d.fromTypeId),
      });
  }
  return out;
}

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
  fixedViews = [],
}: {
  /** 自己能编辑的固定视图（批量加入、移出用）。 */
  fixedViews?: readonly { id: string; name: string }[];
  space: SpaceLike;
  filter: WorkItemFilterArgs;
  display: ListDisplay;
  onDisplay: (display: ListDisplay) => void;
  /** 筛选栏（放在排序、分组前面）。 */
  toolbar: (slots: { tools: ReactNode; search: ReactNode }) => ReactNode;
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
  const shown: { key: string; width?: number; group?: string }[] = (
    display.columns ?? defaultColumnKeys(fields).map((key) => ({ key }))
  ).filter((c) => byKey.has(c.key));
  const setColumns = (columns: { key: string; width?: number; group?: string }[]) => onDisplay({ ...display, columns });

  // 只同步要用的数据：显示的列、排序、分组、着色条件用到的字段、节点和关联
  const needs = listNeeds(
    [
      ...shown.map((c) => c.key),
      ...(display.sort ?? []).map((s) => s.key),
      ...(display.groupBy ? [display.groupBy, ...(display.subGroupBy ?? [])] : []),
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

  // 分组的各级列（最多三级）
  const groupCols = (display.groupBy ? [display.groupBy, ...(display.subGroupBy ?? [])] : []).flatMap(
    (k) => byKey.get(k) ?? [],
  );
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
    // 分组时同组的行排在一起：逐级按组第一次出现的顺序排，组内保持上面的排序
    if (groupCols.length > 0) {
      const orders = groupCols.map((col) => {
        const order = new Map<string, number>();
        for (const r of out) {
          const key = groupOf(col, r);
          if (!order.has(key)) order.set(key, order.size);
        }
        return order;
      });
      out = [...out].sort((a, b) => {
        for (const [i, col] of groupCols.entries()) {
          const d = (orders[i]?.get(groupOf(col, a)) ?? 0) - (orders[i]?.get(groupOf(col, b)) ?? 0);
          if (d) return d;
        }
        return 0;
      });
    }
    return out;
  }, [items, sort, tab, byKey, paged, groupCols]);
  const rowKey = rows.map((r) => r.id).join(",");
  useEffect(() => {
    onRows?.(rowKey ? rowKey.split(",") : []);
  }, [rowKey, onRows]);
  const valuesOf = (i: ListItem) => Object.fromEntries(i.fieldValues.map((v) => [v.fieldKey, v.value]));
  const matches = (c: { when: Condition }, i: ListItem) =>
    evaluate(c.when, { ...valuesOf(i), $stage: i.stage, $status: i.status });
  const colorOf = (i: ListItem) => display.colors?.find((c) => !c.cells?.length && matches(c, i))?.color;
  const cellColorOf = (i: ListItem, key: string) =>
    display.colors?.find((c) => c.cells?.includes(key) && matches(c, i))?.color;

  const marks = (i: ListItem) => new Set(i.marks.map((m) => m.kind));

  const frozen = Math.min(display.frozen ?? 0, shown.length);
  const density = useDensity();
  const rowHeight: RowHeight = display.rowHeight ?? "low";

  // 单元格选区（行是 rows 里的下标，列是 shown 里的下标）：点选、Shift 点选扩成矩形，Ctrl+C 复制、Ctrl+V 粘贴
  const [sel, setSel] = useState<{ anchor: Cell; focus: Cell } | null>(null);
  const copied = useRef<{ text: string; keys: string[][]; values: unknown[][] } | null>(null);
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

  const nameCell = (item: ListItem) => (
    <span className="flex min-w-0 items-center gap-1.5">
      {/* 点名称在右侧抽屉里打开，列表留在后面，可以连续看 */}
      <Link
        className="min-w-0 truncate font-medium text-fg hover:text-accent"
        from="/spaces/$spaceId/$typeKey"
        to="."
        search={(prev) => ({ ...prev, item: item.id })}
      >
        {item.name}
      </Link>
      {marks(item).has("star") && <Star className="size-3.5 shrink-0 fill-warning-500 text-warning-500" />}
    </span>
  );
  const gridColumns: GridColumn<ListItem>[] = [
    { key: "name", header: "名称", width: 260, frozen: true, cell: nameCell },
    ...shown.map((c, index): GridColumn<ListItem> => {
      const col = byKey.get(c.key) as ListColumn;
      return {
        key: col.key,
        header: col.title,
        ...(c.group && { group: c.group }),
        width: c.width ?? col.width,
        frozen: index < frozen,
        // 拖完列宽记进显示设置
        onResize: (width) => setColumns(shown.map((x) => (x.key === c.key ? { ...x, width } : x))),
        cell: (item, r) => {
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
                "-mx-1 flex min-h-7 w-[calc(100%+0.5rem)] min-w-0 items-center rounded-[5px] px-1",
                rowHeight === "low" ? "[&>*]:truncate" : "line-clamp-3 break-all",
                selected && "bg-accent-soft outline outline-2 -outline-offset-2 outline-accent",
              )}
            >
              {col.render(item)}
            </div>
          );
        },
      };
    }),
    {
      key: "__add",
      header: <ColumnPicker available={available} shown={shown} onChange={setColumns} />,
      width: 44,
      cell: () => null,
    },
  ];

  // 表体的行：分组时在每组前面插一行组标题（rows 已经按组排好）
  const gridRows: GridRow<ListItem>[] = [];
  const pathOf = (item: ListItem) => groupCols.map((col) => groupOf(col, item));
  rows.forEach((item, index) => {
    const path = pathOf(item);
    const prev = index > 0 ? pathOf(rows[index - 1] as ListItem) : null;
    // 从第一个和上一行不同的级别开始，每级插一行组标题
    const from = prev ? path.findIndex((k, i) => k !== prev[i]) : 0;
    if (from >= 0)
      for (let level = from; level < groupCols.length; level++) {
        const col = groupCols[level] as ListColumn;
        const prefix = path.slice(0, level + 1);
        gridRows.push({
          kind: "group",
          key: prefix.join("\u0001"),
          level,
          label: (
            <>
              <span className="text-fg-muted">{col.title}</span>
              {path[level]}
            </>
          ),
          count: rows.filter(
            (r) =>
              pathOf(r)
                .slice(0, level + 1)
                .join("\u0001") === prefix.join("\u0001"),
          ).length,
        });
      }
    gridRows.push({ kind: "item", item, index });
  });

  const filtered = !!search || Object.keys(compactFilter(filter)).length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4 border-b border-line-subtle">
        <div role="tablist" aria-label="列表页签" className="-mb-px flex items-center gap-0.5">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "relative h-9 cursor-pointer px-2 text-sm",
                tab === key
                  ? "font-medium text-fg after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-fg"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <section aria-label="统计" className="flex items-center gap-4 text-xs text-fg-subtle">
          {(
            [
              ["总数", stats?.total],
              ["已完成", stats?.completed],
              ["成员", space.members.length],
              ["我参与的", stats?.involved],
            ] as const
          ).map(([label, n]) => (
            <span key={label} className="whitespace-nowrap">
              {label} <b className="font-medium text-fg-muted tabular-nums">{n ?? "—"}</b>
            </span>
          ))}
        </section>
      </div>

      {toolbar({
        search: (
          <div className="w-52">
            <SearchInput aria-label="搜索工作项" placeholder="搜索名称" value={search} onChange={setSearch} />
          </div>
        ),
        tools: (
          <>
            <SortButton
              columns={available}
              value={display.sort ?? []}
              onChange={(sort) => onDisplay({ ...display, sort })}
            />
            <GroupButton
              columns={available}
              value={display.groupBy ? [display.groupBy, ...(display.subGroupBy ?? [])] : []}
              onChange={(keys) => {
                const [first, ...rest] = keys;
                const { subGroupBy: _s, ...base } = display;
                onDisplay({ ...base, groupBy: first ?? null, ...(rest.length && { subGroupBy: rest }) });
              }}
            />
            <ColorButton
              fields={[...fields.values()]}
              columns={[
                { key: "name", title: "名称" },
                ...shown.map((c) => ({ key: c.key, title: byKey.get(c.key)?.title ?? c.key })),
              ]}
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
              density={density}
              onChange={(h) => onDisplay({ ...display, rowHeight: h === "low" ? undefined : h })}
            />
            <button
              type="button"
              disabled={rows.length === 0}
              title="按当前的列、筛选、排序导出"
              className={cn(toolButton(false), "disabled:cursor-not-allowed disabled:text-fg-disabled")}
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
              <Download />
              导出
            </button>
          </>
        ),
      })}

      {selected.length > 0 && (
        <BatchBar
          items={items.filter((i) => selected.includes(i.id))}
          fields={[...fields.values()]}
          members={space.members.map((m) => ({ userId: m.userId, name: m.user?.name ?? m.userId }))}
          links={batchLinks(space)}
          types={space.workItemTypes.map((t) => ({
            id: t.id,
            roles: t.roles,
            definitions: t.flowTemplates.flatMap((f) => (f.currentVersion ? [f.currentVersion.definition] : [])),
          }))}
          fixedViews={fixedViews.filter((v) => v.id !== filter.viewId)}
          inView={fixedViews.find((v) => v.id === filter.viewId)}
          onClear={() => setSelected([])}
        />
      )}

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
        <ListGrid
          label="工作项列表"
          columns={gridColumns}
          rows={gridRows}
          rowHeight={rowHeight === "low" && density === "compact" ? 32 : ROW_HEIGHTS[rowHeight][1]}
          compact={density === "compact"}
          selected={selected}
          onSelect={setSelected}
          rowTint={(item) => tintOf(colorOf(item))}
          cellTint={(item, key) => tintOf(cellColorOf(item, key), 22)}
          footer={{
            label: "汇总",
            cell: (key) => {
              if (key === "name")
                return (
                  <span className="px-1 text-fg-muted">
                    {more ? `已加载 ${rows.length} 条` : `共 ${rows.length} 条`}
                  </span>
                );
              const col = byKey.get(key);
              if (!col) return null;
              return (
                <SummaryCell
                  col={col}
                  rows={rows}
                  kind={display.summary?.[key]}
                  onChange={(kind) => {
                    const next = { ...display.summary };
                    if (kind) next[key] = kind;
                    else delete next[key];
                    onDisplay({ ...display, summary: Object.keys(next).length ? next : undefined });
                  }}
                />
              );
            },
          }}
          empty={
            result.type === "complete" ? (
              <EmptyState
                title={filtered ? "没有符合条件的工作项" : "还没有工作项"}
                description={tab === "all" ? "点右上角的「新建」创建第一个工作项。" : "这个页签下还没有工作项。"}
              />
            ) : (
              <span className="text-fg-subtle">加载中…</span>
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
  );
}

/** 分组的键：列的值，空的归到「（空）」。 */
const groupOf = (col: ListColumn, item: ListItem) => String(col.value(item) ?? "") || "（空）";

/** 着色规则里存的是浅色底色，按它找到色相，在当前主题的表面色上叠一层淡色（深色主题里也不刺眼）。 */
function tintOf(color: string | undefined, strength = 14) {
  if (!color) return undefined;
  const hue = ROW_COLORS.find(([c]) => c === color)?.[2] ?? color;
  return `color-mix(in srgb, ${hue} ${strength}%, transparent)`;
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
  shown: { key: string; width?: number; group?: string }[];
  onChange: (columns: { key: string; width?: number; group?: string }[]) => void;
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
    <Popover>
      <PopoverTrigger
        aria-label="添加列"
        className="flex size-6 items-center justify-center rounded text-fg-muted hover:bg-hover"
      >
        <Plus className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="p-0">
        <div className="flex max-h-[420px] w-72 flex-col gap-2 p-3">
          <Input
            placeholder="搜索字段"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            aria-label="搜索列"
          />
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
          <HeaderGroups available={available} shown={shown} onChange={onChange} />
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
      </PopoverContent>
    </Popover>
  );
}

/**
 * 表头分组：给几列起一个组名，表头上方合并显示。保存时把同组的列挪到一起（排在组里第一列的位置）。
 */
function HeaderGroups({
  available,
  shown,
  onChange,
}: {
  available: ListColumn[];
  shown: { key: string; width?: number; group?: string }[];
  onChange: (columns: { key: string; width?: number; group?: string }[]) => void;
}) {
  const [name, setName] = useState("");
  const [keys, setKeys] = useState<string[]>([]);
  const groups = [...new Set(shown.flatMap((c) => (c.group ? [c.group] : [])))];
  const title = (key: string) => available.find((a) => a.key === key)?.title ?? key;
  /** 改分组后让同组的列相邻：组按第一列出现的位置排。 */
  const regroup = (cols: { key: string; width?: number; group?: string }[]) => {
    const out: typeof cols = [];
    for (const c of cols) {
      if (out.includes(c)) continue;
      if (!c.group) out.push(c);
      else out.push(...cols.filter((x) => x.group === c.group));
    }
    return out;
  };
  return (
    <div className="flex flex-col gap-1.5 border-line-subtle border-t pt-2">
      <div className="text-xs text-fg-muted">表头分组</div>
      {groups.map((g) => (
        <div key={g} className="flex items-center gap-1 text-sm">
          <span className="font-medium">{g}</span>
          <span className="min-w-0 flex-1 truncate text-fg-subtle text-xs">
            {shown
              .filter((c) => c.group === g)
              .map((c) => title(c.key))
              .join("、")}
          </span>
          <button
            type="button"
            aria-label={`取消分组 ${g}`}
            className="px-1 text-fg-subtle hover:text-danger-600"
            onClick={() => onChange(shown.map(({ group, ...c }) => (group === g ? c : { ...c, group })))}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <Input
          aria-label="分组名称"
          placeholder="组名"
          className="w-20"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <MultiPick
          label="分组的列"
          placeholder="选列"
          className="min-w-0"
          choices={shown.map((c) => ({ value: c.key, label: title(c.key) }))}
          value={keys}
          onChange={setKeys}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!name.trim() || keys.length === 0}
          onClick={() => {
            const g = name.trim();
            onChange(regroup(shown.map((c) => (keys.includes(c.key) ? { ...c, group: g } : c))));
            setName("");
            setKeys([]);
          }}
        >
          添加分组
        </Button>
      </div>
    </div>
  );
}

/** 底部汇总行的一格：选一种统计方式（计数、已填写、求和…），按当前筛选和搜索后的全部行算。 */
function SummaryCell({
  col,
  rows,
  kind,
  onChange,
}: {
  col: ListColumn;
  rows: readonly ListItem[];
  kind: SummaryKind | undefined;
  onChange: (kind: SummaryKind | null) => void;
}) {
  const compute = (k: SummaryKind): string => {
    const values = rows.map((r) => col.value(r));
    const filled = values.filter((v) => v !== null && v !== "").length;
    const nums = values.filter((v): v is number => typeof v === "number");
    const round = (n: number) => String(Math.round(n * 100) / 100);
    switch (k) {
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
  const kinds = (Object.keys(SUMMARY_TEXT) as SummaryKind[]).filter(
    (k) => col.numeric || !["sum", "avg", "max", "min"].includes(k),
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${col.title}的汇总`}
        className={cn(
          "h-6 w-full cursor-pointer truncate rounded px-1 text-left hover:bg-hover",
          kind ? "text-fg" : "text-transparent hover:text-fg-subtle focus-visible:text-fg-subtle",
        )}
      >
        {kind ? `${SUMMARY_TEXT[kind]} ${compute(kind)}` : "统计"}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top">
        <DropdownMenuItem active={!kind} onSelect={() => onChange(null)}>
          不统计
        </DropdownMenuItem>
        {kinds.map((k) => (
          <DropdownMenuItem key={k} active={kind === k} onSelect={() => onChange(k)}>
            {SUMMARY_TEXT[k]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
    <DropdownMenu>
      <DropdownMenuTrigger className={toolButton(!!value)}>
        <Pin />
        {value ? `冻结 ${value + 1} 列` : "冻结"}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem active={value === 0} onSelect={() => onChange(0)}>
          只冻结名称列
        </DropdownMenuItem>
        {columns.slice(0, 10).map((c, i) => (
          <DropdownMenuItem key={c.key} active={value === i + 1} onSelect={() => onChange(i + 1)}>
            冻结到「{c.title}」
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 行高：低、中、高、超高；高一些时单元格内容可以折行（最多 3 行）。下面是本机的显示密度。 */
function RowHeightButton({
  value,
  density,
  onChange,
}: {
  value: RowHeight;
  density: Density;
  onChange: (h: RowHeight) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={toolButton(false)}>
        <Rows3 />
        行高：{ROW_HEIGHTS[value][0]}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {(Object.keys(ROW_HEIGHTS) as RowHeight[]).map((h) => (
          <DropdownMenuItem key={h} active={value === h} onSelect={() => onChange(h)}>
            {ROW_HEIGHTS[h][0]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>显示密度（本机）</DropdownMenuLabel>
        <DropdownMenuItem active={density === "standard"} onSelect={() => setDensity("standard")}>
          标准
        </DropdownMenuItem>
        <DropdownMenuItem active={density === "compact"} onSelect={() => setDensity("compact")}>
          紧凑
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 工具栏按钮（排序、分组、冻结…）：设置了内容时用强调色。 */
const toolButton = (active: boolean) =>
  cn(
    "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-sm hover:bg-hover [&_svg]:size-[15px]",
    active ? "text-accent" : "text-fg-muted hover:text-fg",
  );

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
    <Popover>
      <PopoverTrigger className={toolButton(active)}>
        {icon}
        {label}
      </PopoverTrigger>
      <PopoverContent className="flex w-80 flex-col gap-2 p-3">{children}</PopoverContent>
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
    <ToolButton icon={<ArrowDownUp />} label={value.length ? `排序 ${value.length}` : "排序"} active={value.length > 0}>
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

/** 分组：最多三级，每级选一列。 */
function GroupButton({
  columns,
  value,
  onChange,
}: {
  columns: ListColumn[];
  value: string[];
  onChange: (keys: string[]) => void;
}) {
  const title = (k: string) => columns.find((c) => c.key === k)?.title ?? "";
  const levels = ["第一级", "第二级", "第三级"];
  return (
    <ToolButton
      icon={<Group />}
      label={value.length ? `分组：${value.map(title).join(" / ")}` : "分组"}
      active={value.length > 0}
    >
      <p className="text-xs text-fg-subtle">按列的值把行分组，最多三级。</p>
      {levels.slice(0, Math.min(value.length + 1, 3)).map((name, i) => (
        <div key={name} className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-fg-muted text-xs">{name}</span>
          <Select
            aria-label={`${name}分组`}
            className="flex-1"
            value={value[i] ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onChange(v ? [...value.slice(0, i), v].filter((k, j, all) => all.indexOf(k) === j) : value.slice(0, i));
            }}
          >
            <option value="">{i === 0 ? "不分组" : "不再分组"}</option>
            {columns
              .filter((c) => c.key === value[i] || !value.includes(c.key))
              .map((c) => (
                <option key={c.key} value={c.key}>
                  {c.title}
                </option>
              ))}
          </Select>
        </div>
      ))}
    </ToolButton>
  );
}

type ColorRule = { when: Condition; color: string; cells?: string[] };

function ColorButton({
  fields,
  columns,
  value,
  onChange,
}: {
  fields: ListField[];
  /** 显示着的列：可以只给这些列的单元格上色。 */
  columns: { key: string; title: string }[];
  value: ColorRule[];
  onChange: (colors: ColorRule[]) => void;
}) {
  const conditionFields: ConditionField[] = fields.map((f) => ({
    key: f.key,
    name: f.name,
    dataType: f.dataType,
    options: f.options?.map((o) => ({ value: o.value, label: o.label || o.value })) ?? null,
  }));
  return (
    <ToolButton
      icon={<Palette />}
      label={value.length ? `设置颜色 ${value.length}` : "设置颜色"}
      active={value.length > 0}
    >
      <p className="text-xs text-fg-subtle">
        满足条件的行（或选中的列的单元格）显示成对应的底色，从上到下第一个满足的生效。
      </p>
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
            <span
              className="size-4 rounded"
              style={{ background: ROW_COLORS.find(([c]) => c === rule.color)?.[2] ?? rule.color }}
            />
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
          <MultiPick
            label="着色范围"
            placeholder="整行"
            placeholderClass="text-fg"
            choices={columns.map((c) => ({ value: c.key, label: c.title }))}
            value={rule.cells ?? []}
            onChange={(cells) =>
              onChange(
                value.map((x, j) => {
                  if (j !== i) return x;
                  const { cells: _old, ...rest } = x;
                  return cells.length ? { ...rest, cells } : rest;
                }),
              )
            }
          />
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
