import type { FlowEvent, StatusEvent } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import type { z } from "zod";
import { requireAdmin, spaceMemberOf } from "./access.ts";
import { setRoleMembers } from "./flow.ts";
import type { handoverArgs } from "./handover-args.ts";
import { setFieldValue } from "./mutators.ts";
import { zql } from "./schema.gen.ts";

export { handoverArgs } from "./handover-args.ts";

/*
 * 工作移交：有人请假、转岗、离职时，空间管理员把他在进行中的工作项上的工作交给另一个人。
 * - 角色：他担任的角色换成接手的人（单人角色直接替换），未完成的节点跟着角色改负责人；
 * - 节点：没走角色、直接指派给他的未完成节点；
 * - 人员字段：值里有他的人员字段（如对接人）；
 * - 子任务：指派给他、还没完成的子任务。
 * 已完成、已终止、已冻结和回收站里的工作项不动。
 */

export type HandoverChange =
  | { workItemId: string; kind: "roleChanged"; roleKey: string; from: string[]; to: string[] }
  | {
      workItemId: string;
      kind: "fieldChanged";
      fieldKey: string;
      from: unknown;
      to: unknown;
      events: (FlowEvent | StatusEvent)[];
    }
  | { workItemId: string; kind: "nodeOwnerChanged"; nodeKey: string; from: string[]; to: string[] }
  | { workItemId: string; kind: "taskAssigned"; taskId: string; from: string; to: string };

const swap = (ids: readonly string[], from: string, to: string) => [
  ...new Set(ids.map((id) => (id === from ? to : id))),
];

export async function handover(
  tx: Transaction,
  args: z.output<typeof handoverArgs>,
  userID: string,
): Promise<HandoverChange[]> {
  await requireAdmin(tx, args.spaceId, userID, "只有空间管理员可以移交工作。");
  if (args.fromUserId === args.toUserId) throw new Error("移交人和接手人不能是同一个人。");
  const receiver = await spaceMemberOf(tx, args.spaceId, args.toUserId);
  if (!receiver) throw new Error("接手的人要是空间成员。");
  if (receiver.role === "guest") throw new Error("访客不能接手工作。");

  const { fromUserId: from, toUserId: to } = args;
  const items = await tx.run(
    zql.workItem
      .where("spaceId", args.spaceId)
      .where("deletedAt", "IS", null)
      .where("status", "inProgress")
      .where("frozen", false)
      .related("roleMembers")
      .related("fieldValues")
      .related("nodes")
      .related("tasks")
      .related("type", (t) => t.related("fields")),
  );
  const changes: HandoverChange[] = [];
  for (const item of items) {
    if (args.roles) {
      const roleKeys = new Set(item.roleMembers.filter((m) => m.userId === from).map((m) => m.roleKey));
      for (const roleKey of roleKeys) {
        const before = item.roleMembers.filter((m) => m.roleKey === roleKey).map((m) => m.userId);
        const after = swap(before, from, to);
        await setRoleMembers(tx, { workItemId: item.id, roleKey, userIds: after }, userID);
        changes.push({ workItemId: item.id, kind: "roleChanged", roleKey, from: before, to: after });
      }
      // 角色换完后还留着他的未完成节点：直接指派的
      const nodes = await tx.run(zql.nodeInstance.where("workItemId", item.id));
      for (const node of nodes) {
        if (node.state !== "notStarted" && node.state !== "inProgress") continue;
        const before = node.owners ?? [];
        if (!before.includes(from)) continue;
        const owners = swap(before, from, to);
        await tx.mutate.nodeInstance.update({ id: node.id, owners });
        changes.push({
          workItemId: item.id,
          kind: "nodeOwnerChanged",
          nodeKey: node.nodeKey,
          from: before,
          to: owners,
        });
      }
    }
    if (args.fields) {
      for (const field of item.type?.fields ?? []) {
        if (field.dataType !== "user" && field.dataType !== "singleUser") continue;
        const value = item.fieldValues.find((v) => v.fieldKey === field.key)?.value;
        const ids = Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [];
        if (!ids.includes(from)) continue;
        const next = field.dataType === "singleUser" ? to : swap(ids, from, to);
        const {
          from: before,
          to: after,
          events,
        } = await setFieldValue(tx, { workItemId: item.id, fieldKey: field.key, value: next }, userID);
        changes.push({
          workItemId: item.id,
          kind: "fieldChanged",
          fieldKey: field.key,
          from: before,
          to: after,
          events,
        });
      }
    }
    if (args.tasks)
      for (const task of item.tasks) {
        if (task.done || task.assigneeId !== from) continue;
        await tx.mutate.nodeTask.update({ id: task.id, assigneeId: to });
        changes.push({ workItemId: item.id, kind: "taskAssigned", taskId: task.id, from, to });
      }
  }
  return changes;
}
