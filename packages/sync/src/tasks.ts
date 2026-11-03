import { dayFromIso, dayToTimestamp, nodeFlowOf } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { assertSpaceMembers, requireWriter } from "./access.ts";
import { isoDate } from "./flow.ts";
import { zql } from "./schema.gen.ts";
import { nodeInstanceId } from "./work-items.ts";

const taskName = z.string().trim().min(1, "子任务要有名称。").max(200);

export const createTaskArgs = z.object({
  id: z.string(),
  workItemId: z.string(),
  nodeKey: z.string(),
  name: taskName,
  assigneeId: z.string().nullable().default(null),
  due: isoDate.nullable().default(null),
});
/** 只改传了的项；assigneeId、due 传 null 表示清空。 */
export const updateTaskArgs = z.object({
  id: z.string(),
  name: taskName.optional(),
  assigneeId: z.string().nullable().optional(),
  due: isoDate.nullable().optional(),
});
export const setTaskDoneArgs = z.object({ id: z.string(), done: z.boolean() });
export const deleteTaskArgs = z.object({ id: z.string() });

/**
 * 子任务所在的节点要能改：工作项看得到、没终止，节点没完成也没被跳过。
 * 已完成的节点上的子任务保留当时的样子，回滚节点后才能再改。
 */
async function editableNode(tx: Transaction, workItemId: string, nodeKey: string, userID: string) {
  const item = await tx.run(
    zql.workItem
      .where("id", workItemId)
      .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)))
      .related("flowVersion")
      .one(),
  );
  if (!item) throw new Error("工作项不存在或没有权限。");
  await requireWriter(tx, item.spaceId, userID);
  if (item.status === "terminated") throw new Error("工作项已终止。");
  if (item.frozen) throw new Error("工作项已冻结，解冻后才能修改。");
  const node = nodeFlowOf(item.flowVersion?.definition)?.nodes.find((n) => n.key === nodeKey);
  if (!node) throw new Error("节点不存在。");
  const instance = await tx.run(zql.nodeInstance.where("id", nodeInstanceId(workItemId, nodeKey)).one());
  if (instance?.state === "completed") throw new Error(`节点「${node.name}」已完成，子任务不能再改。`);
  if (instance?.state === "skipped") throw new Error(`节点「${node.name}」已跳过，不能加子任务。`);
  return { spaceId: item.spaceId, node };
}

async function loadTask(tx: Transaction, id: string, userID: string) {
  const task = await tx.run(zql.nodeTask.where("id", id).one());
  if (!task) throw new Error("子任务不存在。");
  const { spaceId } = await editableNode(tx, task.workItemId, task.nodeKey, userID);
  return { task, spaceId };
}

const dueTimestamp = (due: string | null) => (due === null ? null : dayToTimestamp(dayFromIso(due)));

/** 在节点上加一个子任务。空间成员都可以；负责人必须是空间成员。 */
export async function createTask(tx: Transaction, args: z.output<typeof createTaskArgs>, userID: string) {
  const { spaceId } = await editableNode(tx, args.workItemId, args.nodeKey, userID);
  if (args.assigneeId) await assertSpaceMembers(tx, spaceId, [args.assigneeId], "子任务负责人必须是空间成员。");
  await tx.mutate.nodeTask.insert({
    id: args.id,
    workItemId: args.workItemId,
    nodeKey: args.nodeKey,
    name: args.name,
    assigneeId: args.assigneeId,
    dueDate: dueTimestamp(args.due),
    done: false,
    createdBy: userID,
    createdAt: Date.now(),
  });
  return { spaceId };
}

/** 改子任务的名称、负责人或截止日期。返回改之前的负责人，换了人时服务端给新负责人发通知。 */
export async function updateTask(tx: Transaction, args: z.output<typeof updateTaskArgs>, userID: string) {
  const { task, spaceId } = await loadTask(tx, args.id, userID);
  if (args.assigneeId) await assertSpaceMembers(tx, spaceId, [args.assigneeId], "子任务负责人必须是空间成员。");
  await tx.mutate.nodeTask.update({
    id: args.id,
    ...(args.name !== undefined && { name: args.name }),
    ...(args.assigneeId !== undefined && { assigneeId: args.assigneeId }),
    ...(args.due !== undefined && { dueDate: dueTimestamp(args.due) }),
  });
  return { spaceId, task };
}

/** 勾选或取消勾选子任务。 */
export async function setTaskDone(tx: Transaction, args: z.output<typeof setTaskDoneArgs>, userID: string) {
  const { task, spaceId } = await loadTask(tx, args.id, userID);
  await tx.mutate.nodeTask.update({
    id: args.id,
    done: args.done,
    doneAt: args.done ? Date.now() : null,
    doneBy: args.done ? userID : null,
  });
  return { spaceId, task };
}

export async function deleteTask(tx: Transaction, args: z.output<typeof deleteTaskArgs>, userID: string) {
  const { task, spaceId } = await loadTask(tx, args.id, userID);
  await tx.mutate.nodeTask.delete({ id: args.id });
  return { spaceId, task };
}
