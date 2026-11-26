import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { assertSpaceMembers, spaceMemberOf } from "./access.ts";
import { itemVisible } from "./permissions.ts";
import { htmlToText } from "./rich-text.ts";
import { zql } from "./schema.gen.ts";

/** 正文是富文本 HTML；@人、@字段在正文里，提及的人另外列在 mentions 里（通知用）。 */
const body = z.string().max(50_000);

export const createCommentArgs = z.object({
  id: z.string(),
  workItemId: z.string(),
  body,
  mentions: z.array(z.string()).max(50),
  /** 回复某条评论（一级评论或楼里的回复）；回复都挂在一级评论下面。 */
  replyTo: z.string().optional(),
  /** 针对字段评论：字段键和引用的字段值（显示文字）。只有一级评论能针对字段。 */
  fieldKey: z.string().max(200).optional(),
  quote: z.string().max(500).optional(),
});
export const updateCommentArgs = z.object({
  id: z.string(),
  body,
  mentions: z.array(z.string()).max(50),
});
export const deleteCommentArgs = z.object({ id: z.string() });
export const markReadArgs = z.object({ ids: z.array(z.string()).min(1).max(500) });

/** 评论所在的工作项（要看得见），没有就报错。 */
async function visibleItem(tx: Transaction, workItemId: string, userID: string) {
  const item = await tx.run(zql.workItem.where("id", workItemId).where(itemVisible(userID)).one());
  if (!item) throw new Error("工作项不存在或没有权限。");
  return item;
}

/** 正文没有文字时要有附件（附件先传、带着评论 id），否则不能发。 */
async function assertNotEmpty(tx: Transaction, commentId: string, html: string) {
  if (htmlToText(html)) return;
  const files = await tx.run(zql.attachment.where("commentId", commentId).limit(1));
  if (files.length === 0) throw new Error("评论不能为空。");
}

/**
 * 发表评论或回复。只有空间成员能评论，也只能提及空间成员。
 * 回复挂在一级评论下（楼中楼只有一层）；返回空间 id、提及的人和被回复的人，服务端写事件、发通知用。
 */
export async function createComment(tx: Transaction, args: z.output<typeof createCommentArgs>, userID: string) {
  const item = await visibleItem(tx, args.workItemId, userID);
  const mentions = [...new Set(args.mentions)].filter((u) => u !== userID);
  await assertSpaceMembers(tx, item.spaceId, mentions, "只能提及空间成员。");
  await assertNotEmpty(tx, args.id, args.body);
  let parentId: string | null = null;
  let replyToId: string | null = null;
  if (args.replyTo) {
    const target = await tx.run(zql.comment.where("id", args.replyTo).one());
    if (!target || target.workItemId !== args.workItemId) throw new Error("要回复的评论不存在。");
    if (target.deletedAt != null) throw new Error("评论已删除，不能回复。");
    parentId = target.parentId ?? target.id;
    replyToId = target.authorId;
  }
  if (args.fieldKey) {
    if (parentId) throw new Error("回复不能针对字段。");
    const def = await tx.run(zql.fieldDef.where("typeId", item.typeId).where("key", args.fieldKey).one());
    if (!def) throw new Error("字段不存在。");
  }
  await tx.mutate.comment.insert({
    id: args.id,
    workItemId: args.workItemId,
    authorId: userID,
    body: args.body,
    mentions,
    parentId,
    replyToId,
    fieldKey: (!parentId && args.fieldKey) || null,
    quote: (!parentId && args.fieldKey && args.quote) || null,
    createdAt: Date.now(),
  });
  return { spaceId: item.spaceId, mentions, parentId, replyToId: replyToId === userID ? null : replyToId };
}

/** 改自己的评论。已删除的不能改。返回新提及的人（原来没提及的），服务端只通知他们。 */
export async function updateComment(tx: Transaction, args: z.output<typeof updateCommentArgs>, userID: string) {
  const row = await tx.run(zql.comment.where("id", args.id).one());
  if (!row || row.deletedAt != null) throw new Error("评论不存在。");
  const item = await visibleItem(tx, row.workItemId, userID);
  if (row.authorId !== userID) throw new Error("只能编辑自己的评论。");
  const mentions = [...new Set(args.mentions)].filter((u) => u !== userID);
  await assertSpaceMembers(tx, item.spaceId, mentions, "只能提及空间成员。");
  await assertNotEmpty(tx, args.id, args.body);
  await tx.mutate.comment.update({ id: args.id, body: args.body, mentions, editedAt: Date.now() });
  const added = mentions.filter((u) => !(row.mentions ?? []).includes(u));
  return { spaceId: item.spaceId, workItemId: row.workItemId, added };
}

/** 删除评论：作者本人或空间管理员。内容和附件清空、留下「评论已删除」占位，楼里的回复保留。 */
export async function deleteComment(tx: Transaction, args: z.output<typeof deleteCommentArgs>, userID: string) {
  const row = await tx.run(zql.comment.where("id", args.id).one());
  if (!row || row.deletedAt != null) throw new Error("评论不存在。");
  const item = await visibleItem(tx, row.workItemId, userID);
  if (row.authorId !== userID && (await spaceMemberOf(tx, item.spaceId, userID))?.role !== "admin")
    throw new Error("只能删除自己的评论。");
  await tx.mutate.comment.update({ id: args.id, body: "", mentions: [], quote: null, deletedAt: Date.now() });
  for (const file of await tx.run(zql.attachment.where("commentId", args.id)))
    await tx.mutate.attachment.delete({ id: file.id });
  return { spaceId: item.spaceId, workItemId: row.workItemId };
}

/** 把自己的通知标为已读。别人的通知忽略。 */
export async function markNotificationsRead(tx: Transaction, args: z.output<typeof markReadArgs>, userID: string) {
  const now = Date.now();
  for (const id of args.ids) {
    const row = await tx.run(zql.notification.where("id", id).one());
    if (row?.userId === userID && row.readAt == null) await tx.mutate.notification.update({ id, readAt: now });
  }
}
