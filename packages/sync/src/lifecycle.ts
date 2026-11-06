import { type FlowEvent, isFinal, statusFlowOf } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { myRoles, requireWriter } from "./access.ts";
import { recomputeFlow } from "./flow.ts";
import { recomputeParentFormulas } from "./formulas.ts";
import { itemVisible, requireOp } from "./permissions.ts";
import { zql } from "./schema.gen.ts";

/*
 * 终止和冻结：
 * - 终止：工作项不再推进，填终止原因；恢复后回到进行中，流程按当前字段重算。
 * - 冻结：字段、节点、状态、子任务都不能再改，解冻后照常。
 * 只有工作项负责人（担任「是负责人」的角色）和空间管理员能做。
 */

export const terminateArgs = z.object({ workItemId: z.string(), reason: z.string().trim().max(500).optional() });
export const workItemIdArgs = z.object({ workItemId: z.string() });
export const setFrozenArgs = z.object({ workItemId: z.string(), frozen: z.boolean() });

async function ownedItem(
  tx: Transaction,
  workItemId: string,
  userID: string,
  action: string,
  op: "terminate" | "freeze",
) {
  const item = await tx.run(
    zql.workItem.where("id", workItemId).where(itemVisible(userID)).related("flowVersion").one(),
  );
  if (!item) throw new Error("工作项不存在或没有权限。");
  await requireWriter(tx, item.spaceId, userID);
  const mine = await myRoles(tx, workItemId, userID);
  // 没配这项权限时：工作项负责人和空间管理员可以
  await requireOp(
    tx,
    { spaceId: item.spaceId, typeId: item.typeId, itemRoles: mine },
    userID,
    op,
    async () => {
      const ownerRoles = (await tx.run(zql.roleDef.where("typeId", item.typeId)))
        .filter((r) => r.config?.isOwner)
        .map((r) => r.key);
      return ownerRoles.some((r) => mine.includes(r));
    },
    `你没有权限${action}（默认只有工作项负责人和空间管理员可以）。`,
  );
  return item;
}

/** 写字段、确认节点、流转状态、改子任务之前的检查：冻结了就不能改。 */
export function assertNotFrozen(item: { frozen?: boolean | null }) {
  if (item.frozen) throw new Error("工作项已冻结，解冻后才能修改。");
}

export async function terminateWorkItem(tx: Transaction, args: z.output<typeof terminateArgs>, userID: string) {
  const item = await ownedItem(tx, args.workItemId, userID, "终止工作项", "terminate");
  if (item.status === "terminated") throw new Error("工作项已经终止了。");
  if (item.status === "completed") throw new Error("已完成的工作项不能终止。");
  await tx.mutate.workItem.update({
    id: item.id,
    status: "terminated",
    terminateReason: args.reason?.trim() || null,
    updatedAt: Date.now(),
  });
  return { spaceId: item.spaceId, reason: args.reason?.trim() || null };
}

/** 恢复：回到进行中；节点流按当前字段重算流程，状态流在终态上的直接算完成。 */
export async function restoreWorkItem(
  tx: Transaction,
  args: z.output<typeof workItemIdArgs>,
  userID: string,
): Promise<{ spaceId: string; events: FlowEvent[] }> {
  const item = await ownedItem(tx, args.workItemId, userID, "恢复工作项", "terminate");
  if (item.status !== "terminated") throw new Error("工作项没有终止。");
  const statusFlow = statusFlowOf(item.flowVersion?.definition);
  const done = statusFlow?.statuses.find((s) => s.key === item.flowStatus);
  await tx.mutate.workItem.update({
    id: item.id,
    status: done && isFinal(done.category) ? "completed" : "inProgress",
    terminateReason: null,
    updatedAt: Date.now(),
  });
  const events = statusFlow ? [] : await recomputeFlow(tx, item.id, userID);
  return { spaceId: item.spaceId, events };
}

export async function setWorkItemFrozen(tx: Transaction, args: z.output<typeof setFrozenArgs>, userID: string) {
  const item = await ownedItem(tx, args.workItemId, userID, args.frozen ? "冻结工作项" : "解冻工作项", "freeze");
  if (!!item.frozen === args.frozen) throw new Error(args.frozen ? "工作项已经冻结了。" : "工作项没有冻结。");
  await tx.mutate.workItem.update({ id: item.id, frozen: args.frozen, updatedAt: Date.now() });
  return { spaceId: item.spaceId };
}

/*
 * 删除和回收站：
 * - 删除：放进回收站，各处（列表、视图、搜索、公式、度量）都不再出现，可以恢复。
 *   有「删除」权限的人能删；没配这项权限时，创建者、工作项负责人和空间管理员可以。
 * - 恢复：删除它的人或空间管理员。
 * - 彻底删除：只有空间管理员，连同字段值、节点、评论、附件记录一起删掉；动态流水保留。
 */
export async function deleteWorkItem(tx: Transaction, args: z.output<typeof workItemIdArgs>, userID: string) {
  const item = await tx.run(zql.workItem.where("id", args.workItemId).where(itemVisible(userID)).one());
  if (!item) throw new Error("工作项不存在或没有权限。");
  await requireWriter(tx, item.spaceId, userID);
  const mine = await myRoles(tx, item.id, userID);
  await requireOp(
    tx,
    { spaceId: item.spaceId, typeId: item.typeId, itemRoles: mine },
    userID,
    "delete",
    async () => {
      if (item.createdBy === userID) return true;
      const ownerRoles = (await tx.run(zql.roleDef.where("typeId", item.typeId)))
        .filter((r) => r.config?.isOwner)
        .map((r) => r.key);
      return ownerRoles.some((r) => mine.includes(r));
    },
    "你没有权限删除这个工作项（默认只有创建者、工作项负责人和空间管理员可以）。",
  );
  await tx.mutate.workItem.update({ id: item.id, deletedAt: Date.now(), deletedBy: userID, updatedAt: Date.now() });
  await recomputeParentFormulas(tx, item.id);
  return { spaceId: item.spaceId, name: item.name };
}

async function deletedItem(tx: Transaction, workItemId: string, userID: string) {
  const item = await tx.run(zql.workItem.where("id", workItemId).where("deletedAt", "IS NOT", null).one());
  if (!item) throw new Error("回收站里没有这个工作项。");
  const { isAdmin } = await requireWriter(tx, item.spaceId, userID);
  return { item, isAdmin };
}

export async function restoreDeletedWorkItem(tx: Transaction, args: z.output<typeof workItemIdArgs>, userID: string) {
  const { item, isAdmin } = await deletedItem(tx, args.workItemId, userID);
  if (!isAdmin && item.deletedBy !== userID) throw new Error("只有删除它的人和空间管理员可以恢复。");
  await tx.mutate.workItem.update({ id: item.id, deletedAt: null, deletedBy: null, updatedAt: Date.now() });
  await recomputeParentFormulas(tx, item.id);
  return { spaceId: item.spaceId, name: item.name };
}

export async function purgeWorkItem(tx: Transaction, args: z.output<typeof workItemIdArgs>, userID: string) {
  const { item, isAdmin } = await deletedItem(tx, args.workItemId, userID);
  if (!isAdmin) throw new Error("只有空间管理员可以彻底删除。");
  // 关联、字段值、节点、评论等在数据库里随工作项级联删除
  await tx.mutate.workItem.delete({ id: item.id });
  return { spaceId: item.spaceId, name: item.name };
}
