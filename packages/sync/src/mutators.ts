import { fieldStates, PERSON_KEY } from "@fp/engine";
import { defineMutator, defineMutators, type Transaction } from "@rocicorp/zero";
import { z } from "zod";
import {
  hasAnyRole,
  myRoles,
  removeMember,
  removeMemberArgs,
  requireWriter,
  setMemberRole,
  setMemberRoleArgs,
  syncFieldAccess,
} from "./access.ts";
import {
  createAutomation,
  createAutomationArgs,
  deleteAutomation,
  deleteAutomationArgs,
  updateAutomation,
  updateAutomationArgs,
} from "./automations.ts";
import { deleteBaseline, deleteBaselineArgs, saveBaseline, saveBaselineArgs } from "./baselines.ts";
import {
  createChart,
  createChartArgs,
  deleteChart,
  deleteChartArgs,
  reorderCharts,
  reorderChartsArgs,
  updateChart,
  updateChartArgs,
} from "./charts.ts";
import {
  createComment,
  createCommentArgs,
  deleteComment,
  deleteCommentArgs,
  markNotificationsRead,
  markReadArgs,
  updateComment,
  updateCommentArgs,
} from "./comments.ts";
import {
  addDependency,
  addDependencyArgs,
  recheckArgs,
  recheckDependencies,
  removeDependency,
  removeDependencyArgs,
} from "./dependencies.ts";
import { fieldDefOf, withRuntimeOptions, writeFieldValue } from "./field-values.ts";
import {
  completeBySubItems,
  confirmNode,
  confirmNodeArgs,
  nodeActionArgs,
  pressButton,
  pressButtonArgs,
  recomputeFlow,
  rollbackNode,
  setEffortArgs,
  setNodeEffort,
  setNodePlan,
  setPlanArgs,
  setRoleArgs,
  setRoleMembers,
  setRolePresence,
  setRolePresenceArgs,
  upgradeArgs,
  upgradeWorkItem,
} from "./flow.ts";
import { recomputeFormulas, recomputeParentFormulas } from "./formulas.ts";
import { handover } from "./handover.ts";
import { handoverArgs } from "./handover-args.ts";
import {
  assertNotFrozen,
  deleteWorkItem,
  purgeWorkItem,
  restoreDeletedWorkItem,
  restoreWorkItem,
  setFrozenArgs,
  setWorkItemFrozen,
  terminateArgs,
  terminateWorkItem,
  workItemIdArgs,
} from "./lifecycle.ts";
import { markArgs, recordVisit, setMark, visitArgs } from "./marks.ts";
import { nudgeArgs, nudgeNode } from "./nudge.ts";
import {
  createGroup,
  createGroupArgs,
  deleteGroup,
  groupIdArgs,
  itemVisible,
  renameGroup,
  renameGroupArgs,
  setGroupMembers,
  setGroupMembersArgs,
  setPermissionsArgs,
  setTypePermissions,
} from "./permissions.ts";
import {
  addRelation,
  addRelationArgs,
  createRelationDef,
  createRelationDefArgs,
  deleteRelationDef,
  deleteRelationDefArgs,
  removeRelation,
  removeRelationArgs,
} from "./relations.ts";
import { zql } from "./schema.gen.ts";
import { setBusinessLines, setBusinessLinesArgs, setCalendarArgs, setSpaceCalendar } from "./spaces.ts";
import { transitionArgs, transitionStatus } from "./status.ts";
import { createNodeSubItem, createNodeSubItemArgs, createSubItem, createSubItemArgs } from "./subitems.ts";
import {
  createTask,
  createTaskArgs,
  deleteTask,
  deleteTaskArgs,
  setTaskDone,
  setTaskDoneArgs,
  updateTask,
  updateTaskArgs,
} from "./tasks.ts";
import {
  createField,
  createFieldArgs,
  createRole,
  createRoleArgs,
  createTemplate,
  createTemplateArgs,
  createType,
  createTypeArgs,
  publishArgs,
  publishVersion,
  reorderRoles,
  reorderRolesArgs,
  saveDraft,
  saveDraftArgs,
  setDefaultDisplay,
  setDefaultDisplayArgs,
  setFieldAccess,
  setFieldAccessArgs,
  setFormula,
  setFormulaArgs,
  setLayout,
  setLayoutArgs,
  setTypeSettings,
  setTypeSettingsArgs,
  updateField,
  updateFieldArgs,
  updateRole,
  updateRoleArgs,
} from "./templates.ts";
import { createView, createViewArgs, deleteView, deleteViewArgs, updateView, updateViewArgs } from "./views.ts";
import { castVote, castVoteArgs, revealVote, revealVoteArgs } from "./vote.ts";
import {
  createWebhook,
  createWebhookArgs,
  deleteWebhook,
  deleteWebhookArgs,
  updateWebhook,
  updateWebhookArgs,
} from "./webhooks.ts";
import { copyWorkItem, copyWorkItemArgs, createWorkItem, createWorkItemArgs } from "./work-items.ts";

