import { type Database, schema } from "@fp/db";
import { type AutomationAction, pickActions, renderTemplate, resolveRecipients, ruleApplies } from "@fp/engine";
import { mustGetMutator } from "@rocicorp/zero";
import { and, eq, inArray } from "drizzle-orm";
import type { MutatorRunner } from "./index.ts";
import { drizzleTx, serverMutators } from "./mutators.ts";

/**
 * 找出被这条事件触发的规则：空间里已启用、触发器和条件都满足的。
 * 自动化自己写出的事件（带 causedBy）不再触发规则，避免规则互相触发形成循环。
 */
export async function matchRules(database: Database, eventId: number): Promise<string[]> {
  const { db } = database;
  const event = await db.query.eventLog.findFirst({ where: eq(schema.eventLog.id, eventId) });
  if (!event) throw new Error(`event_log 里没有事件 ${eventId}`);
  if (!event.workItemId || event.causedBy != null) return [];
  const item = await db.query.workItem.findFirst({ where: eq(schema.workItem.id, event.workItemId) });
  // 回收站里的工作项不触发自动化
  if (!item || item.deletedAt) return [];
  const rules = await db.query.automationRule.findMany({
    where: and(eq(schema.automationRule.spaceId, event.spaceId), eq(schema.automationRule.enabled, true)),
    orderBy: schema.automationRule.createdAt,
  });
  if (rules.length === 0) return [];
  const values = await db.query.fieldValue.findMany({ where: eq(schema.fieldValue.workItemId, item.id) });
  const fields = Object.fromEntries(values.map((v) => [v.fieldKey, v.value]));
  return rules
    .filter((rule) =>
      ruleApplies(
        {
          id: rule.id,
          trigger: rule.trigger,
          condition: rule.conditions,
          actions: rule.actions,
          branches: rule.branches,
        },
        { kind: event.kind, payload: event.payload },
        item.typeId,
        fields,
      ),
    )
    .map((rule) => rule.id);
}

type ServerTx = Parameters<Parameters<MutatorRunner["zqlDb"]["transaction"]>[0]>[0];

interface ActionContext {
  tx: ServerTx;
  ctx: { userID: string; causedBy: number };
  event: { id: number; actor: string | null };
  item: { id: string; name: string; spaceId: string; typeId: string; createdBy: string };
  ruleId: string;
  /** 这一步在规则里的位置，生成确定的 id 用：重试时生成同样的 id。 */
  step: number;
}

const call = (name: string, { tx, ctx }: ActionContext, args: unknown) =>
  mustGetMutator(serverMutators, name).fn({ tx, args: args as never, ctx });

/** 规则里每一步生成的新对象（评论、子任务、工作项）用确定的 id，同一事件重跑不会建出第二份。 */
const stepId = (c: ActionContext, suffix = "") => `auto-${c.event.id}-${c.ruleId}-${c.step}${suffix}`;

/** 执行一个动作。改工作项的动作都走 mutator，和人手动操作走同样的校验，并写出带起因的事件。 */
async function perform(action: AutomationAction, c: ActionContext): Promise<void> {
  const workItemId = c.item.id;
  switch (action.type) {
    case "setField":
      return call("fieldValue.set", c, { workItemId, fieldKey: action.field, value: action.value });
    case "setRole":
      return call("role.set", c, { workItemId, roleKey: action.role, userIds: action.userIds });
    case "confirmNode":
      return call("node.confirm", c, { workItemId, nodeKey: action.node });
    case "transitionStatus":
      return call("workItem.transition", c, { workItemId, to: action.to });
    case "terminate":
      return call("workItem.terminate", c, { workItemId, reason: action.reason || undefined });
    case "restore":
      return call("workItem.restore", c, { workItemId });
    case "addComment":
      return call("comment.create", c, {
        id: stepId(c),
        workItemId,
        body: renderTemplate(action.body, c.item),
        mentions: [],
      });
    case "createTask":
      return call("task.create", c, {
        id: stepId(c),
        workItemId,
        nodeKey: action.node,
        name: renderTemplate(action.name, c.item),
        assigneeId: action.assigneeId ?? null,
        due: null,
      });
    case "createWorkItem":
      return createWorkItemAction(action, c);
    case "notify":
      return notifyAction(action, c);
  }
}

async function createWorkItemAction(action: Extract<AutomationAction, { type: "createWorkItem" }>, c: ActionContext) {
  const db = drizzleTx(c.tx);
  const id = stepId(c);
  await call("workItem.create", c, {
    id,
    typeId: action.typeId,
    name: renderTemplate(action.name, c.item),
    fields: {},
    roles: {},
  });
  if (!action.relationDefId) return;
  const def = await db.query.relationDef.findFirst({ where: eq(schema.relationDef.id, action.relationDefId) });
  if (!def) throw new Error("动作里的关联已经不存在。");
  // 触发的工作项在哪一端由关联两端的类型决定；两端同类型时触发的工作项在 from 端
  const forward = def.fromTypeId === c.item.typeId && def.toTypeId === action.typeId;
  const backward = def.toTypeId === c.item.typeId && def.fromTypeId === action.typeId;
  if (!forward && !backward) throw new Error(`关联「${def.name}」连不上这两个工作项类型。`);
  await call("relation.add", c, {
    id: stepId(c, "-rel"),
    relationDefId: def.id,
    fromId: forward ? c.item.id : id,
    toId: forward ? id : c.item.id,
  });
}

