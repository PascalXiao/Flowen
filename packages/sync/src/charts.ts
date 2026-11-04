import type { WorkItemFilter } from "@fp/db/schema";
import { CHART_KINDS, type ChartConfig, checkChartConfig, TIME_GRAINS } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { spaceMemberOf } from "./access.ts";
import { zql } from "./schema.gen.ts";
import { workItemFilter } from "./views.ts";

const dimension = z.object({
  by: z.enum(["type", "status", "stage", "creator", "createdAt", "role", "field"]),
  key: z.string().min(1).max(100).optional(),
  grain: z.enum(TIME_GRAINS).optional(),
});

/** 图表设置：样式、维度、二级分组、指标、排序和只看前几个。 */
export const chartConfig = z.object({
  kind: z.enum(CHART_KINDS),
  dimension: dimension.nullish(),
  series: dimension.nullish(),
  metric: z.object({
    agg: z.enum(["count", "sum", "avg", "max", "min"]),
    field: z.string().min(1).max(100).optional(),
  }),
  sort: z.enum(["valueDesc", "valueAsc", "label"]).optional(),
  limit: z.number().int().min(1).max(100).nullish(),
});

export const createChartArgs = z.object({
  id: z.string(),
  spaceId: z.string(),
  name: z.string().trim().min(1, "图表要有名称。").max(50),
  filter: workItemFilter,
  config: chartConfig,
});
export const updateChartArgs = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(50).optional(),
  filter: workItemFilter.optional(),
  config: chartConfig.optional(),
});
export const deleteChartArgs = z.object({ id: z.string() });
/** 调整度量页上图表的顺序：按给定的 id 顺序重排。 */
export const reorderChartsArgs = z.object({ spaceId: z.string(), ids: z.array(z.string()).max(200) });

const compactFilter = (filter: z.output<typeof workItemFilter>) =>
  Object.fromEntries(Object.entries(filter).filter(([, v]) => v?.length)) as WorkItemFilter;

/** 图表引用的字段要在筛选的类型（不筛类型时是空间里所有类型）里存在。 */
async function checkConfig(tx: Transaction, spaceId: string, filter: WorkItemFilter, config: ChartConfig) {
  const types = await tx.run(zql.workItemType.where("spaceId", spaceId).related("fields"));
  const scoped = filter.typeIds?.length ? types.filter((t) => filter.typeIds?.includes(t.id)) : types;
  const fields = scoped.flatMap((t) => t.fields.map((f) => ({ ...f, options: f.options ?? null })));
  const error = checkChartConfig(config, fields);
  if (error) throw new Error(error);
}

/** 新建图表：空间管理员和成员（访客不行），所有成员都能看到。 */
export async function createChart(tx: Transaction, args: z.output<typeof createChartArgs>, userID: string) {
  const member = await spaceMemberOf(tx, args.spaceId, userID);
  if (!member) throw new Error("不是空间成员。");
  if (member.role === "guest") throw new Error("访客只能查看和评论。");
  const filter = compactFilter(args.filter);
  await checkConfig(tx, args.spaceId, filter, args.config);
  const existing = await tx.run(zql.metricChart.where("spaceId", args.spaceId));
  await tx.mutate.metricChart.insert({
    id: args.id,
    spaceId: args.spaceId,
    name: args.name,
    filter,
    config: args.config,
    sort: existing.length,
    createdBy: userID,
    createdAt: Date.now(),
  });
}

async function editableChart(tx: Transaction, id: string, userID: string, verb: string) {
  const chart = await tx.run(zql.metricChart.where("id", id).one());
  if (!chart) throw new Error("图表不存在。");
  const member = await spaceMemberOf(tx, chart.spaceId, userID);
  if (chart.createdBy !== userID && member?.role !== "admin")
    throw new Error(`只有创建人或空间管理员可以${verb}图表。`);
  return chart;
}

/** 改图表：创建人或空间管理员。 */
export async function updateChart(tx: Transaction, args: z.output<typeof updateChartArgs>, userID: string) {
  const chart = await editableChart(tx, args.id, userID, "修改");
  const filter = args.filter ? compactFilter(args.filter) : (chart.filter as WorkItemFilter);
  const config = (args.config ?? chart.config) as ChartConfig;
  if (args.filter || args.config) await checkConfig(tx, chart.spaceId, filter, config);
  await tx.mutate.metricChart.update({
    id: args.id,
    ...(args.name !== undefined && { name: args.name }),
    ...(args.filter && { filter }),
    ...(args.config && { config }),
  });
}

/** 删除图表：创建人或空间管理员。 */
export async function deleteChart(tx: Transaction, args: z.output<typeof deleteChartArgs>, userID: string) {
  await editableChart(tx, args.id, userID, "删除");
  await tx.mutate.metricChart.delete({ id: args.id });
}

/** 调整顺序：空间成员都可以（顺序是大家共用的）。 */
export async function reorderCharts(tx: Transaction, args: z.output<typeof reorderChartsArgs>, userID: string) {
  const member = await spaceMemberOf(tx, args.spaceId, userID);
  if (!member || member.role === "guest") throw new Error("没有权限调整图表顺序。");
  const charts = await tx.run(zql.metricChart.where("spaceId", args.spaceId));
  for (const [sort, id] of args.ids.entries())
    if (charts.some((c) => c.id === id && c.sort !== sort)) await tx.mutate.metricChart.update({ id, sort });
}