/*
 * 前端的所有写操作都走这里的 mutator：浏览器里先乐观执行，再由服务端（apps/api）权威执行一遍。
 * 服务端版本在共享逻辑之外还会在同一个事务里追加事件（event_log + outbox）。
 */

export const createSpaceArgs = z.object({ id: z.string(), name: z.string().min(1) });
export const setFieldArgs = z.object({
  workItemId: z.string(),
  fieldKey: z.string(),
  value: z.json(),
});

/** 当前用户能看到的工作项（空间成员，并且类型权限让他看到）；看不到就返回 undefined。 */
export function visibleWorkItem(tx: Transaction, workItemId: string, userID: string) {
  return tx.run(zql.workItem.where("id", workItemId).where(itemVisible(userID)).one());
}

/**
 * 改一个字段的值，并按新值重算流程（出现条件、自动节点）。
 * 访客不能改；字段配了可改角色时，只有担任这些角色的人和空间管理员能改。
 * 值按字段类型校验、整理成规范形式；公式字段不能手动改。
 * 返回旧值和流程变化，服务端用来写事件。
 */
export async function setFieldValue(tx: Transaction, args: z.output<typeof setFieldArgs>, userID: string) {
  const item = await visibleWorkItem(tx, args.workItemId, userID);
  if (!item) throw new Error("工作项不存在或没有权限。");
  const { isAdmin } = await requireWriter(tx, item.spaceId, userID);
  assertNotFrozen(item);
  const field = await fieldDefOf(tx, item.typeId, args.fieldKey);
  if (!isAdmin && field.editRoles?.length && !hasAnyRole(field.editRoles, await myRoles(tx, item.id, userID)))
    throw new Error(`你没有权限修改「${field.name}」。`);
  const { from, to, created } = await writeFieldValue(tx, item, args.fieldKey, args.value);
  if (field.dataType === "multiPerson" && !isAdmin) assertOwnRowOnly(field.name, from, to, userID);
  if (to === null) await assertNotRequired(tx, item, field);
  if (created) await syncFieldAccess(tx, args.workItemId);
  // 先重算公式（流转条件可能用到），再重算流程，最后是汇总了这个工作项的上级
  await recomputeFormulas(tx, args.workItemId);
  const events = await recomputeFlow(tx, args.workItemId, userID);
  await recomputeParentFormulas(tx, args.workItemId);
  return { spaceId: item.spaceId, from, to, events };
}

/**
 * 多人复合字段每人填自己的一组：不是管理员时，只能加上、改或去掉自己那一行，别人的行要原样保留。
 */
function assertOwnRowOnly(name: string, from: unknown, to: unknown, userID: string) {
  const byUser = (rows: unknown) =>
    new Map(
      (Array.isArray(rows) ? rows : []).map((r) => [
        String((r as Record<string, unknown>)[PERSON_KEY]),
        // 数据库里的 jsonb 会重排键，按键排好再比
        JSON.stringify(Object.entries(r as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))),
      ]),
    );
  const before = byUser(from);
  const after = byUser(to);
  for (const user of new Set([...before.keys(), ...after.keys()]))
    if (user !== userID && before.get(user) !== after.get(user)) throw new Error(`「${name}」只能填写自己的一组。`);
}

/** 清空字段时检查：按当前的字段值，它要是必填的（有效、显示且必填）就不能清空。 */
async function assertNotRequired(
  tx: Transaction,
  item: { id: string; typeId: string; spaceId: string },
  field: { key: string; name: string },
) {
  const defs = await withRuntimeOptions(tx, item.spaceId, await tx.run(zql.fieldDef.where("typeId", item.typeId)));
  const rows = await tx.run(zql.fieldValue.where("workItemId", item.id));
  const values = Object.fromEntries(rows.map((r) => [r.fieldKey, r.value]));
  if (fieldStates(defs, values)[field.key]?.required) throw new Error(`「${field.name}」是必填字段，不能清空。`);
}

