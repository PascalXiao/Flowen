import { type Database, schema } from "@fp/db";
import { nodeFlowOf } from "@fp/engine";
import { and, eq, inArray } from "drizzle-orm";

interface NewNotification {
  userId: string;
  kind: "mentioned" | "nodeAssigned" | "taskAssigned" | "nudge" | "replied";
  text: string;
}

/**
 * 按一条事件生成站内通知：评论里被提及、节点开始时轮到的负责人、被分配了子任务、被催一催。
 * 通知 id 由事件和收件人决定，重试时插入同一行，不会重复。操作者自己不收通知。
 */
export async function notify(database: Database, eventId: number): Promise<number> {
  const { db } = database;
  const event = await db.query.eventLog.findFirst({ where: eq(schema.eventLog.id, eventId) });
  if (!event?.workItemId) return 0;
  const item = await db.query.workItem.findFirst({ where: eq(schema.workItem.id, event.workItemId) });
  if (!item || item.deletedAt) return 0;
  const payload = event.payload as Record<string, unknown>;

  const notifications: NewNotification[] = [];
  if (event.kind === "commentAdded" || event.kind === "commentEdited") {
    const mentions = (payload.mentions as string[] | undefined) ?? [];
    const author = event.actor ? await db.query.user.findFirst({ where: eq(schema.user.id, event.actor) }) : null;
    for (const userId of mentions)
      notifications.push({
        userId,
        kind: "mentioned",
        text: `${author?.name ?? "有人"} 在「${item.name}」的评论里提到了你`,
      });
    // 回复：通知被回复的人（已经被提及的不重复通知）
    const replyTo = typeof payload.replyTo === "string" ? payload.replyTo : null;
    if (replyTo && !mentions.includes(replyTo))
      notifications.push({
        userId: replyTo,
        kind: "replied",
        text: `${author?.name ?? "有人"} 在「${item.name}」回复了你的评论`,
      });
  } else if (event.kind === "nodeStarted" && typeof payload.node === "string") {
    const node = await db.query.nodeInstance.findFirst({
      where: eq(schema.nodeInstance.id, `${item.id}/${payload.node}`),
    });
    const version = item.flowVersionId
      ? await db.query.flowVersion.findFirst({ where: eq(schema.flowVersion.id, item.flowVersionId) })
      : null;
    const definition = nodeFlowOf(version?.definition);
    const name = definition?.nodes.find((n) => n.key === payload.node)?.name ?? payload.node;
    for (const userId of node?.owners ?? [])
      notifications.push({ userId, kind: "nodeAssigned", text: `「${item.name}」的节点「${name}」轮到你了` });
  } else if (event.kind === "nodeNudged" && typeof payload.node === "string") {
    const actor = event.actor ? await db.query.user.findFirst({ where: eq(schema.user.id, event.actor) }) : null;
    const version = item.flowVersionId
      ? await db.query.flowVersion.findFirst({ where: eq(schema.flowVersion.id, item.flowVersionId) })
      : null;
    const name = nodeFlowOf(version?.definition)?.nodes.find((n) => n.key === payload.node)?.name ?? payload.node;
    for (const userId of (payload.to as string[] | undefined) ?? [])
      notifications.push({
        userId,
        kind: "nudge",
        text: `${actor?.name ?? "有人"} 催你处理「${item.name}」的节点「${name}」`,
      });
  } else if ((event.kind === "taskCreated" || event.kind === "taskUpdated") && typeof payload.assigneeId === "string") {
    const actor = event.actor ? await db.query.user.findFirst({ where: eq(schema.user.id, event.actor) }) : null;
    notifications.push({
      userId: payload.assigneeId,
      kind: "taskAssigned",
      text: `${actor?.name ?? "有人"} 在「${item.name}」给你分配了子任务「${String(payload.name)}」`,
    });
  }

  const recipients = notifications.filter((n) => n.userId !== event.actor);
  if (recipients.length === 0) return 0;
  // 只通知仍在空间里的人
  const members = await db.query.spaceMember.findMany({
    where: and(
      eq(schema.spaceMember.spaceId, item.spaceId),
      inArray(
        schema.spaceMember.userId,
        recipients.map((n) => n.userId),
      ),
    ),
  });
  const inSpace = new Set(members.map((m) => m.userId));
  const rows = recipients
    .filter((n) => inSpace.has(n.userId))
    .map((n) => ({
      id: `${eventId}:${n.userId}`,
      userId: n.userId,
      spaceId: item.spaceId,
      workItemId: item.id,
      kind: n.kind,
      text: n.text,
      eventId,
    }));
  if (rows.length === 0) return 0;
  await db.insert(schema.notification).values(rows).onConflictDoNothing();
  return rows.length;
}
