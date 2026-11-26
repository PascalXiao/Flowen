import type { ViewDisplay, WorkItemFilter } from "@fp/db/schema";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { spaceMemberOf } from "./access.ts";
import { zql } from "./schema.gen.ts";

export const DATE_PRESETS = [
  "today",
  "yesterday",
  "tomorrow",
  "thisWeek",
  "lastWeek",
  "nextWeek",
  "thisMonth",
  "lastMonth",
  "nextMonth",
  "pastDays",
  "nextDays",
  "beforeToday",
] as const;

/** 条件组里的一个条件（见 db 的 FilterCond）。 */
export const filterCond = z.object({
  field: z.string().min(1).max(200),
  op: z.enum(["in", "notIn", "contains", "notContains", "range", "empty", "notEmpty", "date"]),
  values: z.array(z.string()).max(50).optional(),
  text: z.string().trim().max(100).optional(),
  min: z.union([z.number(), z.string()]).optional(),
  max: z.union([z.number(), z.string()]).optional(),
  date: z.object({ preset: z.enum(DATE_PRESETS), n: z.number().int().min(1).max(3650).optional() }).optional(),
});
export type FilterCondArgs = z.output<typeof filterCond>;

const DAY = 86_400_000;
/** YYYY-MM-DD 是 1970-01-01 之后的第几天。 */
export const dayOf = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
export const dateOfDay = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

/** 动态时间换算成天数范围 [起, 止]（都含）；起或止为空表示不限。周一是一周的第一天。 */
export function presetDays(
  today: string,
  preset: (typeof DATE_PRESETS)[number],
  n = 7,
): [number | null, number | null] {
  const t = dayOf(today);
  const weekday = (new Date(t * DAY).getUTCDay() + 6) % 7;
  const [y, m] = today.split("-").map(Number) as [number, number];
  const month = (delta: number): [number, number] => {
    const start = Date.UTC(y, m - 1 + delta, 1) / DAY;
    const end = Date.UTC(y, m + delta, 1) / DAY - 1;
    return [start, end];
  };
  switch (preset) {
    case "today":
      return [t, t];
    case "yesterday":
      return [t - 1, t - 1];
    case "tomorrow":
      return [t + 1, t + 1];
    case "thisWeek":
      return [t - weekday, t - weekday + 6];
    case "lastWeek":
      return [t - weekday - 7, t - weekday - 1];
    case "nextWeek":
      return [t - weekday + 7, t - weekday + 13];
    case "thisMonth":
      return month(0);
    case "lastMonth":
      return month(-1);
    case "nextMonth":
      return month(1);
    case "pastDays":
      return [t - n + 1, t];
    case "nextDays":
      return [t, t + n - 1];
    case "beforeToday":
      return [null, t - 1];
  }
}

/** 查询时带上的「今天」和时区偏移：按空间时区算。 */
export function clockFor(timeZone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const today = `${get("year")}-${get("month")}-${get("day")}`;
  const local = Date.UTC(+get("year"), +get("month") - 1, +get("day"), +get("hour"), +get("minute"));
  const offset = Math.round((local - Math.floor(now.getTime() / 60_000) * 60_000) / 60_000);
  return { today, offset };
}

/** 条件里有没有动态时间（有的话查询要带上 clock）。 */
export const usesClock = (filter: { conds?: { groups: { items: { op: string }[] }[] } }) =>
  !!filter.conds?.groups.some((g) => g.items.some((c) => c.op === "date"));

/** 工作项列表的筛选条件，查询参数和保存的视图共用。 */
export const workItemFilter = z.object({
  typeIds: z.array(z.string()).max(50).optional(),
  statuses: z.array(z.enum(["inProgress", "completed", "terminated"])).optional(),
  stages: z.array(z.string()).max(50).optional(),
  memberIds: z.array(z.string()).max(50).optional(),
  fields: z
    .array(
      z.union([
        z.object({ field: z.string(), op: z.literal("in"), values: z.array(z.string()).min(1).max(50) }),
        z.object({
          field: z.string(),
          op: z.literal("range"),
          min: z.union([z.number(), z.string()]).optional(),
          max: z.union([z.number(), z.string()]).optional(),
        }),
        z.object({ field: z.string(), op: z.literal("contains"), text: z.string().trim().min(1).max(100) }),
      ]),
    )
    .max(10)
    .optional(),
  conds: z
    .object({
      conj: z.enum(["and", "or"]),
      groups: z
        .array(z.object({ conj: z.enum(["and", "or"]), items: z.array(filterCond).max(20) }))
        .max(10),
    })
    .optional(),
  clock: z.object({ today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), offset: z.number().int() }).optional(),
  viewId: z.string().optional(),
});
export type WorkItemFilterArgs = z.output<typeof workItemFilter>;

