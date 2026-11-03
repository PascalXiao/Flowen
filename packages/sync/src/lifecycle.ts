import { type FlowEvent, isFinal, statusFlowOf } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { myRoles, requireWriter } from "./access.ts";
import { recomputeFlow } from "./flow.ts";
import { zql } from "./schema.gen.ts";

/*
 * 终止和冻结（对照飞书项目工作项右上角「···」里的终止 / 恢复、冻结 / 解冻）：
 * - 终止：工作项不再推进，填终止原因；恢复后回到进行中，流程按当前字段重算。
 * - 冻结：字段、节点、状态、子任务都不能再改，解冻后照常。
 * 只有工作项负责人（担任「是负责人」的角色）和空间管理员能做。
 */

export const terminateArgs = z.object({ workItemId: z.string(), reason: z.string().trim().max(500).optional() });
export const workItemIdArgs = z.object({ workItemId: z.string() });
export const setFrozenArgs = z.object({ workItemId: z.string(), frozen: z.boolean() });

async function ownedItem(tx: Transaction, workItemId: string, userID: string, action: string) {
  const item = await tx.run(
    zql.workItem
      .where("id", workItemId)
      .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)))
      .related("flowVersion")
      .one(),
  );
  if (!item) throw new Error("工作项不存在或没有权限。");
  const { isAdmin } = await requireWriter(tx, item.spaceId, userID);
  if (!isAdmin) {
    const ownerRoles = (await tx.run(zql.roleDef.where("typeId", item.typeId)))
      .filter((r) => r.config?.isOwner)
      .map((r) => r.key);
    const mine = await myRoles(tx, workItemId, userID);
    if (!ownerRoles.some((r) => mine.includes(r))) throw new Error(`只有工作项负责人和空间管理员可以${action}。`);
  }
  return item;
}

/** 写字段、确认节点、流转状态、改子任务之前的检查：冻结了就不能改。 */
export function assertNotFrozen(item: { frozen?: boolean | null }) {
  if (item.frozen) throw new Error("工作项已冻结，解冻后才能修改。");
}

export async function terminateWorkItem(tx: Transaction, args: z.output<typeof terminateArgs>, userID: string) {
  const item = await ownedItem(tx, args.workItemId, userID, "终止工作项");
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
  const item = await ownedItem(tx, args.workItemId, userID, "恢复工作项");
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
  const item = await ownedItem(tx, args.workItemId, userID, args.frozen ? "冻结工作项" : "解冻工作项");
  if (!!item.frozen === args.frozen) throw new Error(args.frozen ? "工作项已经冻结了。" : "工作项没有冻结。");
  await tx.mutate.workItem.update({ id: item.id, frozen: args.frozen, updatedAt: Date.now() });
  return { spaceId: item.spaceId };
}
