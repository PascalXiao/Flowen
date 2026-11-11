import { appendEvents, type NewEvent, schema, type Tx } from "@fp/db";
import type { FlowEvent, StatusEvent } from "@fp/engine";
import type { ZeroContext } from "@fp/sync";
import {
  addDependency,
  addDependencyArgs,
  addRelation,
  addRelationArgs,
  castVote,
  castVoteArgs,
  completeBySubItems,
  confirmNode,
  confirmNodeArgs,
  copyWorkItem,
  copyWorkItemArgs,
  createComment,
  createCommentArgs,
  createNodeSubItem,
  createNodeSubItemArgs,
  createSubItem,
  createSubItemArgs,
  createTask,
  createTaskArgs,
  createWorkItem,
  createWorkItemArgs,
  deleteBaseline,
  deleteBaselineArgs,
  deleteComment,
  deleteCommentArgs,
  deleteTask,
  deleteTaskArgs,
  deleteWorkItem,
  handover,
  handoverArgs,
  mutators,
  nodeActionArgs,
  nudgeArgs,
  nudgeNode,
  pressButton,
  pressButtonArgs,
  purgeWorkItem,
  recheckArgs,
  recheckDependencies,
  removeDependency,
  removeDependencyArgs,
  removeRelation,
  removeRelationArgs,
  restoreDeletedWorkItem,
  restoreWorkItem,
  revealVote,
  revealVoteArgs,
  rollbackNode,
  saveBaseline,
  saveBaselineArgs,
  setCalendarArgs,
  setEffortArgs,
  setFieldArgs,
  setFieldValue,
  setFrozenArgs,
  setNodeEffort,
  setNodePlan,
  setPlanArgs,
  setRoleArgs,
  setRoleMembers,
  setSpaceCalendar,
  setTaskDone,
  setTaskDoneArgs,
  setWorkItemFrozen,
  terminateArgs,
  terminateWorkItem,
  transitionArgs,
  transitionStatus,
  updateComment,
  updateCommentArgs,
  updateTask,
  updateTaskArgs,
  upgradeArgs,
  upgradeWorkItem,
  workItemIdArgs,
} from "@fp/sync";
import { defineMutator, defineMutators } from "@rocicorp/zero";
import type { DrizzleTransaction } from "@rocicorp/zero/server/adapters/drizzle";
import { and, eq, gt, sql } from "drizzle-orm";

/** 同一个人催同一个节点的最短间隔。 */
const NUDGE_INTERVAL_MS = 10 * 60_000;

/** 服务端事务里拿到的 Drizzle 事务，用它写事件，和 Zero 的写入在同一个数据库事务里。 */
export function drizzleTx(tx: { location: string; dbTransaction?: { wrappedTransaction: unknown } }): Tx {
  if (tx.location !== "server" || !tx.dbTransaction) throw new Error("只能在服务端执行。");
  return tx.dbTransaction.wrappedTransaction as DrizzleTransaction as unknown as Tx;
}

/** 在 mutator 的事务里追加事件；自动化执行时给每条事件记上起因。 */
function append(tx: Parameters<typeof drizzleTx>[0], ctx: ZeroContext, events: NewEvent[]) {
  return appendEvents(
    drizzleTx(tx),
    events.map((e) => ({ ...e, causedBy: ctx.causedBy ?? null })),
  );
}

/** 引擎事件转成 event_log 记录。由人触发的事件（确认、回滚、状态流转）带 by，其余是流程自己推进的，actor 为空。 */
function flowEvents(spaceId: string, workItemId: string, events: (FlowEvent | StatusEvent)[]): NewEvent[] {
  // 节点事件改字段的要求由共享逻辑写进字段，字段改动另外记，这里不重复
  return events
    .filter((e) => e.type !== "fieldAssigned")
    .map(({ type, ...payload }) => ({
      spaceId,
      workItemId,
      kind: type,
      payload,
      actor: "by" in payload && typeof payload.by === "string" ? payload.by : null,
    }));
}

/**
 * 服务端的权威 mutator：先跑和浏览器共享的逻辑，再在同一个事务里追加事件。
 * 事件经 Outbox 中继交给 Temporal，流程推进和自动化都从那里开始。
 */
