import { type AutomationRecipient, NODE_TRIGGERS, PLAIN_TRIGGERS } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";
import { assertAdmin, condition } from "./templates.ts";

const typeId = z.string().optional();

export const automationTrigger = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(PLAIN_TRIGGERS), typeId }),
  z.object({ kind: z.enum(NODE_TRIGGERS), typeId, node: z.string().optional() }),
  z.object({ kind: z.literal("fieldChanged"), typeId, field: z.string().min(1) }),
  z.object({ kind: z.literal("statusChanged"), typeId, from: z.string().optional(), to: z.string().optional() }),
  z.object({ kind: z.literal("roleChanged"), typeId, role: z.string().optional() }),
  z.object({ kind: z.enum(["relationAdded", "relationRemoved"]), typeId, relation: z.string().optional() }),
  z
    .object({
      kind: z.literal("schedule"),
      typeId,
      frequency: z.enum(["day", "week", "month"]),
      weekdays: z.array(z.number().int().min(0).max(6)).optional(),
      monthDays: z.array(z.number().int().min(1).max(31)).optional(),
      hour: z.number().int().min(0).max(23),
    })
    .refine((t) => !!t.typeId, "定时触发要选工作项类型。")
    .refine((t) => t.frequency !== "week" || (t.weekdays?.length ?? 0) > 0, "每周触发至少要选一天。")
    .refine((t) => t.frequency !== "month" || (t.monthDays?.length ?? 0) > 0, "每月触发至少要选一天。"),
  z
    .object({
      kind: z.literal("dateReached"),
      typeId,
      date: z.string().min(1, "要选按哪个日期触发。"),
      when: z.enum(["before", "on", "after"]),
      days: z.number().int().min(0).max(365),
      hour: z.number().int().min(0).max(23),
    })
    .refine((t) => !!t.typeId, "时间触发要选工作项类型。"),
]);

const recipient = z.custom<AutomationRecipient>(
  (v) => typeof v === "string" && /^(creator|actor|(role|field|user):.+)$/.test(v),
  "收件人格式不对。",
);
const text = (message: string) => z.string().trim().min(1, message).max(2000);

export const automationAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("setField"),
    field: z.string().min(1),
    value: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.string()),
      z.object({ start: z.string(), end: z.string() }),
      z.null(),
    ]),
  }),
  z.object({ type: z.literal("setRole"), role: z.string().min(1), userIds: z.array(z.string()) }),
  z.object({ type: z.literal("confirmNode"), node: z.string().min(1) }),
  z.object({ type: z.literal("transitionStatus"), to: z.string().min(1, "要选流转到的状态。") }),
  z.object({ type: z.literal("terminate"), reason: z.string().trim().max(500).optional() }),
  z.object({ type: z.literal("restore") }),
  z.object({ type: z.literal("addComment"), body: text("评论内容不能为空。") }),
  z.object({
    type: z.literal("createTask"),
    node: z.string().min(1, "要选子任务所在的节点。"),
    name: text("子任务要有名称。"),
    assigneeId: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("createWorkItem"),
    typeId: z.string().min(1, "要选新建的工作项类型。"),
    name: text("新工作项要有名称。"),
    relationDefId: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("notify"),
    to: z.array(recipient).min(1, "通知至少要有一个收件人。"),
    text: text("通知内容不能为空。"),
  }),
]);

const actionList = z.array(automationAction).min(1, "至少要有一个动作。").max(20);

const ruleBody = {
  name: z.string().trim().min(1, "规则要有名称。").max(100),
  trigger: automationTrigger,
  condition: condition.nullable().optional(),
  actions: actionList,
  /** 主条件不满足时按顺序找第一个满足的分支；条件为空的分支是「否则」。 */
  branches: z
    .array(z.object({ condition: condition.nullable().optional(), actions: actionList }))
    .max(10)
    .nullable()
    .optional(),
};

export const createAutomationArgs = z.object({ id: z.string(), spaceId: z.string(), ...ruleBody });
export const updateAutomationArgs = z.object({ id: z.string(), ...ruleBody, enabled: z.boolean() });
export const deleteAutomationArgs = z.object({ id: z.string() });

/** 新建自动化规则。只有空间管理员可以；规则以创建人身份执行。 */
export async function createAutomation(tx: Transaction, args: z.output<typeof createAutomationArgs>, userID: string) {
  await assertAdmin(tx, args.spaceId, userID);
  const now = Date.now();
  await tx.mutate.automationRule.insert({
    id: args.id,
    spaceId: args.spaceId,
    name: args.name,
    enabled: true,
    trigger: args.trigger,
    conditions: args.condition ?? null,
    actions: args.actions,
    branches: args.branches?.length ? args.branches : null,
    createdBy: userID,
    createdAt: now,
    updatedAt: now,
  });
}

async function adminRule(tx: Transaction, id: string, userID: string) {
  const rule = await tx.run(zql.automationRule.where("id", id).one());
  if (!rule) throw new Error("规则不存在。");
  await assertAdmin(tx, rule.spaceId, userID);
  return rule;
}

/** 修改规则（包括启用、停用）。之后的事件按新规则执行，已经执行过的不受影响。 */
export async function updateAutomation(tx: Transaction, args: z.output<typeof updateAutomationArgs>, userID: string) {
  await adminRule(tx, args.id, userID);
  await tx.mutate.automationRule.update({
    id: args.id,
    name: args.name,
    enabled: args.enabled,
    trigger: args.trigger,
    conditions: args.condition ?? null,
    actions: args.actions,
    branches: args.branches?.length ? args.branches : null,
    updatedAt: Date.now(),
  });
}

/** 删除规则和它的执行记录。 */
export async function deleteAutomation(tx: Transaction, args: z.output<typeof deleteAutomationArgs>, userID: string) {
  await adminRule(tx, args.id, userID);
  const runs = await tx.run(zql.automationRun.where("ruleId", args.id));
  for (const run of runs) await tx.mutate.automationRun.delete({ id: run.id });
  await tx.mutate.automationRule.delete({ id: args.id });
}
