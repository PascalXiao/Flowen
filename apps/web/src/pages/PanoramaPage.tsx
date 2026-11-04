import { type ChartConfig, type ChartContext, type ChartItem, type ChartKind, computeChart } from "@fp/engine";
import { queries } from "@fp/sync";
import { useQuery } from "@rocicorp/zero/react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Database } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { ChartView } from "@/components/ChartView";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";

const useSources = () => useQuery(queries.spaces.panoramaSources())[0];
const usePanorama = (typeIds: string[]) => useQuery(queries.workItems.panorama({ typeIds }))[0];
type Sources = ReturnType<typeof useSources>;
type Item = ReturnType<typeof usePanorama>[number];

/** 聚合字段：跨空间、跨类型都有的系统字段，表格分组和度量都按它们来（对照飞书全景视图的默认聚合字段）。 */
const AGGREGATES = [
  ["space", "所属空间"],
  ["type", "工作项类型"],
  ["status", "状态"],
  ["stage", "进行中节点 / 状态"],
  ["creator", "创建者"],
] as const;
type Aggregate = (typeof AGGREGATES)[number][0];

const STATUS_TEXT: Record<string, string> = { inProgress: "进行中", completed: "已完成", terminated: "已终止" };
const SPACE_KEY = "__space";
/** 表格一次最多显示的行数。 */
const MAX_ROWS = 500;

/**
 * 全景视图（对照飞书项目的全景视图）：把多个空间、多种工作项放在一起看。
 * 数据源是勾选的工作项类型（存在地址栏里，方便分享），可以切表格和度量两种模式。
 */
