import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";
import { assertAdmin, condition } from "./templates.ts";

const typeId = z.string().optional();

export const automationTrigger = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("workItemCreated"), typeId }),
  z.object({ kind: z.enum(["nodeStarted", "nodeCompleted"]), typeId, node: z.string().optional() }),
  z.object({ kind: z.literal("fieldChanged"), typeId, field: z.string().min(1) }),
]);

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
]);

const ruleBody = {
  name: z.string().trim().min(1, "规则要有名称。").max(100),
  trigger: automationTrigger,
  condition: condition.nullable().optional(),
  actions: z.array(automationAction).min(1, "至少要有一个动作。").max(20),
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
