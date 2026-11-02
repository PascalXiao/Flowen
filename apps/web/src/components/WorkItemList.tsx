import { Checkbox, Dropdown, Popover, Input as SemiInput, Table } from "@douyinfe/semi-ui";
import { type Condition, evaluate } from "@fp/engine";
import { mutators, queries, type WorkItemFilterArgs } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { ArrowDownUp, Group, Palette, Plus, Search, Star, Trash2, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { ConditionEditor, type ConditionField } from "@/components/ConditionEditor";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page";
import { withLineOptions } from "@/lib/fields";
import {
  allColumns,
  columnSources,
  defaultColumnKeys,
  type ListColumn,
  type ListContext,
  type ListField,
  type ListItem,
} from "@/lib/list-columns";
import { cn } from "@/lib/utils";

/** 列表的显示设置：列、排序、分组、行着色（和视图里存的一样）。 */
export interface ListDisplay {
  columns?: { key: string; width?: number }[];
  sort?: { key: string; desc?: boolean }[];
  groupBy?: string | null;
  colors?: { when: Condition; color: string }[];
}

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
  }[];
};

/**
 * 工作项列表（表格），对照飞书项目的工作项列表：页签（全部、最近浏览、我创建的…）、筛选之外的
 * 排序 / 分组 / 设置颜色 / 搜索，表头最右边的「+」随时加列，列宽可以拖，勾选后可以批量关注。
 */
export function WorkItemList({
  space,
  filter,
  display,
  onDisplay,
  toolbar,
}: {
  space: SpaceLike;
  filter: WorkItemFilterArgs;
  display: ListDisplay;
  onDisplay: (display: ListDisplay) => void;
  /** 筛选栏（放在排序、分组前面）。 */
  toolbar: ReactNode;
}) {
  const zero = useZero();
  const me = String(zero.userID);
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [items, result] = useQuery(queries.workItems.list({ spaceId: space.id, filter, tab }));
  const [all] = useQuery(
    queries.workItems.list({
      spaceId: space.id,
      filter: filter.typeIds ? { typeIds: filter.typeIds } : {},
      tab: "all",
    }),
  );

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
    ...columnSources(space.workItemTypes.filter((t) => !filter.typeIds?.length || filter.typeIds.includes(t.id))),
  };
  const available = allColumns(ctx);
  const byKey = new Map(available.map((c) => [c.key, c]));
  const shown: { key: string; width?: number }[] = (
    display.columns ?? defaultColumnKeys(fields).map((key) => ({ key }))
  ).filter((c) => byKey.has(c.key));
  const setColumns = (columns: { key: string; width?: number }[]) => onDisplay({ ...display, columns });

  // 搜索、排序、着色、分组都在已经同步下来的行上做
  const rows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    let out = keyword ? items.filter((i) => i.name.toLowerCase().includes(keyword)) : [...items];
    if (tab === "recent") out.sort((a, b) => (b.visits[0]?.visitedAt ?? 0) - (a.visits[0]?.visitedAt ?? 0));
    for (const s of [...(display.sort ?? [])].reverse()) {
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
  }, [items, search, display.sort, tab, byKey]);
  const valuesOf = (i: ListItem) => Object.fromEntries(i.fieldValues.map((v) => [v.fieldKey, v.value]));
  const colorOf = (i: ListItem) =>
    display.colors?.find((c) => evaluate(c.when, { ...valuesOf(i), $stage: i.stage, $status: i.status }))?.color;
  const groupCol = display.groupBy ? byKey.get(display.groupBy) : undefined;

  const marks = (i: ListItem) => new Set(i.marks.map((m) => m.kind));
  const toggleMark = (ids: string[], kind: "follow" | "star", on: boolean) => {
    for (const workItemId of ids) zero.mutate(mutators.mark.set({ workItemId, kind, on }));
  };

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
    ...shown.map((c) => {
      const col = byKey.get(c.key) as ListColumn;
      return {
        title: col.title,
        dataIndex: col.key,
        key: col.key,
        width: c.width ?? col.width,
        render: (_: unknown, item: ListItem) => <div className="min-w-0 truncate">{col.render(item)}</div>,
      };
    }),
    {
      title: <ColumnPicker available={available} shown={shown} onChange={setColumns} />,
      key: "__add",
      width: 56,
    },
  ];

  const stats = [
    ["总数", all.length],
    ["已完成", all.filter((i) => i.status === "completed").length],
    ["成员", space.members.length],
    ["我参与的", all.filter((i) => i.roleMembers.some((m) => m.userId === me)).length],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="统计"
        className="grid grid-cols-4 divide-x divide-line-subtle rounded-lg border border-line-subtle bg-surface py-3"
      >
        {stats.map(([label, n]) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <span className="text-xs text-fg-muted">{label}</span>
            <span className="text-xl font-semibold tabular-nums">{n}</span>
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
            <span className="ml-auto flex items-center gap-2 rounded-md bg-brand-50 px-3 py-1 text-sm">
              已选 {selected.length} 项
              <Button size="sm" variant="ghost" onClick={() => toggleMark(selected, "follow", true)}>
                关注
              </Button>
              <Button size="sm" variant="ghost" onClick={() => toggleMark(selected, "star", true)}>
                收藏
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                取消选择
              </Button>
            </span>
          )}
        </div>

        <Table
          size="small"
          bordered
          rowKey="id"
          columns={columns}
          dataSource={rows}
          pagination={rows.length > 50 ? { pageSize: 50 } : false}
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
            selectedRowKeys: selected,
            onChange: (keys?: (string | number)[]) => setSelected((keys ?? []).map(String)),
          }}
          onRow={(item?: ListItem) => {
            const color = item && colorOf(item);
            return color ? { style: { background: color } } : {};
          }}
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
                title={search || Object.values(filter).some((v) => v?.length) ? "没有符合条件的工作项" : "还没有工作项"}
                description={tab === "all" ? "点右上角的「新建」创建第一个工作项。" : "这个页签下还没有工作项。"}
              />
            ) : (
              "加载中…"
            )
          }
        />
      </div>
    </div>
  );
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