/** 列表视图的显示设置：列、排序、分组、行着色（见 db 的 ViewDisplay）。 */
export const viewDisplay = z.object({
  columns: z
    .array(z.object({ key: z.string().min(1).max(100), width: z.number().int().min(40).max(1000).optional() }))
    .max(100)
    .optional(),
  sort: z
    .array(z.object({ key: z.string(), desc: z.boolean().optional() }))
    .max(5)
    .optional(),
  groupBy: z.string().nullable().optional(),
  colors: z
    .array(z.object({ when: z.json(), color: z.string().max(32) }))
    .max(20)
    .optional(),
  frozen: z.number().int().min(0).max(10).optional(),
  rowHeight: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  summary: z
    .record(z.string(), z.enum(["count", "filled", "empty", "filledPct", "sum", "avg", "max", "min"]))
    .optional(),
  board: z
    .object({
      lanes: z.string().max(120).nullable().optional(),
      cardFields: z.array(z.string().max(100)).max(8).optional(),
    })
    .optional(),
});

/** 只存有值的条件；clock 是查询时才带的，不存。 */
export function compactFilter(filter: WorkItemFilterArgs): WorkItemFilter {
  const { clock: _clock, conds, ...rest } = filter;
  const groups = conds?.groups.filter((g) => g.items.length > 0) ?? [];
  return {
    ...(Object.fromEntries(Object.entries(rest).filter(([, v]) => v?.length)) as WorkItemFilter),
    ...(conds && groups.length > 0 && { conds: { ...conds, groups } }),
  };
}

export const createViewArgs = z.object({
  id: z.string(),
  spaceId: z.string(),
  name: z.string().trim().min(1, "视图要有名称。").max(50),
  filter: workItemFilter,
  display: viewDisplay.optional(),
  description: z.string().trim().max(500).optional(),
  kind: z.enum(["condition", "fixed"]).optional(),
  visibility: z.enum(["public", "personal"]).optional(),
  /** 固定视图一开始放进去的工作项。 */
  itemIds: z.array(z.string()).max(500).optional(),
});
/** 改视图的名称、说明、可见范围、筛选或显示设置：创建人、空间管理员，个人视图还有能编辑的协作者。 */
export const updateViewArgs = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(50).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  visibility: z.enum(["public", "personal"]).optional(),
  filter: workItemFilter.optional(),
  display: viewDisplay.optional(),
});
export const deleteViewArgs = z.object({ id: z.string() });
/** 设置个人视图的协作者（整体替换）。 */
export const setViewMembersArgs = z.object({
  id: z.string(),
  members: z.array(z.object({ userId: z.string(), role: z.enum(["edit", "view"]) })).max(200),
});
/** 往固定视图里加、移出工作项。 */
export const viewItemsArgs = z.object({ id: z.string(), itemIds: z.array(z.string()).min(1).max(500) });

type ViewRow = { id: string; spaceId: string; createdBy: string; visibility: string | null };

/** 能不能改这个视图：创建人、空间管理员；个人视图里能编辑的协作者。 */
async function requireViewEditor(tx: Transaction, id: string, userID: string): Promise<ViewRow & { owner: boolean }> {
  const view = await tx.run(zql.savedView.where("id", id).related("members").one());
  if (!view) throw new Error("视图不存在。");
  const member = await spaceMemberOf(tx, view.spaceId, userID);
  if (!member) throw new Error("视图不存在。");
  const owner = view.createdBy === userID || member.role === "admin";
  const editor = view.members.some((m) => m.userId === userID && m.role === "edit");
  if (!owner && !editor) throw new Error("只有创建人、空间管理员或能编辑的协作者可以修改视图。");
  return { ...view, owner };
}

/**
 * 保存一个视图。公共视图空间成员都能看到，管理员和成员可以建；
 * 个人视图只有自己和协作者能看到，访客也可以建。
 */
export async function createView(tx: Transaction, args: z.output<typeof createViewArgs>, userID: string) {
  const member = await spaceMemberOf(tx, args.spaceId, userID);
  if (!member) throw new Error("不是空间成员。");
  const visibility = args.visibility ?? "public";
  if (member.role === "guest" && visibility === "public") throw new Error("访客只能建个人视图。");
  const kind = args.kind ?? "condition";
  await tx.mutate.savedView.insert({
    id: args.id,
    spaceId: args.spaceId,
    name: args.name,
    filter: compactFilter(args.filter),
    display: (args.display ?? null) as ViewDisplay | null,
    description: args.description || null,
    kind,
    visibility,
    createdBy: userID,
    createdAt: Date.now(),
  });
  if (kind === "fixed" && args.itemIds?.length) await addItems(tx, args.id, args.spaceId, args.itemIds);
}