/** 写站内通知，和规则的其他动作在同一个事务里提交。只发给仍在空间里的人。 */
async function notifyAction(action: Extract<AutomationAction, { type: "notify" }>, c: ActionContext) {
  const db = drizzleTx(c.tx);
  const [roles, values] = await Promise.all([
    db.query.roleMember.findMany({ where: eq(schema.roleMember.workItemId, c.item.id) }),
    db.query.fieldValue.findMany({ where: eq(schema.fieldValue.workItemId, c.item.id) }),
  ]);
  const roleMap: Record<string, string[]> = {};
  for (const r of roles) roleMap[r.roleKey] = [...(roleMap[r.roleKey] ?? []), r.userId];
  const userIds = resolveRecipients(action.to, {
    createdBy: c.item.createdBy,
    actor: c.event.actor,
    roles: roleMap,
    fields: Object.fromEntries(values.map((v) => [v.fieldKey, v.value])),
  });
  if (userIds.length === 0) return;
  const members = await db.query.spaceMember.findMany({
    where: and(eq(schema.spaceMember.spaceId, c.item.spaceId), inArray(schema.spaceMember.userId, userIds)),
  });
  if (members.length === 0) return;
  const text = renderTemplate(action.text, c.item);
  await db
    .insert(schema.notification)
    .values(
      members.map((m) => ({
        id: `${stepId(c)}:${m.userId}`,
        userId: m.userId,
        spaceId: c.item.spaceId,
        workItemId: c.item.id,
        kind: "automation" as const,
        text,
        eventId: c.event.id,
      })),
    )
    .onConflictDoNothing();
}

export type RunStatus = "succeeded" | "failed" | "skipped";

/**
 * 执行一条规则：所有动作以规则创建人的身份、在同一个事务里执行，和执行记录一起提交。
 * automation_run 的 (rule_id, event_id) 唯一，重试时已经执行过的直接返回上次的结果，不会重复执行。
 * 动作被业务规则拒绝（没有权限、节点不在进行中等）时整体回滚，记一条失败记录，不再重试。
 */
export async function runRule(
  runner: MutatorRunner,
  ruleId: string,
  eventId: number,
  workflowId: string,
): Promise<RunStatus> {
  const { db } = runner.database;
  const done = await db.query.automationRun.findFirst({
    where: and(eq(schema.automationRun.ruleId, ruleId), eq(schema.automationRun.eventId, eventId)),
  });
  if (done) return done.status === "running" ? "failed" : done.status;

  const rule = await db.query.automationRule.findFirst({ where: eq(schema.automationRule.id, ruleId) });
  const event = await db.query.eventLog.findFirst({ where: eq(schema.eventLog.id, eventId) });
  if (!rule || !event?.workItemId) throw new Error(`规则 ${ruleId} 或事件 ${eventId} 不存在`);
  const item = await db.query.workItem.findFirst({ where: eq(schema.workItem.id, event.workItemId) });
  if (!item) throw new Error(`工作项 ${event.workItemId} 不存在`);
  const ctx = { userID: rule.createdBy, causedBy: eventId };
  // 按执行时的字段值选分支：同一事件上前面的规则改过的字段，这里能看到
  const values = await db.query.fieldValue.findMany({ where: eq(schema.fieldValue.workItemId, item.id) });
  const actions = pickActions(
    { trigger: rule.trigger, condition: rule.conditions, actions: rule.actions, branches: rule.branches },
    Object.fromEntries(values.map((v) => [v.fieldKey, v.value])),
  );
  if (!actions) {
    await db
      .insert(schema.automationRun)
      .values({ ruleId, eventId, workflowId, status: "skipped", finishedAt: new Date() })
      .onConflictDoNothing();
    return "skipped";
  }

  try {
    await runner.zqlDb.transaction(async (tx) => {
      for (const [step, action] of actions.entries())
        await perform(action, { tx, ctx, event: { id: eventId, actor: event.actor }, item, ruleId, step });
      await drizzleTx(tx)
        .insert(schema.automationRun)
        .values({ ruleId, eventId, workflowId, status: "succeeded", finishedAt: new Date() });
    });
    return "succeeded";
  } catch (error) {
    await db
      .insert(schema.automationRun)
      .values({
        ruleId,
        eventId,
        workflowId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      })
      .onConflictDoNothing();
    return "failed";
  }
}
