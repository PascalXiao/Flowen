import type { ViewDisplay, WorkItemFilter } from "@fp/db/schema";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { spaceMemberOf } from "./access.ts";
import { zql } from "./schema.gen.ts";

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

export const createViewArgs = z.object({
  id: z.string(),
  spaceId: z.string(),
  name: z.string().trim().min(1, "视图要有名称。").max(50),
  filter: workItemFilter,
  display: viewDisplay.optional(),
});
/** 改视图的名称、筛选或显示设置：创建人或空间管理员。 */
export const updateViewArgs = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(50).optional(),
  filter: workItemFilter.optional(),
  display: viewDisplay.optional(),
});
export const deleteViewArgs = z.object({ id: z.string() });

/** 保存一个视图。空间管理员和成员可以保存（访客不行），所有人都能看到。 */
export async function createView(tx: Transaction, args: z.output<typeof createViewArgs>, userID: string) {
  const member = await spaceMemberOf(tx, args.spaceId, userID);
  if (!member) throw new Error("不是空间成员。");
  if (member.role === "guest") throw new Error("访客只能查看和评论。");
  await tx.mutate.savedView.insert({
    id: args.id,
    spaceId: args.spaceId,
    name: args.name,
    // 只存有值的条件
    filter: Object.fromEntries(Object.entries(args.filter).filter(([, v]) => v?.length)) as WorkItemFilter,
    display: (args.display ?? null) as ViewDisplay | null,
    createdBy: userID,
    createdAt: Date.now(),
  });
}

export async function updateView(tx: Transaction, args: z.output<typeof updateViewArgs>, userID: string) {
  const view = await tx.run(zql.savedView.where("id", args.id).one());
  if (!view) throw new Error("视图不存在。");
  const member = await spaceMemberOf(tx, view.spaceId, userID);
  if (view.createdBy !== userID && member?.role !== "admin") throw new Error("只有创建人或空间管理员可以修改视图。");
  await tx.mutate.savedView.update({
    id: args.id,
    ...(args.name !== undefined && { name: args.name }),
    ...(args.filter !== undefined && {
      filter: Object.fromEntries(Object.entries(args.filter).filter(([, v]) => v?.length)) as WorkItemFilter,
    }),
    ...(args.display !== undefined && { display: args.display as ViewDisplay }),
  });
}

/** 删除视图：创建人或空间管理员。 */
export async function deleteView(tx: Transaction, args: z.output<typeof deleteViewArgs>, userID: string) {
  const view = await tx.run(zql.savedView.where("id", args.id).one());
  if (!view) throw new Error("视图不存在。");
  const member = await spaceMemberOf(tx, view.spaceId, userID);
  if (view.createdBy !== userID && member?.role !== "admin") throw new Error("只有创建人或空间管理员可以删除视图。");
  await tx.mutate.savedView.delete({ id: args.id });
}
