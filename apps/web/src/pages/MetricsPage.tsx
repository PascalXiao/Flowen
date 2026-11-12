import { Popconfirm } from "@douyinfe/semi-ui";
import {
  CHART_KIND_LABEL,
  CHART_KINDS,
  type ChartConfig,
  type ChartContext,
  type ChartData,
  type ChartDimension,
  type ChartDrill,
  type ChartFieldDef,
  type ChartItem,
  type ChartKind,
  checkChartConfig,
  computeChart,
  drillChart,
  METRIC_AGG_LABEL,
  TIME_GRAIN_LABEL,
  TIME_GRAINS,
  type TimeGrain,
} from "@fp/engine";
import { mutators, queries, type WorkItemFilterArgs } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { LayoutDashboard, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { ChartView } from "@/components/ChartView";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorBanner, PageBody, PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";
import { cn, newId } from "@/lib/utils";

type Space = NonNullable<ReturnType<typeof useSpace>>;
const useSpace = (spaceId: string) => useQuery(queries.spaces.byId({ id: spaceId }))[0];

interface ChartRow {
  id: string;
  name: string;
  filter: WorkItemFilterArgs;
  config: ChartConfig;
  createdBy: string;
  onDashboard?: boolean | null;
}

/** 维度在下拉框里的值：type、status、stage、creator、createdAt、role:键、field:键。 */
const dimValue = (d: ChartDimension | null | undefined) =>
  !d ? "" : d.by === "role" || d.by === "field" ? `${d.by}:${d.key}` : d.by;
function parseDim(value: string, grain?: TimeGrain): ChartDimension | null {
  if (!value) return null;
  const [by, ...rest] = value.split(":");
  const key = rest.join(":");
  return { by: by as ChartDimension["by"], ...(key && { key }), ...(grain && { grain }) };
}

/** 数据来源范围内的字段和角色：筛了类型就是这个类型的，没筛就是所有类型的（同键只取一次）。 */
function scopeOf(space: Space, filter: WorkItemFilterArgs) {
  const types = filter.typeIds?.length
    ? space.workItemTypes.filter((t) => filter.typeIds?.includes(t.id))
    : space.workItemTypes;
  const fields = new Map<string, ChartFieldDef>();
  const roles = new Map<string, string>();
  for (const t of types) {
    for (const f of t.fields)
      if (!fields.has(f.key))
        fields.set(f.key, { key: f.key, name: f.name, dataType: f.dataType, options: f.options ?? null });
    for (const r of t.roles) if (!roles.has(r.key)) roles.set(r.key, r.name);
  }
  return { fields: [...fields.values()], roles: [...roles].map(([key, name]) => ({ key, name })) };
}

const TIME_TYPES = ["date", "datetime", "dateRange"];
const NUMERIC_TYPES = ["number", "formula"];
/** 不适合当分组的字段类型。 */
const NO_GROUP_TYPES = [
  "richText",
  "textarea",
  "attachment",
  "fieldGroup",
  "vote",
  "relation",
  "signal",
  "multiSignal",
];

/** 图表数据：同步命中数据来源的工作项（服务端已按权限过滤），在前端按设置汇总。 */
function useChartData(space: Space, filter: WorkItemFilterArgs, config: ChartConfig) {
  return useChart(space, filter, config).data;
}

function useChart(space: Space, filter: WorkItemFilterArgs, config: ChartConfig) {
  // 只同步这张图用到的字段和角色
  const dims = [config.dimension, config.series].flatMap((d) => (d?.key ? [d] : []));
  const [rows] = useQuery(
    queries.workItems.forChart({
      spaceId: space.id,
      filter,
      fields: [
        ...new Set([
          ...dims.filter((d) => d.by === "field").map((d) => d.key as string),
          ...(config.metric.field ? [config.metric.field] : []),
        ]),
      ],
      roles: [...new Set(dims.filter((d) => d.by === "role").map((d) => d.key as string))],
    }),
  );
  return useMemo(() => {
    const items: ChartItem[] = rows.map((w) => {
      const roles: Record<string, string[]> = {};
      for (const m of w.roleMembers) roles[m.roleKey] = [...(roles[m.roleKey] ?? []), m.userId];
      return {
        id: w.id,
        typeId: w.typeId,
        status: w.status ?? "inProgress",
        stage: w.stage,
        createdBy: w.createdBy,
        createdAt: w.createdAt ?? 0,
        values: Object.fromEntries(w.fieldValues.map((v) => [v.fieldKey, v.value])),
        roles,
      };
    });
    const ctx: ChartContext = {
      fields: scopeOf(space, filter).fields,
      typeName: (id) => space.workItemTypes.find((t) => t.id === id)?.name ?? id,
      userName: (id) => space.members.find((m) => m.userId === id)?.user?.name ?? "—",
      timeZone: space.timezone ?? "Asia/Shanghai",
    };
    const byId = new Map(rows.map((w) => [w.id, w]));
    return {
      data: computeChart(items, config, ctx),
      /** 钻取：点中的一格由哪些工作项构成。 */
      drill: (d: ChartDrill) =>
        drillChart(items, config, ctx, d).flatMap((i) => {
          const w = byId.get(i.id);
          return w ? [w] : [];
        }),
    };
  }, [rows, space, filter, config]);
}

type DrillRow = ReturnType<ReturnType<typeof useChart>["drill"]>[number];
const STATUS_TEXT: Record<string, string> = { inProgress: "进行中", completed: "已完成", terminated: "已终止" };

/** 钻取明细：点图上的一格，列出构成它的工作项，点名称打开详情。 */
function DrillDialog({
  space,
  title,
  rows,
  onClose,
}: {
  space: Space;
  title: string;
  rows: readonly DrillRow[];
  onClose: () => void;
}) {
  const typeName = (id: string) => space.workItemTypes.find((t) => t.id === id)?.name ?? "—";
  const userName = (id: string) => space.members.find((m) => m.userId === id)?.user?.name ?? "—";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={title} className="max-w-2xl">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-fg-subtle">共 {rows.length} 个工作项</span>
          <div className="max-h-[60vh] overflow-auto">
            <table aria-label="明细" className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left text-xs text-fg-muted">
                <tr className="border-b border-line-subtle">
                  <th className="h-8 font-normal">名称</th>
                  <th className="font-normal">类型</th>
                  <th className="font-normal">状态</th>
                  <th className="font-normal">创建人</th>
                  <th className="font-normal">创建时间</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="border-b border-line-subtle last:border-0">
                    <td className="h-9 max-w-64 truncate pr-3">
                      <Link to="/items/$itemId" params={{ itemId: w.id }} className="text-brand-500 hover:underline">
                        {w.name}
                      </Link>
                    </td>
                    <td className="pr-3 text-fg-muted">{typeName(w.typeId)}</td>
                    <td className="pr-3 text-fg-muted">
                      {w.status === "inProgress" && w.stage ? w.stage : (STATUS_TEXT[w.status ?? ""] ?? w.status)}
                    </td>
                    <td className="pr-3 text-fg-muted">{userName(w.createdBy)}</td>
                    <td className="tabular-nums text-fg-muted">
                      {w.createdAt ? new Date(w.createdAt).toLocaleDateString("zh-CN") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 钻取弹窗的标题：图表名 · 分组 · 系列。 */
function drillTitle(chart: string, data: ChartData, d: ChartDrill) {
  const group = data.groups.find((g) => g.key === d.group)?.label;
  const series = data.series.length > 1 ? data.series.find((s) => s.key === d.series)?.label : undefined;
  return [chart, group, series].filter(Boolean).join(" · ");
}

/** 一句话说明图表算的是什么：数据来源 · 指标。 */
function describe(space: Space, chart: { filter: WorkItemFilterArgs; config: ChartConfig }) {
  const types = chart.filter.typeIds?.length
    ? space.workItemTypes
        .filter((t) => chart.filter.typeIds?.includes(t.id))
        .map((t) => t.name)
        .join("、")
    : "全部工作项";
  const status =
    chart.filter.statuses?.length === 1 ? (chart.filter.statuses[0] === "completed" ? " · 已完成" : " · 进行中") : "";
  const { fields } = scopeOf(space, chart.filter);
  const m = chart.config.metric;
  const metric =
    m.agg === "count" ? "计数" : `${fields.find((f) => f.key === m.field)?.name ?? m.field} ${METRIC_AGG_LABEL[m.agg]}`;
  return `${types}${status} · ${metric}`;
}

/** 一张保存的图表卡片，度量页和仪表盘共用；能改的人看得到编辑、删除、放到仪表盘。 */
export function MetricChartCard({
  space,
  chart,
  canEdit = false,
  onEdit,
  onDelete,
}: {
  space: Space;
  chart: ChartRow;
  canEdit?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const zero = useZero();
  const pinned = !!chart.onDashboard;
  const { data, drill } = useChart(space, chart.filter, chart.config);
  const [picked, setPicked] = useState<ChartDrill | null>(null);
  return (
    <section
      aria-label={chart.name}
      className="group flex min-w-0 flex-col gap-3 rounded-lg border border-line-subtle bg-surface p-4"
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-sm font-semibold">{chart.name}</h2>
          <span className="truncate text-xs text-fg-subtle">{describe(space, chart)}</span>
        </div>
        {canEdit && (
          <div className="flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <Button
              size="icon"
              variant="ghost"
              aria-label={`${pinned ? "移出仪表盘" : "放到仪表盘"} ${chart.name}`}
              title={pinned ? "移出仪表盘" : "放到仪表盘"}
              className={cn(pinned && "text-brand-500")}
              onClick={() => zero.mutate(mutators.chart.update({ id: chart.id, onDashboard: !pinned }))}
            >
              <LayoutDashboard />
            </Button>
            {onEdit && (
              <Button size="icon" variant="ghost" aria-label={`编辑图表 ${chart.name}`} onClick={onEdit}>
                <Pencil />
              </Button>
            )}
            {onDelete && (
              <Popconfirm
                title={`删除图表「${chart.name}」？`}
                okText="删除"
                cancelText="取消"
                okType="danger"
                onConfirm={onDelete}
              >
                <Button size="icon" variant="ghost" aria-label={`删除图表 ${chart.name}`}>
                  <Trash2 />
                </Button>
              </Popconfirm>
            )}
          </div>
        )}
      </div>
      <ChartView data={data} kind={chart.config.kind} label={chart.name} onPick={setPicked} />
      {picked && (
        <DrillDialog
          space={space}
          title={drillTitle(chart.name, data, picked)}
          rows={drill(picked)}
          onClose={() => setPicked(null)}
        />
      )}
    </section>
  );
}

const DEFAULT_CONFIG: ChartConfig = { kind: "column", dimension: { by: "status" }, metric: { agg: "count" } };

/** 新建 / 编辑图表：左边是设置，下面实时预览。 */
function ChartEditor({ space, chart, onClose }: { space: Space; chart: ChartRow | null; onClose: () => void }) {
  const zero = useZero();
  const [name, setName] = useState(chart?.name ?? "");
  const [filter, setFilter] = useState<WorkItemFilterArgs>(chart?.filter ?? {});
  const [config, setConfig] = useState<ChartConfig>(chart?.config ?? DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const { fields, roles } = scopeOf(space, filter);
  const problem = checkChartConfig(config, fields);
  const set = (patch: Partial<ChartConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const dimFieldType = (d: ChartDimension | null | undefined) =>
    d?.by === "field" ? fields.find((f) => f.key === d.key)?.dataType : undefined;
  const isTime = (d: ChartDimension | null | undefined) =>
    d?.by === "createdAt" || TIME_TYPES.includes(dimFieldType(d) ?? "");
  const hasDimension = config.kind !== "indicator";
  const hasSeries = ["column", "bar", "line", "area", "table"].includes(config.kind);

  const dimOptions = (
    <>
      <optgroup label="系统">
        <option value="type">工作项类型</option>
        <option value="status">状态</option>
        <option value="stage">阶段</option>
        <option value="creator">创建人</option>
        <option value="createdAt">创建时间</option>
      </optgroup>
      {roles.length > 0 && (
        <optgroup label="角色">
          {roles.map((r) => (
            <option key={r.key} value={`role:${r.key}`}>
              {r.name}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="字段">
        {fields
          .filter((f) => !NO_GROUP_TYPES.includes(f.dataType))
          .map((f) => (
            <option key={f.key} value={`field:${f.key}`}>
              {f.name}
            </option>
          ))}
      </optgroup>
    </>
  );

  async function save() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return setError("图表要有名称。");
    if (problem) return setError(problem);
    const { client, server } = zero.mutate(
      chart
        ? mutators.chart.update({ id: chart.id, name: trimmed, filter, config })
        : mutators.chart.create({ id: newId(), spaceId: space.id, name: trimmed, filter, config }),
    );
    for (const outcome of [await client, await server])
      if (outcome.type === "error") return setError(outcome.error.message);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={chart ? "编辑图表" : "新建图表"} className="max-w-2xl">
        <div className="flex flex-col gap-4">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="图表名称" className="sm:col-span-2">
              <Input
                aria-label="图表名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：各阶段需求数"
              />
            </Field>
            <Field label="数据来源">
              <Select
                aria-label="数据来源"
                value={filter.typeIds?.[0] ?? ""}
                onChange={(e) => setFilter((f) => ({ ...f, typeIds: e.target.value ? [e.target.value] : [] }))}
              >
                <option value="">全部工作项类型</option>
                {space.workItemTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="状态范围">
              <Segmented
                label="状态范围"
                value={filter.statuses?.length === 1 ? (filter.statuses[0] ?? "all") : "all"}
                onChange={(v) => setFilter((f) => ({ ...f, statuses: v === "all" ? [] : [v] }))}
                items={[
                  ["all", "全部"],
                  ["inProgress", "进行中"],
                  ["completed", "已完成"],
                ]}
              />
            </Field>
            <Field label="图表样式" className="sm:col-span-2">
              <Segmented
                label="图表样式"
                value={config.kind}
                onChange={(kind: ChartKind) =>
                  set({
                    kind,
                    ...(kind !== "indicator" && !config.dimension && { dimension: { by: "status" } }),
                  })
                }
                items={CHART_KINDS.map((k) => [k, CHART_KIND_LABEL[k]] as const)}
              />
            </Field>
            {hasDimension && (
              <Field label="分组维度">
                <Select
                  aria-label="分组维度"
                  value={dimValue(config.dimension)}
                  onChange={(e) => {
                    const next = parseDim(e.target.value);
                    set({
                      dimension: next && isTime(next) ? { ...next, grain: config.dimension?.grain ?? "month" } : next,
                    });
                  }}
                >
                  {dimOptions}
                </Select>
              </Field>
            )}
            {hasDimension && isTime(config.dimension) && (
              <Field label="时间粒度">
                <Select
                  aria-label="时间粒度"
                  value={config.dimension?.grain ?? "month"}
                  onChange={(e) =>
                    config.dimension && set({ dimension: { ...config.dimension, grain: e.target.value as TimeGrain } })
                  }
                >
                  {TIME_GRAINS.map((g) => (
                    <option key={g} value={g}>
                      {TIME_GRAIN_LABEL[g]}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {hasSeries && (
              <Field label="二级分组">
                <Select
                  aria-label="二级分组"
                  value={dimValue(config.series)}
                  onChange={(e) => {
                    const next = parseDim(e.target.value);
                    set({ series: next && isTime(next) ? { ...next, grain: "month" } : next });
                  }}
                >
                  <option value="">不分组</option>
                  {dimOptions}
                </Select>
              </Field>
            )}
            <Field label="指标">
              <div className="flex gap-2">
                <Select
                  aria-label="指标"
                  value={config.metric.agg}
                  onChange={(e) => {
                    const agg = e.target.value as ChartConfig["metric"]["agg"];
                    const numeric = fields.filter((f) => NUMERIC_TYPES.includes(f.dataType));
                    set({
                      metric:
                        agg === "count"
                          ? { agg }
                          : { agg, ...(numeric[0] && { field: config.metric.field ?? numeric[0].key }) },
                    });
                  }}
                >
                  {(["count", "sum", "avg", "max", "min"] as const).map((a) => (
                    <option key={a} value={a}>
                      {a === "count" ? "工作项数" : METRIC_AGG_LABEL[a]}
                    </option>
                  ))}
                </Select>
                {config.metric.agg !== "count" && (
                  <Select
                    aria-label="指标字段"
                    value={config.metric.field ?? ""}
                    onChange={(e) => set({ metric: { ...config.metric, field: e.target.value } })}
                  >
                    <option value="">选择数字字段</option>
                    {fields
                      .filter((f) => NUMERIC_TYPES.includes(f.dataType))
                      .map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.name}
                        </option>
                      ))}
                  </Select>
                )}
              </div>
            </Field>
            {hasDimension && (
              <Field label="排序">
                <Select
                  aria-label="排序"
                  value={config.sort ?? (isTime(config.dimension) ? "label" : "valueDesc")}
                  onChange={(e) => set({ sort: e.target.value as ChartConfig["sort"] })}
                >
                  <option value="valueDesc">按数值从大到小</option>
                  <option value="valueAsc">按数值从小到大</option>
                  <option value="label">按分组顺序</option>
                </Select>
              </Field>
            )}
            {hasDimension && (
              <Field label="只显示前几个分组" hint="其余合并成「其他」，不填显示全部。">
                <Input
                  aria-label="只显示前几个分组"
                  type="number"
                  min={1}
                  max={100}
                  value={config.limit ?? ""}
                  onChange={(e) => set({ limit: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
                />
              </Field>
            )}
          </div>
          <section aria-label="预览" className="flex flex-col gap-2 rounded-lg border border-line-subtle p-4">
            <span className="text-xs text-fg-subtle">预览</span>
            {problem ? (
              <p className="py-8 text-center text-sm text-fg-subtle">{problem}</p>
            ) : (
              <Preview space={space} filter={filter} config={config} name={name || "预览"} />
            )}
          </section>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={save}>保存</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Preview({
  space,
  filter,
  config,
  name,
}: {
  space: Space;
  filter: WorkItemFilterArgs;
  config: ChartConfig;
  name: string;
}) {
  const data = useChartData(space, filter, config);
  return <ChartView data={data} kind={config.kind} label={`${name}预览`} />;
}

/**
 * 度量：空间里保存的图表，每张图选数据来源、分组维度、指标和样式。
 * 数据按自己能看到的工作项和字段实时计算。成员能新建，创建人和管理员能改、删。
 */
export function MetricsPage() {
  const { spaceId } = useParams({ from: "/app/spaces/$spaceId/metrics" });
  const space = useSpace(spaceId);
  const zero = useZero();
  const me = String(zero.userID);
  const [editing, setEditing] = useState<ChartRow | "new" | null>(null);
  useActiveSpace(spaceId);
  if (!space) return <p className="p-6 text-sm text-fg-subtle">加载中…</p>;
  const myRole = space.members.find((m) => m.userId === me)?.role;
  const isAdmin = myRole === "admin";
  const charts = space.charts as readonly ChartRow[];

  return (
    <>
      <PageHeader
        title="度量"
        breadcrumb={space.name}
        actions={
          myRole !== "guest" && (
            <Button onClick={() => setEditing("new")}>
              <Plus />
              新建图表
            </Button>
          )
        }
      />
      <PageBody className="max-w-6xl">
        {charts.length === 0 ? (
          <div className="rounded-lg border border-line-subtle bg-surface shadow-card">
            <EmptyState
              title="还没有图表"
              description="选一个工作项类型作为数据来源，按状态、阶段、人员、时间或字段分组，看数量或数字字段的汇总。"
              action={
                myRole !== "guest" && (
                  <Button onClick={() => setEditing("new")}>
                    <Plus />
                    新建图表
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {charts.map((c) => (
              <MetricChartCard
                key={c.id}
                space={space}
                chart={c}
                canEdit={isAdmin || c.createdBy === me}
                onEdit={() => setEditing(c)}
                onDelete={() => zero.mutate(mutators.chart.delete({ id: c.id }))}
              />
            ))}
          </div>
        )}
      </PageBody>
      {editing && (
        <ChartEditor space={space} chart={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