export const serverMutators = defineMutators(mutators, {
  vote: {
    cast: defineMutator(castVoteArgs, async ({ tx, args, ctx }) => {
      const { spaceId } = await castVote(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "voteCast",
          payload: { fieldKey: args.fieldKey },
          actor: ctx.userID,
        },
      ]);
    }),
    reveal: defineMutator(revealVoteArgs, async ({ tx, args, ctx }) => {
      const { spaceId } = await revealVote(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "voteRevealed",
          payload: { fieldKey: args.fieldKey, revealed: args.revealed },
          actor: ctx.userID,
        },
      ]);
    }),
  },
  comment: {
    create: defineMutator(createCommentArgs, async ({ tx, args, ctx }) => {
      const { spaceId, mentions, parentId, replyToId } = await createComment(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "commentAdded",
          payload: { commentId: args.id, mentions, ...(parentId ? { parentId, replyTo: replyToId } : {}) },
          actor: ctx.userID,
        },
      ]);
    }),
    update: defineMutator(updateCommentArgs, async ({ tx, args, ctx }) => {
      const { spaceId, workItemId, added } = await updateComment(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId,
          kind: "commentEdited",
          payload: { commentId: args.id, mentions: added },
          actor: ctx.userID,
        },
      ]);
    }),
    delete: defineMutator(deleteCommentArgs, async ({ tx, args, ctx }) => {
      const { spaceId, workItemId } = await deleteComment(tx, args, ctx.userID);
      await append(tx, ctx, [
        { spaceId, workItemId, kind: "commentDeleted", payload: { commentId: args.id }, actor: ctx.userID },
      ]);
    }),
  },
  relation: {
    add: defineMutator(addRelationArgs, async ({ tx, args, ctx }) => {
      const { spaceId, replaced } = await addRelation(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.fromId,
          kind: "relationAdded",
          payload: { relationDefId: args.relationDefId, toId: args.toId, replaced },
          actor: ctx.userID,
        },
      ]);
    }),
    remove: defineMutator(removeRelationArgs, async ({ tx, args, ctx }) => {
      const { spaceId, relation } = await removeRelation(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: relation.fromId,
          kind: "relationRemoved",
          payload: { relationDefId: relation.relationDefId, toId: relation.toId },
          actor: ctx.userID,
        },
      ]);
    }),
  },
  space: {
    setCalendar: defineMutator(setCalendarArgs, async ({ tx, args, ctx }) => {
      const { from, to } = await setSpaceCalendar(tx, args, ctx.userID);
      await append(tx, ctx, [
        { spaceId: args.spaceId, kind: "calendarChanged", payload: { from, to }, actor: ctx.userID },
      ]);
    }),
    handover: defineMutator(handoverArgs, async ({ tx, args, ctx }) => {
      const changes = await handover(tx, args, ctx.userID);
      const { spaceId, fromUserId: from, toUserId: to } = args;
      const actor = ctx.userID;
      await append(tx, ctx, [
        ...changes.flatMap((c): NewEvent[] => {
          // 每项改动按原来的事件种类记（角色、字段、节点负责人、子任务），字段改动带上引起的流程变化
          const { workItemId, kind, ...rest } = c;
          const { events = [], ...payload } = rest as typeof rest & { events?: (FlowEvent | StatusEvent)[] };
          return [{ spaceId, workItemId, kind, payload, actor }, ...flowEvents(spaceId, workItemId, events)];
        }),
        // 空间级的一条汇总，审计用
        {
          spaceId,
          kind: "workHandover",
          payload: { from, to, items: new Set(changes.map((c) => c.workItemId)).size, changes: changes.length },
          actor,
        },
      ]);
    }),
  },
  workItem: {
    create: defineMutator(createWorkItemArgs, async ({ tx, args, ctx }) => {
      const { spaceId, flowVersionId, events } = await createWorkItem(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.id,
          kind: "workItemCreated",
          payload: { typeId: args.typeId, flowVersionId, name: args.name },
          actor: ctx.userID,
        },
        // 引擎在初始化时算出的节点变化（开始节点完成、后续节点开始、裁剪、阶段改写）
        ...flowEvents(spaceId, args.id, events),
      ]);
    }),
    createNodeSubItem: defineMutator(createNodeSubItemArgs, async ({ tx, args, ctx }) => {
      const { spaceId, flowVersionId, events, typeId } = await createNodeSubItem(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.id,
          kind: "workItemCreated",
          payload: { typeId, flowVersionId, name: args.name },
          actor: ctx.userID,
        },
        ...flowEvents(spaceId, args.id, events),
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "subItemCreated",
          payload: { node: args.nodeKey, subItemId: args.id, name: args.name },
          actor: ctx.userID,
        },
      ]);
    }),
    createSubItem: defineMutator(createSubItemArgs, async ({ tx, args, ctx }) => {
      const { spaceId, flowVersionId, events } = await createSubItem(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.id,
          kind: "workItemCreated",
          payload: { typeId: args.typeId, flowVersionId, name: args.name },
          actor: ctx.userID,
        },
        ...flowEvents(spaceId, args.id, events),
        {
          spaceId,
          workItemId: args.parentId,
          kind: "subItemCreated",
          payload: { node: args.nodeKey, subItemId: args.id, name: args.name },
          actor: ctx.userID,
        },
      ]);
    }),
    copy: defineMutator(copyWorkItemArgs, async ({ tx, args, ctx }) => {
      const { spaceId, typeId, flowVersionId, events } = await copyWorkItem(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.id,
          kind: "workItemCreated",
          payload: { typeId, flowVersionId, name: args.name, copiedFrom: args.sourceId },
          actor: ctx.userID,
        },
        ...flowEvents(spaceId, args.id, events),
      ]);
    }),
    terminate: defineMutator(terminateArgs, async ({ tx, args, ctx }) => {
      const { spaceId, reason } = await terminateWorkItem(tx, args, ctx.userID);
      await append(tx, ctx, [
        { spaceId, workItemId: args.workItemId, kind: "workItemTerminated", payload: { reason }, actor: ctx.userID },
      ]);
    }),
    restore: defineMutator(workItemIdArgs, async ({ tx, args, ctx }) => {
      const { spaceId, events } = await restoreWorkItem(tx, args, ctx.userID);
      await append(tx, ctx, [
        { spaceId, workItemId: args.workItemId, kind: "workItemRestored", payload: {}, actor: ctx.userID },
        ...flowEvents(spaceId, args.workItemId, events),
      ]);
    }),
    setFrozen: defineMutator(setFrozenArgs, async ({ tx, args, ctx }) => {
      const { spaceId } = await setWorkItemFrozen(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: args.frozen ? "workItemFrozen" : "workItemUnfrozen",
          payload: {},
          actor: ctx.userID,
        },
      ]);
    }),
    delete: defineMutator(workItemIdArgs, async ({ tx, args, ctx }) => {
      const { spaceId, name } = await deleteWorkItem(tx, args, ctx.userID);
      await append(tx, ctx, [
        { spaceId, workItemId: args.workItemId, kind: "workItemDeleted", payload: { name }, actor: ctx.userID },
      ]);
    }),
    recover: defineMutator(workItemIdArgs, async ({ tx, args, ctx }) => {
      const { spaceId, name } = await restoreDeletedWorkItem(tx, args, ctx.userID);
      await append(tx, ctx, [
        { spaceId, workItemId: args.workItemId, kind: "workItemRecovered", payload: { name }, actor: ctx.userID },
      ]);
    }),
    purge: defineMutator(workItemIdArgs, async ({ tx, args, ctx }) => {
      const { spaceId, name } = await purgeWorkItem(tx, args, ctx.userID);
      // 工作项已经没了：流水不指向它，记下 id 和名称备查
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: null,
          kind: "workItemPurged",
          payload: { id: args.workItemId, name },
          actor: ctx.userID,
        },
      ]);
    }),
    transition: defineMutator(transitionArgs, async ({ tx, args, ctx }) => {
      const { spaceId, events } = await transitionStatus(tx, args, ctx.userID);
      await append(tx, ctx, flowEvents(spaceId, args.workItemId, events));
    }),
  },
  node: {
    confirm: defineMutator(confirmNodeArgs, async ({ tx, args, ctx }) => {
      const { spaceId, events, fieldChanges } = await confirmNode(tx, args, ctx.userID);
      await append(tx, ctx, [
        // 完成表单里填的字段先记，节点变化在后
        ...fieldChanges.map((c) => ({
          spaceId,
          workItemId: args.workItemId,
          kind: "fieldChanged",
          payload: { ...c },
          actor: ctx.userID,
        })),
        ...flowEvents(spaceId, args.workItemId, events),
      ]);
    }),
    press: defineMutator(pressButtonArgs, async ({ tx, args, ctx }) => {
      const { spaceId, events, fieldChanges } = await pressButton(tx, args, ctx.userID);
      await append(tx, ctx, [
        ...fieldChanges.map((c) => ({
          spaceId,
          workItemId: args.workItemId,
          kind: "fieldChanged",
          payload: { ...c },
          actor: ctx.userID,
        })),
        ...flowEvents(spaceId, args.workItemId, events),
      ]);
    }),
    upgrade: defineMutator(upgradeArgs, async ({ tx, args, ctx }) => {
      const { spaceId, events, from, to } = await upgradeWorkItem(tx, args, ctx.userID);
      await append(tx, ctx, [
        { spaceId, workItemId: args.workItemId, kind: "templateUpgraded", payload: { from, to }, actor: ctx.userID },
        ...flowEvents(spaceId, args.workItemId, events),
      ]);
    }),
    recheck: defineMutator(recheckArgs, async ({ tx, args, ctx }) => {
      const { spaceId, events } = await recheckDependencies(tx, args, ctx.userID);
      await append(tx, ctx, flowEvents(spaceId, args.workItemId, events));
    }),
    nudge: defineMutator(nudgeArgs, async ({ tx, args, ctx }) => {
      const { spaceId, to } = await nudgeNode(tx, args, ctx.userID);
      // 同一个人 10 分钟内只能催同一个节点一次，避免刷屏
      const since = new Date(Date.now() - NUDGE_INTERVAL_MS);
      const recent = await drizzleTx(tx).query.eventLog.findFirst({
        where: and(
          eq(schema.eventLog.workItemId, args.workItemId),
          eq(schema.eventLog.kind, "nodeNudged"),
          eq(schema.eventLog.actor, ctx.userID),
          gt(schema.eventLog.at, since),
          sql`${schema.eventLog.payload}->>'node' = ${args.nodeKey}`,
        ),
      });
      if (recent) throw new Error("10 分钟内已经催过了，稍后再催。");
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "nodeNudged",
          payload: { node: args.nodeKey, to },
          actor: ctx.userID,
        },
      ]);
    }),
    completeBySubItems: defineMutator(nodeActionArgs, async ({ tx, args, ctx }) => {
      const { spaceId, events } = await completeBySubItems(tx, args, ctx.userID);
      await append(tx, ctx, flowEvents(spaceId, args.workItemId, events));
    }),
    rollback: defineMutator(nodeActionArgs, async ({ tx, args, ctx }) => {
      const { spaceId, events } = await rollbackNode(tx, args, ctx.userID);
      await append(tx, ctx, flowEvents(spaceId, args.workItemId, events));
    }),
    setEffort: defineMutator(setEffortArgs, async ({ tx, args, ctx }) => {
      const { spaceId } = await setNodeEffort(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "nodeEffortChanged",
          payload: {
            node: args.nodeKey,
            ...(args.points !== undefined && { points: args.points }),
            ...(args.actualHours !== undefined && { actualHours: args.actualHours }),
          },
          actor: ctx.userID,
        },
      ]);
    }),
    setPlan: defineMutator(setPlanArgs, async ({ tx, args, ctx }) => {
      const { spaceId } = await setNodePlan(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "nodePlanChanged",
          payload: { node: args.nodeKey, start: args.start ?? null, end: args.end ?? null },
          actor: ctx.userID,
        },
      ]);
    }),
  },
  task: {
    create: defineMutator(createTaskArgs, async ({ tx, args, ctx }) => {
      const { spaceId } = await createTask(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "taskCreated",
          payload: { taskId: args.id, node: args.nodeKey, name: args.name, assigneeId: args.assigneeId },
          actor: ctx.userID,
        },
      ]);
    }),
    update: defineMutator(updateTaskArgs, async ({ tx, args, ctx }) => {
      const { spaceId, task } = await updateTask(tx, args, ctx.userID);
      const reassigned = args.assigneeId !== undefined && args.assigneeId !== task.assigneeId;
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: task.workItemId,
          kind: "taskUpdated",
          payload: {
            taskId: args.id,
            node: task.nodeKey,
            name: args.name ?? task.name,
            ...(reassigned && { assigneeId: args.assigneeId, from: task.assigneeId ?? null }),
          },
          actor: ctx.userID,
        },
      ]);
    }),
    setDone: defineMutator(setTaskDoneArgs, async ({ tx, args, ctx }) => {
      const { spaceId, task } = await setTaskDone(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: task.workItemId,
          kind: args.done ? "taskDone" : "taskReopened",
          payload: { taskId: args.id, node: task.nodeKey, name: task.name },
          actor: ctx.userID,
        },
      ]);
    }),
    delete: defineMutator(deleteTaskArgs, async ({ tx, args, ctx }) => {
      const { spaceId, task } = await deleteTask(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: task.workItemId,
          kind: "taskDeleted",
          payload: { taskId: args.id, node: task.nodeKey, name: task.name },
          actor: ctx.userID,
        },
      ]);
    }),
  },
  dependency: {
    add: defineMutator(addDependencyArgs, async ({ tx, args, ctx }) => {
      const { spaceId, targetNodeName, targetItemName, events } = await addDependency(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "dependencyAdded",
          payload: {
            node: args.nodeKey,
            allow: args.allow,
            targetItemId: args.targetItemId,
            targetItemName: args.targetItemId === args.workItemId ? null : targetItemName,
            targetNode: targetNodeName,
          },
          actor: ctx.userID,
        },
        ...flowEvents(spaceId, args.workItemId, events),
      ]);
    }),
    remove: defineMutator(removeDependencyArgs, async ({ tx, args, ctx }) => {
      const { spaceId, dependency, events } = await removeDependency(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: dependency.workItemId,
          kind: "dependencyRemoved",
          payload: { node: dependency.nodeKey, allow: dependency.allow, targetNode: dependency.targetNodeName },
          actor: ctx.userID,
        },
        ...flowEvents(spaceId, dependency.workItemId, events),
      ]);
    }),
  },
  baseline: {
    save: defineMutator(saveBaselineArgs, async ({ tx, args, ctx }) => {
      const { spaceId, nodes } = await saveBaseline(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "baselineSaved",
          payload: { baselineId: args.id, name: args.name, nodes },
          actor: ctx.userID,
        },
      ]);
    }),
    delete: defineMutator(deleteBaselineArgs, async ({ tx, args, ctx }) => {
      const { spaceId, baseline } = await deleteBaseline(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: baseline.workItemId,
          kind: "baselineDeleted",
          payload: { baselineId: args.id, name: baseline.name },
          actor: ctx.userID,
        },
      ]);
    }),
  },
  role: {
    set: defineMutator(setRoleArgs, async ({ tx, args, ctx }) => {
      const { spaceId, from, to } = await setRoleMembers(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "roleChanged",
          payload: { roleKey: args.roleKey, from, to },
          actor: ctx.userID,
        },
      ]);
    }),
  },
  fieldValue: {
    set: defineMutator(setFieldArgs, async ({ tx, args, ctx }) => {
      const { spaceId, from, to, events } = await setFieldValue(tx, args, ctx.userID);
      await append(tx, ctx, [
        {
          spaceId,
          workItemId: args.workItemId,
          kind: "fieldChanged",
          payload: { fieldKey: args.fieldKey, from, to },
          actor: ctx.userID,
        },
        ...flowEvents(spaceId, args.workItemId, events),
      ]);
    }),
  },
});
