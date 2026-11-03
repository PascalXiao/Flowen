import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { itemVisible } from "./permissions.ts";
import { zql } from "./schema.gen.ts";
import { nodeInstanceId } from "./work-items.ts";

export const nudgeArgs = z.object({ workItemId: z.string(), nodeKey: z.string() });

/**
 * 催一催（对照飞书项目节点卡片上的「催一催」）：提醒进行中节点的负责人尽快处理。
 * 只改通知，不改工作项；能看到工作项的人都能催，负责人不用催自己。返回要提醒的人，服务端据此写事件、发通知。
 */
export async function nudgeNode(tx: Transaction, args: z.output<typeof nudgeArgs>, userID: string) {
  const item = await tx.run(zql.workItem.where("id", args.workItemId).where(itemVisible(userID)).one());
  if (!item) throw new Error("工作项不存在或没有权限。");
  if (item.status === "terminated") throw new Error("工作项已终止。");
  const node = await tx.run(zql.nodeInstance.where("id", nodeInstanceId(args.workItemId, args.nodeKey)).one());
  if (node?.state !== "inProgress") throw new Error("只能催进行中的节点。");
  const to = (node.owners ?? []).filter((u) => u !== userID);
  if (to.length === 0) throw new Error("这个节点没有其他负责人可以催。");
  return { spaceId: item.spaceId, to };
}
