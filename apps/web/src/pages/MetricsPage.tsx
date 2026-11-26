import {
  CHART_KIND_LABEL,
  CHART_KINDS,
  type ChartCalcField,
  type ChartConfig,
  type ChartContext,
  type ChartData,
  type ChartDimension,
  type ChartDrill,
  type ChartFieldDef,
  type ChartItem,
  type ChartKind,
  type ChartMetric,
  type ChartNode,
  COMPARE_PERIOD_LABEL,
  COMPARE_PERIODS,
  chartFields,
  checkChartConfig,
  computeChart,
  drillChart,
  METRIC_AGG_LABEL,
  METRIC_FORMULA_FUNCTIONS,
  metricLabel,
  metricsOf,
  nodeFlowOf,
  TIME_GRAIN_LABEL,
  TIME_GRAINS,
  type TimeGrain,
} from "@fp/engine";
import { clockFor, mutators, queries, usesClock, type WorkItemFilterArgs } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { LayoutDashboard, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { ChartView } from "@/components/ChartView";
import { FilterConditions, filterTargets, flowNodes, MultiPick } from "@/components/FilterConditions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorBanner, PageBody, PageHeader } from "@/components/ui/page";
import { Popconfirm } from "@/components/ui/popconfirm";
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

/** 维度在下拉框里的值：type、status、stage、creator、createdAt、node…、role:键、field:键。 */
const dimValue = (d: ChartDimension | null | undefined) =>
  !d ? "" : d.by === "role" || d.by === "field" ? `${d.by}:${d.key}` : d.by;
function parseDim(value: string, grain?: TimeGrain): ChartDimension | null {
  if (!value) return null;
  const [by, ...rest] = value.split(":");
  const key = rest.join(":");
  return { by: by as ChartDimension["by"], ...(key && { key }), ...(grain && { grain }) };
}

/** 类型已发布的流程定义。 */
const definitionsOf = (t: Space["workItemTypes"][number]) =>
  t.flowTemplates.flatMap((f) => (f.currentVersion ? [f.currentVersion.definition as unknown] : []));

/** 数据来源范围内的类型、字段和角色：筛了类型就是这个类型的，没筛就是所有类型的（同键只取一次）。 */
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
  const withDefs = types.map((t) => ({ ...t, definitions: definitionsOf(t), fields: t.fields as never }));
  return {
    types: withDefs,
    fields: [...fields.values()],
    roles: [...roles].map(([key, name]) => ({ key, name })),
    nodes: flowNodes(withDefs),
  };
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

/** 动态时间要带上空间时区的今天。 */
const withClock = (filter: WorkItemFilterArgs, timeZone: string) =>
  usesClock(filter) ? { ...filter, clock: clockFor(timeZone) } : filter;

/** 这张图要同步哪些字段：用了公式就全要（公式里可能引用任何字段），否则只要维度和指标用到的。 */
function syncedFields(config: ChartConfig): string[] | undefined {
  const metrics = metricsOf(config);
  if (config.calcFields?.length || metrics.some((m) => m.agg === "formula")) return undefined;
  const keys = new Set<string>();
  for (const d of [config.dimension, config.dimension2, config.series]) if (d?.by === "field" && d.key) keys.add(d.key);
  for (const m of metrics) if (m.field && !m.field.startsWith("$")) keys.add(m.field);
  if (config.kind === "compare" && config.compare && config.compare.time !== "createdAt") keys.add(config.compare.time);
  return keys.size > 40 ? undefined : [...keys];
}

/** 图表数据：同步命中数据来源的工作项（服务端已按权限过滤），在前端按设置汇总。 */
function useChart(space: Space, filter: WorkItemFilterArgs, config: ChartConfig) {
  const timeZone = space.timezone ?? "Asia/Shanghai";
  const dims = [config.dimension, config.dimension2, config.series].flatMap((d) => (d?.key ? [d] : []));
  const [rows] = useQuery(
    queries.workItems.forChart({
      spaceId: space.id,
      filter: withClock(filter, timeZone),
      fields: syncedFields(config),
      roles: [...new Set(dims.filter((d) => d.by === "role").map((d) => d.key as string))],
      nodes: config.object === "node",
    }),
  );
  return useMemo(() => {
    // 节点名和流程顺序：按各类型已发布的节点流
    const nodeInfo = new Map<string, { name: string; order: number }>();
    for (const t of space.workItemTypes)
      for (const d of definitionsOf(t))
        for (const n of nodeFlowOf(d)?.nodes ?? [])
          if (!nodeInfo.has(n.key)) nodeInfo.set(n.key, { name: n.name, order: nodeInfo.size });
    const ms = (v: unknown) => (typeof v === "number" ? v : v ? new Date(String(v)).getTime() : null);
    const items: ChartItem[] = rows.map((w) => {
      const roles: Record<string, string[]> = {};
      for (const m of w.roleMembers) roles[m.roleKey] = [...(roles[m.roleKey] ?? []), m.userId];
      const nodes: ChartNode[] = [...w.nodes]
        .sort((a, b) => (nodeInfo.get(a.nodeKey)?.order ?? 999) - (nodeInfo.get(b.nodeKey)?.order ?? 999))
        .map((n) => ({
          key: n.nodeKey,
          name: nodeInfo.get(n.nodeKey)?.name ?? n.nodeKey,
          state: n.state ?? "notStarted",
          owners: (n.owners as string[] | null) ?? [],
          plannedStart: ms(n.plannedStart),
          plannedEnd: ms(n.plannedEnd),
          actualStart: ms(n.actualStart),
          actualEnd: ms(n.actualEnd),
          points: n.points ?? null,
          actualHours: n.actualHours ?? null,
        }));
      return {
        id: w.id,
        typeId: w.typeId,
        status: w.status ?? "inProgress",
        stage: w.stage,
        createdBy: w.createdBy,
        createdAt: w.createdAt ?? 0,
        values: Object.fromEntries(w.fieldValues.map((v) => [v.fieldKey, v.value])),
        roles,
        nodes,
      };
    });
    const ctx: ChartContext = {
      fields: scopeOf(space, filter).fields,
      typeName: (id) => space.workItemTypes.find((t) => t.id === id)?.name ?? id,
      userName: (id) => space.members.find((m) => m.userId === id)?.user?.name ?? "—",
      timeZone,
    };
    const byId = new Map(rows.map((w) => [w.id, w]));
    let data: ChartData;
    let error: string | null = null;
    try {
      data = computeChart(items, config, ctx);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      data = { groups: [], series: [], total: 0, totals: [], count: 0, unit: "item" };
    }
    return {
      data,
      error,
      /** 钻取：点中的一格由哪些工作项构成。 */
      drill: (d: ChartDrill) =>
        drillChart(items, config, ctx, d).flatMap((i) => {
          const w = byId.get(i.id);
          return w ? [w] : [];
        }),
    };
  }, [rows, space, filter, config, timeZone]);
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
                      <Link to="/items/$itemId" params={{ itemId: w.id }} className="text-accent hover:underline">
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

/** 一句话说明图表算的是什么：数据来源 · 对象 · 指标。 */
function describe(space: Space, chart: { filter: WorkItemFilterArgs; config: ChartConfig }) {
  const types = chart.filter.typeIds?.length
    ? space.workItemTypes
        .filter((t) => chart.filter.typeIds?.includes(t.id))
        .map((t) => t.name)
        .join("、")
    : "全部工作项";
  const status =
    chart.filter.statuses?.length === 1 ? (chart.filter.statuses[0] === "completed" ? " · 已完成" : " · 进行中") : "";
  const conds = chart.filter.conds?.groups.length ? " · 已筛选" : "";
  const object = chart.config.object === "node" ? " · 按节点" : "";
  const fields = chartFields(chart.config, scopeOf(space, chart.filter).fields);
  const metrics = metricsOf(chart.config)
    .map((m) => metricLabel(m, fields))
    .join("、");
  return `${types}${status}${conds}${object} · ${metrics}`;
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
  const { data, drill, error } = useChart(space, chart.filter, chart.config);
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
              className={cn(pinned && "text-accent")}
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
      {error ? (
        <p className="py-8 text-center text-sm text-fg-subtle">{error}</p>
      ) : (
        <ChartView data={data} kind={chart.config.kind} label={chart.name} onPick={setPicked} options={chart.config} />
      )}
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

/** 样式能用的设置。 */
const NO_DIMENSION: readonly ChartKind[] = ["indicator", "compare"];
const SINGLE_METRIC: readonly ChartKind[] = ["ring", "waterfall", "funnel", "compare"];
const WITH_SERIES: readonly ChartKind[] = ["column", "bar", "line", "area", "table", "radar"];
const WITH_LABELS: readonly ChartKind[] = ["column", "bar", "line", "area", "waterfall"];
const WITH_REFLINE: readonly ChartKind[] = ["column", "bar", "line", "area"];
const WITH_SORT: readonly ChartKind[] = [
  "column",
  "bar",
  "line",
  "area",
  "ring",
  "table",
  "pivot",
  "waterfall",
  "radar",
  "funnel",
];

const AGG_OPTIONS = ["count", "countDistinct", "sum", "avg", "max", "min", "median", "formula"] as const;
const AGG_TEXT: Record<(typeof AGG_OPTIONS)[number], string> = {
  ...METRIC_AGG_LABEL,
  count: "工作项数",
  formula: "指标公式",
};

/** 设置里的一小节：标题和内容。 */
function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section
      aria-label={`设置：${title}`}
      className="flex flex-col gap-3 border-t border-line-subtle pt-4 first:border-0 first:pt-0"
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="text-xs font-medium text-fg-muted">{title}</h3>
        {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** 新建 / 编辑图表：左边是设置，右边实时预览。 */
function ChartEditor({ space, chart, onClose }: { space: Space; chart: ChartRow | null; onClose: () => void }) {
  const zero = useZero();
  const [name, setName] = useState(chart?.name ?? "");
  const [filter, setFilter] = useState<WorkItemFilterArgs>(chart?.filter ?? {});
  const [config, setConfig] = useState<ChartConfig>(chart?.config ?? DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const scope = scopeOf(space, filter);
  const { fields, roles } = scope;
  const allFields = chartFields(config, fields);
  const problem = checkChartConfig(config, fields);
  const set = (patch: Partial<ChartConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const metrics = metricsOf(config);
  const setMetrics = (list: ChartMetric[]) =>
    set({ metric: list[0] ?? { agg: "count" }, metrics: list.length > 1 ? list : undefined });
  const calcs = config.calcFields ?? [];
  const setCalcs = (list: ChartCalcField[]) => set({ calcFields: list.length ? list : undefined });
  const isNode = config.object === "node";
  const dimFieldType = (d: ChartDimension | null | undefined) =>
    d?.by === "field" ? allFields.find((f) => f.key === d.key)?.dataType : undefined;
  const isTime = (d: ChartDimension | null | undefined) =>
    d?.by === "createdAt" || d?.by === "nodeEnd" || TIME_TYPES.includes(dimFieldType(d) ?? "");
  const kind = config.kind;
  const hasDimension = !NO_DIMENSION.includes(kind);
  const multiMetric = metrics.length > 1;
  const hasSeries = (WITH_SERIES.includes(kind) && !multiMetric) || kind === "pivot";
  const seriesCount = multiMetric ? metrics.length : config.series && hasSeries ? 2 : 1;
  const numericFields = allFields.filter((f) => NUMERIC_TYPES.includes(f.dataType));
  const groupFields = allFields.filter((f) => !NO_GROUP_TYPES.includes(f.dataType) && !f.key.startsWith("$node."));
  const members = space.members.map((m) => ({ id: m.userId, name: m.user?.name ?? "—" }));
  const stages = [
    ...new Set(
      scope.types.flatMap((t) =>
        t.definitions.flatMap((d) => (nodeFlowOf(d)?.nodes ?? []).map((n) => n.stageOnArrival)),
      ),
    ),
  ].filter((s): s is string => !!s);

  const dimOptions = (
    <>
      <optgroup label="系统">
        <option value="type">工作项类型</option>
        <option value="status">状态</option>
        <option value="stage">阶段</option>
        <option value="creator">创建人</option>
        <option value="createdAt">创建时间</option>
      </optgroup>
      {isNode && (
        <optgroup label="节点">
          <option value="node">节点</option>
          <option value="nodeOwner">节点负责人</option>
          <option value="nodeState">节点状态</option>
          <option value="nodeEnd">节点完成时间</option>
        </optgroup>
      )}
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
        {groupFields
          .filter((f) => !f.key.startsWith("calc:"))
          .map((f) => (
            <option key={f.key} value={`field:${f.key}`}>
              {f.name}
            </option>
          ))}
      </optgroup>
      {calcs.length > 0 && (
        <optgroup label="计算字段">
          {calcs.map((c) => (
            <option key={c.key} value={`field:calc:${c.key}`}>
              {c.name || "未命名"}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );

  /** 维度下拉：选时间维度时默认按月。 */
  const dimSelect = (
    label: string,
    value: ChartDimension | null | undefined,
    onChange: (d: ChartDimension | null) => void,
    optional?: string,
  ) => (
    <Field label={label}>
      <Select
        aria-label={label}
        value={dimValue(value)}
        onChange={(e) => {
          const next = parseDim(e.target.value);
          onChange(next && isTime(next) ? { ...next, grain: value?.grain ?? "month" } : next);
        }}
      >
        {optional && <option value="">{optional}</option>}
        {dimOptions}
      </Select>
    </Field>
  );
  const grainSelect = (label: string, value: ChartDimension, onChange: (d: ChartDimension) => void) => (
    <Field label={label}>
      <Select
        aria-label={label}
        value={value.grain ?? "month"}
        onChange={(e) => onChange({ ...value, grain: e.target.value as TimeGrain })}
      >
        {TIME_GRAINS.map((g) => (
          <option key={g} value={g}>
            {TIME_GRAIN_LABEL[g]}
          </option>
        ))}
      </Select>
    </Field>
  );

  function changeKind(next: ChartKind) {
    setConfig((c) => {
      const list = metricsOf(c);
      return {
        ...c,
        kind: next,
        ...(!NO_DIMENSION.includes(next) && !c.dimension && { dimension: { by: "status" } }),
        ...(next === "compare" &&
          !c.compare && { compare: { time: "createdAt", period: "thisMonth", against: ["prev"] } }),
        // 只能有一个指标的样式：留第一个
        ...(SINGLE_METRIC.includes(next) && list.length > 1 && { metrics: undefined, metric: list[0] ?? c.metric }),
      };
    });
  }

  function changeObject(next: "item" | "node") {
    setConfig((c) => {
      if (next === "node") return { ...c, object: "node" };
      const nodeDim = (d: ChartDimension | null | undefined) =>
        d && ["node", "nodeOwner", "nodeState", "nodeEnd"].includes(d.by) ? null : d;
      const list = metricsOf(c).map((m) => (m.field?.startsWith("$node.") ? { agg: "count" as const } : m));
      return {
        ...c,
        object: undefined,
        nodeKeys: undefined,
        dimension: nodeDim(c.dimension) ?? (NO_DIMENSION.includes(c.kind) ? null : { by: "status" }),
        dimension2: nodeDim(c.dimension2),
        series: nodeDim(c.series),
        metric: list[0] ?? { agg: "count" },
        metrics: list.length > 1 ? list : undefined,
      };
    });
  }

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

  const compare = config.compare;
  const setCompare = (patch: Partial<NonNullable<ChartConfig["compare"]>>) =>
    compare && set({ compare: { ...compare, ...patch } });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={chart ? "编辑图表" : "新建图表"} className="top-[5vh] max-h-[90vh] max-w-5xl">
        <div className="flex flex-col gap-4">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <Section title="数据">
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
                      onChange={(e) =>
                        setFilter((f) => ({ ...f, typeIds: e.target.value ? [e.target.value] : [], conds: undefined }))
                      }
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
                  <div className="flex flex-col gap-1.5 sm:col-span-2">
                    <span className="text-sm">筛选条件</span>
                    <div>
                      <FilterConditions
                        targets={filterTargets({ types: scope.types, members, stages })}
                        nodes={scope.nodes}
                        value={filter.conds}
                        onChange={(conds) => setFilter((f) => ({ ...f, conds }))}
                      />
                    </div>
                  </div>
                  <Field label="度量对象" hint={isNode ? "每个工作项的每个节点算一行。" : undefined}>
                    <Segmented
                      label="度量对象"
                      value={isNode ? "node" : "item"}
                      onChange={changeObject}
                      items={[
                        ["item", "工作项"],
                        ["node", "节点"],
                      ]}
                    />
                  </Field>
                  {isNode && (
                    <Field label="只看这些节点">
                      <MultiPick
                        label="只看这些节点"
                        choices={scope.nodes}
                        value={config.nodeKeys ?? []}
                        onChange={(keys) => set({ nodeKeys: keys.length ? keys : undefined })}
                        placeholder="全部节点"
                      />
                    </Field>
                  )}
                </div>
              </Section>

              <Section title="图表样式">
                <Segmented
                  label="图表样式"
                  value={kind}
                  onChange={changeKind}
                  className="flex flex-wrap"
                  items={CHART_KINDS.map((k) => [k, CHART_KIND_LABEL[k]] as const)}
                />
              </Section>

              {hasDimension && (
                <Section title="维度">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {dimSelect(
                      kind === "pivot" ? "行维度" : kind === "radar" ? "分组维度（雷达的轴）" : "分组维度",
                      config.dimension,
                      (d) => set({ dimension: d }),
                    )}
                    {isTime(config.dimension) &&
                      config.dimension &&
                      grainSelect("时间粒度", config.dimension, (d) => set({ dimension: d }))}
                    {kind === "pivot" &&
                      dimSelect("第二层行", config.dimension2, (d) => set({ dimension2: d }), "不分层")}
                    {kind === "pivot" &&
                      isTime(config.dimension2) &&
                      config.dimension2 &&
                      grainSelect("第二层粒度", config.dimension2, (d) => set({ dimension2: d }))}
                    {hasSeries &&
                      dimSelect(
                        kind === "pivot" ? "列维度" : "二级分组",
                        config.series,
                        (d) => set({ series: d }),
                        "不分组",
                      )}
                    {hasSeries &&
                      isTime(config.series) &&
                      config.series &&
                      grainSelect(kind === "pivot" ? "列粒度" : "二级分组粒度", config.series, (d) =>
                        set({ series: d }),
                      )}
                  </div>
                  {multiMetric && WITH_SERIES.includes(kind) && (
                    <p className="text-xs text-fg-subtle">有多个指标时，每个指标是一个系列，不再按二级分组拆分。</p>
                  )}
                </Section>
              )}

              <Section
                title="指标"
                hint={
                  SINGLE_METRIC.includes(kind)
                    ? `${CHART_KIND_LABEL[kind]}只用一个指标。`
                    : "可以加多个指标，每个指标一个系列（同一坐标轴）。"
                }
              >
                <ol aria-label="指标列表" className="flex flex-col gap-3">
                  {metrics.map((m, i) => (
                    <MetricRow
                      // biome-ignore lint/suspicious/noArrayIndexKey: 指标没有自己的 id，按位置编辑
                      key={i}
                      index={i}
                      metric={m}
                      fields={allFields}
                      numeric={numericFields}
                      groupable={groupFields}
                      onChange={(next) => setMetrics(metrics.map((x, k) => (k === i ? next : x)))}
                      onRemove={metrics.length > 1 ? () => setMetrics(metrics.filter((_, k) => k !== i)) : undefined}
                    />
                  ))}
                </ol>
                {!SINGLE_METRIC.includes(kind) && metrics.length < 10 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => setMetrics([...metrics, { agg: "count" }])}
                  >
                    <Plus />
                    添加指标
                  </Button>
                )}
              </Section>

              <Section
                title="计算字段"
                hint="对每一行算一个值，写法同公式字段，如 DAYS(TODAY(), {创建时间})。算出的字段可以拿来分组或汇总。"
              >
                {calcs.length > 0 && (
                  <ol aria-label="计算字段列表" className="flex flex-col gap-2">
                    {calcs.map((c, i) => (
                      <li key={c.key} className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-start gap-2">
                        <Input
                          aria-label={`计算字段 ${i + 1} 名称`}
                          value={c.name}
                          placeholder="名称"
                          onChange={(e) =>
                            setCalcs(calcs.map((x) => (x.key === c.key ? { ...x, name: e.target.value } : x)))
                          }
                        />
                        <Input
                          aria-label={`计算字段 ${i + 1} 公式`}
                          value={c.expr}
                          placeholder="{估分} * 8"
                          className="font-mono text-[12.5px]"
                          onChange={(e) =>
                            setCalcs(calcs.map((x) => (x.key === c.key ? { ...x, expr: e.target.value } : x)))
                          }
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`删除计算字段 ${c.name || i + 1}`}
                          onClick={() => setCalcs(calcs.filter((x) => x.key !== c.key))}
                        >
                          <X />
                        </Button>
                      </li>
                    ))}
                  </ol>
                )}
                {calcs.length < 20 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => setCalcs([...calcs, { key: newId().slice(0, 8), name: "", expr: "" }])}
                  >
                    <Plus />
                    添加计算字段
                  </Button>
                )}
              </Section>

              {kind === "compare" && compare && (
                <Section title="对比" hint="主指标只算统计周期内的，再和上一周期、去年同期或目标值比。">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="按哪个时间统计">
                      <Select
                        aria-label="按哪个时间统计"
                        value={compare.time}
                        onChange={(e) => setCompare({ time: e.target.value })}
                      >
                        <option value="createdAt">创建时间</option>
                        {fields
                          .filter((f) => TIME_TYPES.includes(f.dataType))
                          .map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.name}
                            </option>
                          ))}
                      </Select>
                    </Field>
                    <Field label="统计周期">
                      <Select
                        aria-label="统计周期"
                        value={compare.period}
                        onChange={(e) => setCompare({ period: e.target.value as (typeof COMPARE_PERIODS)[number] })}
                      >
                        {COMPARE_PERIODS.map((p) => (
                          <option key={p} value={p}>
                            {COMPARE_PERIOD_LABEL[p]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {compare.period === "pastDays" && (
                      <Field label="天数">
                        <Input
                          aria-label="天数"
                          type="number"
                          min={1}
                          max={366}
                          value={compare.days ?? 7}
                          onChange={(e) => setCompare({ days: Math.max(1, Number(e.target.value) || 1) })}
                        />
                      </Field>
                    )}
                    <Field label="目标值" hint="不填不比目标。">
                      <Input
                        aria-label="目标值"
                        type="number"
                        value={compare.target ?? ""}
                        onChange={(e) => setCompare({ target: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </Field>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm">对比</span>
                      <div className="flex gap-4">
                        {(
                          [
                            ["prev", "环比（上一周期）"],
                            ["yoy", "同比（去年同期）"],
                          ] as const
                        ).map(([key, text]) => (
                          <Checkbox
                            key={key}
                            checked={compare.against.includes(key)}
                            onChange={(e) =>
                              setCompare({
                                against: e.target.checked
                                  ? [...compare.against, key]
                                  : compare.against.filter((a) => a !== key),
                              })
                            }
                          >
                            {text}
                          </Checkbox>
                        ))}
                      </div>
                    </div>
                    <Field label="数值">
                      <Segmented
                        label="数值方向"
                        value={compare.better ?? "up"}
                        onChange={(better) => setCompare({ better })}
                        items={[
                          ["up", "越大越好"],
                          ["down", "越小越好"],
                        ]}
                      />
                    </Field>
                  </div>
                </Section>
              )}

              {hasDimension && (
                <Section title="显示">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {WITH_SORT.includes(kind) && (
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
                    {(kind === "column" || kind === "bar") && seriesCount > 1 && (
                      <Field label="多个系列">
                        <Segmented
                          label="多个系列"
                          value={config.stack ?? (multiMetric ? "grouped" : "stacked")}
                          onChange={(stack) => set({ stack })}
                          items={[
                            ["stacked", "堆叠"],
                            ["grouped", "并排"],
                            ["percent", "百分比堆叠"],
                          ]}
                        />
                      </Field>
                    )}
                    {WITH_REFLINE.includes(kind) && seriesCount === 1 && (
                      <Field label="参考线">
                        <div className="flex gap-2">
                          <Select
                            aria-label="参考线"
                            value={config.refLine?.kind ?? ""}
                            onChange={(e) =>
                              set({
                                refLine: e.target.value
                                  ? {
                                      kind: e.target.value as NonNullable<ChartConfig["refLine"]>["kind"],
                                      ...(e.target.value === "const" && { value: config.refLine?.value ?? 0 }),
                                    }
                                  : null,
                              })
                            }
                          >
                            <option value="">不显示</option>
                            <option value="avg">平均值</option>
                            <option value="median">中位数</option>
                            <option value="max">最大值</option>
                            <option value="min">最小值</option>
                            <option value="const">固定值</option>
                          </Select>
                          {config.refLine?.kind === "const" && (
                            <Input
                              aria-label="参考值"
                              type="number"
                              className="w-24"
                              value={config.refLine.value ?? 0}
                              onChange={(e) => set({ refLine: { kind: "const", value: Number(e.target.value) || 0 } })}
                            />
                          )}
                        </div>
                      </Field>
                    )}
                    <div className="flex flex-col gap-2 sm:col-span-2">
                      {WITH_LABELS.includes(kind) && (
                        <Checkbox
                          checked={!!config.labels}
                          onChange={(e) => set({ labels: e.target.checked || undefined })}
                        >
                          在图上标出数值
                        </Checkbox>
                      )}
                      {["column", "line", "area", "table"].includes(kind) && isTime(config.dimension) && (
                        <Checkbox
                          checked={!!config.accumulate}
                          onChange={(e) => set({ accumulate: e.target.checked || undefined })}
                        >
                          按时间累计（看累计趋势）
                        </Checkbox>
                      )}
                    </div>
                  </div>
                </Section>
              )}
            </div>

            <section
              aria-label="预览"
              className="flex min-w-0 flex-col gap-2 self-start rounded-lg border border-line-subtle p-4 lg:sticky lg:top-0"
            >
              <span className="text-xs text-fg-subtle">预览</span>
              {problem ? (
                <p className="py-8 text-center text-sm text-fg-subtle">{problem}</p>
              ) : (
                <Preview space={space} filter={filter} config={config} name={name || "预览"} />
              )}
            </section>
          </div>
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

/** 一个指标：汇总方式、字段（或公式）、显示名。 */
function MetricRow({
  index,
  metric,
  fields,
  numeric,
  groupable,
  onChange,
  onRemove,
}: {
  index: number;
  metric: ChartMetric;
  fields: readonly ChartFieldDef[];
  numeric: readonly ChartFieldDef[];
  groupable: readonly ChartFieldDef[];
  onChange: (next: ChartMetric) => void;
  onRemove?: () => void;
}) {
  const n = index + 1;
  // 第一个指标的下拉沿用「指标」「指标字段」这两个名字
  const aggLabel = index === 0 ? "指标" : `指标 ${n}`;
  const fieldLabel = index === 0 ? "指标字段" : `指标 ${n} 字段`;
  const choices = metric.agg === "countDistinct" ? groupable : numeric;
  return (
    <li className="flex flex-col gap-2 rounded-md bg-raised/50 p-2.5">
      <div className="flex gap-2">
        <Select
          aria-label={aggLabel}
          value={metric.agg}
          onChange={(e) => {
            const agg = e.target.value as ChartMetric["agg"];
            const label = metric.label ? { label: metric.label } : {};
            if (agg === "count") return onChange({ agg, ...label });
            if (agg === "formula") return onChange({ agg, expr: metric.expr ?? "COUNT()", ...label });
            const keep = choices.some((f) => f.key === metric.field) ? metric.field : undefined;
            const pool = agg === "countDistinct" ? groupable : numeric;
            const field = keep ?? pool[0]?.key;
            return onChange({ agg, ...(field && { field }), ...label });
          }}
        >
          {AGG_OPTIONS.map((a) => (
            <option key={a} value={a}>
              {AGG_TEXT[a]}
            </option>
          ))}
        </Select>
        {metric.agg !== "count" && metric.agg !== "formula" && (
          <Select
            aria-label={fieldLabel}
            value={metric.field ?? ""}
            onChange={(e) => onChange({ ...metric, field: e.target.value })}
          >
            <option value="">{metric.agg === "countDistinct" ? "选择字段" : "选择数字字段"}</option>
            {choices.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </Select>
        )}
        <Input
          aria-label={`指标 ${n} 名称`}
          className="w-32 shrink-0"
          value={metric.label ?? ""}
          placeholder={metricLabel({ ...metric, label: undefined }, fields)}
          onChange={(e) => onChange({ ...metric, label: e.target.value || undefined })}
        />
        {onRemove && (
          <Button size="icon" variant="ghost" aria-label={`删除指标 ${n}`} onClick={onRemove}>
            <X />
          </Button>
        )}
      </div>
      {metric.agg === "formula" && (
        <div className="flex flex-col gap-1">
          <Textarea
            aria-label={`指标 ${n} 公式`}
            className="min-h-14 font-mono text-[12.5px]"
            value={metric.expr ?? ""}
            placeholder='COUNTIF({状态} = "已完成") / COUNT() * 100'
            onChange={(e) => onChange({ ...metric, expr: e.target.value })}
          />
          <p className="text-xs text-fg-subtle">
            汇总函数：{METRIC_FORMULA_FUNCTIONS.map((f) => f.name).join("、")}。参数按每一行算，字段写成 {"{字段名}"}
            ，系统字段有 {"{状态}"}、{"{阶段}"}、{"{类型}"}、{"{创建时间}"}；函数外可以加减乘除、ROUND、IF。
          </p>
        </div>
      )}
    </li>
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
  const { data, error } = useChart(space, filter, config);
  if (error) return <p className="py-8 text-center text-sm text-fg-subtle">{error}</p>;
  return <ChartView data={data} kind={config.kind} label={`${name}预览`} options={config} />;
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