async function addItems(tx: Transaction, viewId: string, spaceId: string, itemIds: readonly string[]) {
  for (const id of new Set(itemIds)) {
    const item = await tx.run(zql.workItem.where("id", id).where("spaceId", spaceId).one());
    if (!item) throw new Error("只能加入本空间的工作项。");
    const existing = await tx.run(zql.savedViewItem.where("viewId", viewId).where("workItemId", id).one());
    if (!existing) await tx.mutate.savedViewItem.insert({ viewId, workItemId: id, addedAt: Date.now() });
  }
}

export async function updateView(tx: Transaction, args: z.output<typeof updateViewArgs>, userID: string) {
  const view = await requireViewEditor(tx, args.id, userID);
  if (args.visibility !== undefined && args.visibility !== view.visibility) {
    if (!view.owner) throw new Error("只有创建人或空间管理员可以改视图的可见范围。");
    const member = await spaceMemberOf(tx, view.spaceId, userID);
    if (args.visibility === "public" && member?.role === "guest") throw new Error("访客只能建个人视图。");
  }
  await tx.mutate.savedView.update({
    id: args.id,
    ...(args.name !== undefined && { name: args.name }),
    ...(args.description !== undefined && { description: args.description || null }),
    ...(args.visibility !== undefined && { visibility: args.visibility }),
    ...(args.filter !== undefined && { filter: compactFilter(args.filter) }),
    ...(args.display !== undefined && { display: args.display as ViewDisplay }),
  });
}

/** 删除视图：创建人或空间管理员。 */
export async function deleteView(tx: Transaction, args: z.output<typeof deleteViewArgs>, userID: string) {
  const view = await tx.run(zql.savedView.where("id", args.id).one());
  if (!view) throw new Error("视图不存在。");
  const member = await spaceMemberOf(tx, view.spaceId, userID);
  if (view.createdBy !== userID && member?.role !== "admin") throw new Error("只有创建人或空间管理员可以删除视图。");
  for (const m of await tx.run(zql.savedViewMember.where("viewId", args.id)))
    await tx.mutate.savedViewMember.delete({ viewId: m.viewId, userId: m.userId });
  for (const i of await tx.run(zql.savedViewItem.where("viewId", args.id)))
    await tx.mutate.savedViewItem.delete({ viewId: i.viewId, workItemId: i.workItemId });
  await tx.mutate.savedView.delete({ id: args.id });
}

/** 设置协作者：创建人或空间管理员；协作者要是空间成员。 */
export async function setViewMembers(tx: Transaction, args: z.output<typeof setViewMembersArgs>, userID: string) {
  const view = await requireViewEditor(tx, args.id, userID);
  if (!view.owner) throw new Error("只有创建人或空间管理员可以设置协作者。");
  const wanted = new Map(args.members.filter((m) => m.userId !== view.createdBy).map((m) => [m.userId, m.role]));
  for (const userId of wanted.keys())
    if (!(await spaceMemberOf(tx, view.spaceId, userId))) throw new Error("协作者要是空间成员。");
  for (const m of await tx.run(zql.savedViewMember.where("viewId", args.id)))
    if (!wanted.has(m.userId)) await tx.mutate.savedViewMember.delete({ viewId: m.viewId, userId: m.userId });
  for (const [userId, role] of wanted) await tx.mutate.savedViewMember.upsert({ viewId: args.id, userId, role });
}

export async function addViewItems(tx: Transaction, args: z.output<typeof viewItemsArgs>, userID: string) {
  const view = await requireViewEditor(tx, args.id, userID);
  const row = await tx.run(zql.savedView.where("id", args.id).one());
  if (row?.kind !== "fixed") throw new Error("只有固定视图能手动加入工作项。");
  await addItems(tx, args.id, view.spaceId, args.itemIds);
}

export async function removeViewItems(tx: Transaction, args: z.output<typeof viewItemsArgs>, userID: string) {
  await requireViewEditor(tx, args.id, userID);
  for (const id of new Set(args.itemIds)) {
    const existing = await tx.run(zql.savedViewItem.where("viewId", args.id).where("workItemId", id).one());
    if (existing) await tx.mutate.savedViewItem.delete({ viewId: args.id, workItemId: id });
  }
}