export const mutators = defineMutators({
  mark: {
    set: defineMutator(markArgs, ({ tx, args, ctx }) => setMark(tx, args, ctx.userID)),
    visit: defineMutator(visitArgs, ({ tx, args, ctx }) => recordVisit(tx, args, ctx.userID)),
  },
  space: {
    /** 新建空间，创建人成为空间管理员。 */
    create: defineMutator(createSpaceArgs, async ({ tx, args, ctx }) => {
      const now = Date.now();
      await tx.mutate.space.insert({
        id: args.id,
        name: args.name,
        timezone: "Asia/Shanghai",
        calendar: { holidays: [], extraWorkdays: [] },
        createdAt: now,
      });
      await tx.mutate.spaceMember.insert({ spaceId: args.id, userId: ctx.userID, role: "admin" });
    }),
    setCalendar: defineMutator(setCalendarArgs, async ({ tx, args, ctx }) => {
      await setSpaceCalendar(tx, args, ctx.userID);
    }),
    setMemberRole: defineMutator(setMemberRoleArgs, ({ tx, args, ctx }) => setMemberRole(tx, args, ctx.userID)),
    removeMember: defineMutator(removeMemberArgs, ({ tx, args, ctx }) => removeMember(tx, args, ctx.userID)),
    setBusinessLines: defineMutator(setBusinessLinesArgs, ({ tx, args, ctx }) =>
      setBusinessLines(tx, args, ctx.userID),
    ),
    handover: defineMutator(handoverArgs, async ({ tx, args, ctx }) => {
      await handover(tx, args, ctx.userID);
    }),
  },
  automation: {
    create: defineMutator(createAutomationArgs, ({ tx, args, ctx }) => createAutomation(tx, args, ctx.userID)),
    update: defineMutator(updateAutomationArgs, ({ tx, args, ctx }) => updateAutomation(tx, args, ctx.userID)),
    delete: defineMutator(deleteAutomationArgs, ({ tx, args, ctx }) => deleteAutomation(tx, args, ctx.userID)),
  },
  webhook: {
    create: defineMutator(createWebhookArgs, ({ tx, args, ctx }) => createWebhook(tx, args, ctx.userID)),
    update: defineMutator(updateWebhookArgs, ({ tx, args, ctx }) => updateWebhook(tx, args, ctx.userID)),
    delete: defineMutator(deleteWebhookArgs, ({ tx, args, ctx }) => deleteWebhook(tx, args, ctx.userID)),
  },
  vote: {
    cast: defineMutator(castVoteArgs, async ({ tx, args, ctx }) => {
      await castVote(tx, args, ctx.userID);
    }),
    reveal: defineMutator(revealVoteArgs, async ({ tx, args, ctx }) => {
      await revealVote(tx, args, ctx.userID);
    }),
  },
  comment: {
    create: defineMutator(createCommentArgs, async ({ tx, args, ctx }) => {
      await createComment(tx, args, ctx.userID);
    }),
    update: defineMutator(updateCommentArgs, async ({ tx, args, ctx }) => {
      await updateComment(tx, args, ctx.userID);
    }),
    delete: defineMutator(deleteCommentArgs, async ({ tx, args, ctx }) => {
      await deleteComment(tx, args, ctx.userID);
    }),
  },
  notification: {
    markRead: defineMutator(markReadArgs, ({ tx, args, ctx }) => markNotificationsRead(tx, args, ctx.userID)),
  },
  chart: {
    create: defineMutator(createChartArgs, ({ tx, args, ctx }) => createChart(tx, args, ctx.userID)),
    update: defineMutator(updateChartArgs, ({ tx, args, ctx }) => updateChart(tx, args, ctx.userID)),
    delete: defineMutator(deleteChartArgs, ({ tx, args, ctx }) => deleteChart(tx, args, ctx.userID)),
    reorder: defineMutator(reorderChartsArgs, ({ tx, args, ctx }) => reorderCharts(tx, args, ctx.userID)),
  },
  view: {
    create: defineMutator(createViewArgs, ({ tx, args, ctx }) => createView(tx, args, ctx.userID)),
    update: defineMutator(updateViewArgs, ({ tx, args, ctx }) => updateView(tx, args, ctx.userID)),
    delete: defineMutator(deleteViewArgs, ({ tx, args, ctx }) => deleteView(tx, args, ctx.userID)),
  },
  relationDef: {
    create: defineMutator(createRelationDefArgs, ({ tx, args, ctx }) => createRelationDef(tx, args, ctx.userID)),
    delete: defineMutator(deleteRelationDefArgs, ({ tx, args, ctx }) => deleteRelationDef(tx, args, ctx.userID)),
  },
  relation: {
    add: defineMutator(addRelationArgs, async ({ tx, args, ctx }) => {
      await addRelation(tx, args, ctx.userID);
    }),
    remove: defineMutator(removeRelationArgs, async ({ tx, args, ctx }) => {
      await removeRelation(tx, args, ctx.userID);
    }),
  },
  workItemType: {
    create: defineMutator(createTypeArgs, ({ tx, args, ctx }) => createType(tx, args, ctx.userID)),
    setLayout: defineMutator(setLayoutArgs, ({ tx, args, ctx }) => setLayout(tx, args, ctx.userID)),
    setDefaultDisplay: defineMutator(setDefaultDisplayArgs, ({ tx, args, ctx }) =>
      setDefaultDisplay(tx, args, ctx.userID),
    ),
    setSettings: defineMutator(setTypeSettingsArgs, ({ tx, args, ctx }) => setTypeSettings(tx, args, ctx.userID)),
    setPermissions: defineMutator(setPermissionsArgs, ({ tx, args, ctx }) => setTypePermissions(tx, args, ctx.userID)),
  },
  userGroup: {
    create: defineMutator(createGroupArgs, ({ tx, args, ctx }) => createGroup(tx, args, ctx.userID)),
    rename: defineMutator(renameGroupArgs, ({ tx, args, ctx }) => renameGroup(tx, args, ctx.userID)),
    delete: defineMutator(groupIdArgs, ({ tx, args, ctx }) => deleteGroup(tx, args, ctx.userID)),
    setMembers: defineMutator(setGroupMembersArgs, ({ tx, args, ctx }) => setGroupMembers(tx, args, ctx.userID)),
  },
  roleDef: {
    create: defineMutator(createRoleArgs, ({ tx, args, ctx }) => createRole(tx, args, ctx.userID)),
    update: defineMutator(updateRoleArgs, ({ tx, args, ctx }) => updateRole(tx, args, ctx.userID)),
    reorder: defineMutator(reorderRolesArgs, ({ tx, args, ctx }) => reorderRoles(tx, args, ctx.userID)),
  },
  fieldDef: {
    create: defineMutator(createFieldArgs, ({ tx, args, ctx }) => createField(tx, args, ctx.userID)),
    setAccess: defineMutator(setFieldAccessArgs, ({ tx, args, ctx }) => setFieldAccess(tx, args, ctx.userID)),
    setFormula: defineMutator(setFormulaArgs, ({ tx, args, ctx }) => setFormula(tx, args, ctx.userID)),
    update: defineMutator(updateFieldArgs, ({ tx, args, ctx }) => updateField(tx, args, ctx.userID)),
  },
  flowTemplate: {
    create: defineMutator(createTemplateArgs, ({ tx, args, ctx }) => createTemplate(tx, args, ctx.userID)),
    saveDraft: defineMutator(saveDraftArgs, async ({ tx, args, ctx }) => {
      await saveDraft(tx, args, ctx.userID);
    }),
    publish: defineMutator(publishArgs, ({ tx, args, ctx }) => publishVersion(tx, args, ctx.userID)),
  },
  workItem: {
    create: defineMutator(createWorkItemArgs, async ({ tx, args, ctx }) => {
      await createWorkItem(tx, args, ctx.userID);
    }),
    createSubItem: defineMutator(createSubItemArgs, async ({ tx, args, ctx }) => {
      await createSubItem(tx, args, ctx.userID);
    }),
    createNodeSubItem: defineMutator(createNodeSubItemArgs, async ({ tx, args, ctx }) => {
      await createNodeSubItem(tx, args, ctx.userID);
    }),
    transition: defineMutator(transitionArgs, async ({ tx, args, ctx }) => {
      await transitionStatus(tx, args, ctx.userID);
    }),
    terminate: defineMutator(terminateArgs, async ({ tx, args, ctx }) => {
      await terminateWorkItem(tx, args, ctx.userID);
    }),
    copy: defineMutator(copyWorkItemArgs, async ({ tx, args, ctx }) => {
      await copyWorkItem(tx, args, ctx.userID);
    }),
    restore: defineMutator(workItemIdArgs, async ({ tx, args, ctx }) => {
      await restoreWorkItem(tx, args, ctx.userID);
    }),
    setFrozen: defineMutator(setFrozenArgs, async ({ tx, args, ctx }) => {
      await setWorkItemFrozen(tx, args, ctx.userID);
    }),
    delete: defineMutator(workItemIdArgs, async ({ tx, args, ctx }) => {
      await deleteWorkItem(tx, args, ctx.userID);
    }),
    recover: defineMutator(workItemIdArgs, async ({ tx, args, ctx }) => {
      await restoreDeletedWorkItem(tx, args, ctx.userID);
    }),
    purge: defineMutator(workItemIdArgs, async ({ tx, args, ctx }) => {
      await purgeWorkItem(tx, args, ctx.userID);
    }),
  },
  node: {
    confirm: defineMutator(confirmNodeArgs, async ({ tx, args, ctx }) => {
      await confirmNode(tx, args, ctx.userID);
    }),
    rollback: defineMutator(nodeActionArgs, async ({ tx, args, ctx }) => {
      await rollbackNode(tx, args, ctx.userID);
    }),
    setPlan: defineMutator(setPlanArgs, async ({ tx, args, ctx }) => {
      await setNodePlan(tx, args, ctx.userID);
    }),
    setEffort: defineMutator(setEffortArgs, async ({ tx, args, ctx }) => {
      await setNodeEffort(tx, args, ctx.userID);
    }),
    completeBySubItems: defineMutator(nodeActionArgs, async ({ tx, args, ctx }) => {
      await completeBySubItems(tx, args, ctx.userID);
    }),
    press: defineMutator(pressButtonArgs, async ({ tx, args, ctx }) => {
      await pressButton(tx, args, ctx.userID);
    }),
    upgrade: defineMutator(upgradeArgs, async ({ tx, args, ctx }) => {
      await upgradeWorkItem(tx, args, ctx.userID);
    }),
    nudge: defineMutator(nudgeArgs, async ({ tx, args, ctx }) => {
      await nudgeNode(tx, args, ctx.userID);
    }),
    /** 别的工作项里被依赖的节点完成后，重算这个工作项：在等它的节点可以开始了。 */
    recheck: defineMutator(recheckArgs, async ({ tx, args, ctx }) => {
      await recheckDependencies(tx, args, ctx.userID);
    }),
  },
  task: {
    create: defineMutator(createTaskArgs, async ({ tx, args, ctx }) => {
      await createTask(tx, args, ctx.userID);
    }),
    update: defineMutator(updateTaskArgs, async ({ tx, args, ctx }) => {
      await updateTask(tx, args, ctx.userID);
    }),
    setDone: defineMutator(setTaskDoneArgs, async ({ tx, args, ctx }) => {
      await setTaskDone(tx, args, ctx.userID);
    }),
    delete: defineMutator(deleteTaskArgs, async ({ tx, args, ctx }) => {
      await deleteTask(tx, args, ctx.userID);
    }),
  },
  dependency: {
    add: defineMutator(addDependencyArgs, async ({ tx, args, ctx }) => {
      await addDependency(tx, args, ctx.userID);
    }),
    remove: defineMutator(removeDependencyArgs, async ({ tx, args, ctx }) => {
      await removeDependency(tx, args, ctx.userID);
    }),
  },
  baseline: {
    save: defineMutator(saveBaselineArgs, async ({ tx, args, ctx }) => {
      await saveBaseline(tx, args, ctx.userID);
    }),
    delete: defineMutator(deleteBaselineArgs, async ({ tx, args, ctx }) => {
      await deleteBaseline(tx, args, ctx.userID);
    }),
  },
  role: {
    set: defineMutator(setRoleArgs, async ({ tx, args, ctx }) => {
      await setRoleMembers(tx, args, ctx.userID);
    }),
    setPresence: defineMutator(setRolePresenceArgs, async ({ tx, args, ctx }) => {
      await setRolePresence(tx, args, ctx.userID);
    }),
  },
  fieldValue: {
    set: defineMutator(setFieldArgs, async ({ tx, args, ctx }) => {
      await setFieldValue(tx, args, ctx.userID);
    }),
  },
});