export function PanoramaPage() {
  const search = useSearch({ from: "/app/panorama" });
  const navigate = useNavigate();
  const spaces = useSources();
  const allTypes = useMemo(() => spaces.flatMap((s) => s.workItemTypes.map((t) => t.id)), [spaces]);
  const typeIds = search.types ?? allTypes;
  const items = usePanorama(typeIds);
  const [mode, setMode] = useState<"table" | "chart">("table");
  const [picking, setPicking] = useState(false);
  const setTypes = (ids: string[]) => navigate({ to: ".", search: { types: ids } });

  const sourceCount = typeIds.length;
  const spaceCount = spaces.filter((s) => s.workItemTypes.some((t) => typeIds.includes(t.id))).length;

  return (
    <>
      <PageHeader
        title="全景视图"
        breadcrumb={`${spaceCount} 个空间 · ${sourceCount} 种工作项 · ${items.length} 条`}
        actions={
          <div className="flex items-center gap-2">
            <Segmented
              label="展示模式"
              value={mode}
              onChange={setMode}
              items={[
                ["table", "表格"],
                ["chart", "度量"],
              ]}
            />
            <Button variant="outline" onClick={() => setPicking(true)}>
              <Database />
              数据源
            </Button>
          </div>
        }
      />
      <PageBody>
        {sourceCount === 0 ? (
          <div className="rounded-lg border border-line-subtle bg-surface">
            <EmptyState
              title="还没有选数据源"
              description="选几个空间里的工作项类型，放在一起看。"
              action={<Button onClick={() => setPicking(true)}>选择数据源</Button>}
            />
          </div>
        ) : mode === "table" ? (
          <PanoramaTable items={items} spaces={spaces} />
        ) : (
          <PanoramaChart items={items} spaces={spaces} />
        )}
      </PageBody>
      {picking && (
        <SourcePicker
          spaces={spaces}
          selected={typeIds}
          onSave={(ids) => {
            setTypes(ids);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

/** 按空间、类型、成员 id 查显示名。 */
function useNames(spaces: Sources) {
  return useMemo(() => {
    const space = new Map(spaces.map((s) => [s.id, s.name]));
    const type = new Map(spaces.flatMap((s) => s.workItemTypes.map((t) => [t.id, t.name] as const)));
    const user = new Map(spaces.flatMap((s) => s.members.map((m) => [m.userId, m.user?.name ?? "—"] as const)));
    return {
      space: (id: string) => space.get(id) ?? "—",
      type: (id: string) => type.get(id) ?? "—",
      user: (id: string) => user.get(id) ?? "—",
    };
  }, [spaces]);
}

const statusOf = (w: Item) => STATUS_TEXT[w.status ?? "inProgress"] ?? w.status ?? "—";

/** 表格模式：可以按一个聚合字段分组，分组头显示条数。 */
function PanoramaTable({ items, spaces }: { items: readonly Item[]; spaces: Sources }) {
  const names = useNames(spaces);
  const [groupBy, setGroupBy] = useState<Aggregate | "">("");
  const cellText = (w: Item, by: Aggregate) =>
    by === "space"
      ? names.space(w.spaceId)
      : by === "type"
        ? names.type(w.typeId)
        : by === "status"
          ? statusOf(w)
          : by === "stage"
            ? (w.stage ?? "—")
            : names.user(w.createdBy);
  const rows = items.slice(0, MAX_ROWS);
  // 几百行以内，直接算
  const groups = (() => {
    if (!groupBy) return [{ key: "", rows }];
    const map = new Map<string, Item[]>();
    for (const w of rows) {
      const key = cellText(w, groupBy);
      map.set(key, [...(map.get(key) ?? []), w]);
    }
    return [...map].map(([key, rows]) => ({ key, rows })).sort((a, b) => b.rows.length - a.rows.length);
  })();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        分组
        <Select
          aria-label="分组"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as Aggregate | "")}
          className="w-44"
        >
          <option value="">不分组</option>
          {AGGREGATES.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
        {items.length > MAX_ROWS && <span>只显示最新的 {MAX_ROWS} 条</span>}
      </div>
      <div className="overflow-x-auto rounded-lg border border-line-subtle bg-surface">
        <table aria-label="全景" className="w-full text-sm">
          <thead className="text-left text-xs text-fg-muted">
            <tr className="border-b border-line-subtle">
              <th className="h-9 px-4 font-normal">名称</th>
              {AGGREGATES.map(([key, label]) => (
                <th key={key} className="pr-3 font-normal">
                  {label}
                </th>
              ))}
              <th className="pr-4 font-normal">创建时间</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.key || "all"}>
                {groupBy && (
                  <tr className="border-b border-line-subtle bg-canvas">
                    <th colSpan={AGGREGATES.length + 2} scope="rowgroup" className="h-8 px-4 text-left font-medium">
                      {g.key} <span className="font-normal text-fg-subtle">{g.rows.length}</span>
                    </th>
                  </tr>
                )}
                {g.rows.map((w) => (
                  <tr key={w.id} className="border-b border-line-subtle last:border-0 hover:bg-hover/40">
                    <td className="h-9 max-w-72 truncate px-4">
                      <Link to="/items/$itemId" params={{ itemId: w.id }} className="text-brand-500 hover:underline">
                        {w.name}
                      </Link>
                    </td>
                    {AGGREGATES.map(([key]) => (
                      <td key={key} className="max-w-48 truncate pr-3 text-fg-muted">
                        {cellText(w, key)}
                      </td>
                    ))}
                    <td className="pr-4 tabular-nums text-fg-muted">
                      {w.createdAt ? new Date(w.createdAt).toLocaleDateString("zh-CN") : "—"}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p className="py-10 text-center text-sm text-fg-subtle">数据源里还没有工作项</p>}
      </div>
    </div>
  );
}

const CHART_KINDS: readonly (readonly [ChartKind, string])[] = [
  ["column", "柱状图"],
  ["bar", "条形图"],
  ["ring", "环形图"],
  ["line", "折线图"],
  ["table", "数据表"],
];
const CHART_DIMS = [
  ["space", "所属空间"],
  ["type", "工作项类型"],
  ["status", "状态"],
  ["stage", "进行中节点 / 状态"],
  ["creator", "创建者"],
  ["createdAt", "创建时间（按月）"],
] as const;

/** 度量模式：按一个聚合字段（或一个再按状态堆叠）计数，和度量页同一套图表。 */
function PanoramaChart({ items, spaces }: { items: readonly Item[]; spaces: Sources }) {
  const names = useNames(spaces);
  const [kind, setKind] = useState<ChartKind>("column");
  const [dim, setDim] = useState<(typeof CHART_DIMS)[number][0]>("space");
  const [stack, setStack] = useState("");
  const data = useMemo(() => {
    const chartItems: ChartItem[] = items.map((w) => ({
      id: w.id,
      typeId: w.typeId,
      status: w.status ?? "inProgress",
      stage: w.stage,
      createdBy: w.createdBy,
      createdAt: w.createdAt ?? 0,
      values: { [SPACE_KEY]: w.spaceId },
      roles: {},
    }));
    // 「所属空间」借用一个单选字段来分组，选项就是数据源里的空间
    const ctx: ChartContext = {
      fields: [
        {
          key: SPACE_KEY,
          name: "所属空间",
          dataType: "select",
          options: spaces.map((s) => ({ value: s.id, label: s.name })),
        },
      ],
      typeName: names.type,
      userName: names.user,
      timeZone: "Asia/Shanghai",
    };
    const toDim = (d: string) =>
      d === "space"
        ? ({ by: "field", key: SPACE_KEY } as const)
        : d === "createdAt"
          ? ({ by: "createdAt", grain: "month" } as const)
          : ({ by: d } as { by: "type" | "status" | "stage" | "creator" });
    const config: ChartConfig = {
      kind,
      dimension: toDim(dim),
      series: stack ? toDim(stack) : null,
      metric: { agg: "count" },
    };
    return computeChart(chartItems, config, ctx);
  }, [items, spaces, names, kind, dim, stack]);

  return (
    <section aria-label="全景度量" className="flex flex-col gap-4 rounded-lg border border-line-subtle bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="图表样式" value={kind} onChange={setKind} items={CHART_KINDS} />
        <Select
          aria-label="分组维度"
          value={dim}
          onChange={(e) => setDim(e.target.value as typeof dim)}
          className="w-44"
        >
          {CHART_DIMS.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
        {kind !== "ring" && (
          <Select aria-label="二级分组" value={stack} onChange={(e) => setStack(e.target.value)} className="w-40">
            <option value="">不堆叠</option>
            {CHART_DIMS.filter(([key]) => key !== dim && key !== "createdAt").map(([key, label]) => (
              <option key={key} value={key}>
                按{label}堆叠
              </option>
            ))}
          </Select>
        )}
        <span className="text-xs text-fg-subtle">计数 · 共 {items.length} 个工作项</span>
      </div>
      <ChartView data={data} kind={kind} label="全景图表" />
    </section>
  );
}

/** 选数据源：按空间列出工作项类型，勾选要放进来的（最多 200 个）。 */
function SourcePicker({
  spaces,
  selected,
  onSave,
  onClose,
}: {
  spaces: Sources;
  selected: readonly string[];
  onSave: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(selected));
  const toggle = (ids: readonly string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="数据源" className="max-w-2xl">
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-auto">
          {spaces.map((s) => {
            const ids = s.workItemTypes.map((t) => t.id);
            if (ids.length === 0) return null;
            const all = ids.every((id) => picked.has(id));
            return (
              <fieldset key={s.id} className="flex flex-col gap-1.5">
                <legend className="mb-1 flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    aria-label={`空间 ${s.name}`}
                    checked={all}
                    onChange={(e) => toggle(ids, e.target.checked)}
                  />
                  {s.name}
                </legend>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 pl-6">
                  {s.workItemTypes.map((t) => (
                    <label key={t.id} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        aria-label={`${s.name} ${t.name}`}
                        checked={picked.has(t.id)}
                        onChange={(e) => toggle([t.id], e.target.checked)}
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="mr-auto text-xs text-fg-subtle">已选 {picked.size} / 200</span>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={picked.size > 200} onClick={() => onSave([...picked])}>
            确定
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
