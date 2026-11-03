import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { assertSpaceMembers } from "./access.ts";
import { itemVisible } from "./permissions.ts";
import { zql } from "./schema.gen.ts";

export const createCommentArgs = z.object({
  id: z.string(),
  workItemId: z.string(),
  body: z.string().trim().min(1, "评论不能为空。").max(10_000),
  mentions: z.array(z.string()).max(50),
});
export const markReadArgs = z.object({ ids: z.array(z.string()).min(1).max(500) });

/** 发表评论。只有空间成员能评论，也只能提及空间成员；返回空间 id，服务端写事件用。 */
export async function createComment(tx: Transaction, args: z.output<typeof createCommentArgs>, userID: string) {
  const item = await tx.run(zql.workItem.where("id", args.workItemId).where(itemVisible(userID)).one());
  if (!item) throw new Error("工作项不存在或没有权限。");
  const mentions = [...new Set(args.mentions)].filter((u) => u !== userID);
  await assertSpaceMembers(tx, item.spaceId, mentions, "只能提及空间成员。");
  await tx.mutate.comment.insert({
    id: args.id,
    workItemId: args.workItemId,
    authorId: userID,
    body: args.body,
    mentions,
    createdAt: Date.now(),
  });
  return { spaceId: item.spaceId, mentions };
}

/** 把自己的通知标为已读。别人的通知忽略。 */
export async function markNotificationsRead(tx: Transaction, args: z.output<typeof markReadArgs>, userID: string) {
  const now = Date.now();
  for (const id of args.ids) {
    const row = await tx.run(zql.notification.where("id", id).one());
    if (row?.userId === userID && row.readAt == null) await tx.mutate.notification.update({ id, readAt: now });
  }
}
