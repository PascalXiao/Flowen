import { type AutomationRecipient, NODE_TRIGGERS, PLAIN_TRIGGERS, TARGETABLE_ACTIONS } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { requireWriter } from "./access.ts";
import { zql } from "./schema.gen.ts";
import { assertAdmin, condition } from "./templates.ts";

const typeId = z.string().optional();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式是 YYYY-MM-DD。");

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
      every: z.number().int().min(1).max(365).optional(),
      startDate: isoDay.optional(),
      endDate: isoDay.optional(),
      weekdays: z.array(z.number().int().min(0).max(6)).optional(),
      monthDays: z.array(z.number().int().min(1).max(31)).optional(),
      hour: z.number().int().min(0).max(23),
    })
    .refine((t) => !!t.typeId, "定时触发要选工作项类型。")
    .refine((t) => t.frequency !== "week" || (t.weekdays?.length ?? 0) > 0, "每周触发至少要选一天。")
    .refine((t) => t.frequency !== "month" || (t.monthDays?.length ?? 0) > 0, "每月触发至少要选一天。")
    .refine((t) => !t.startDate || !t.endDate || t.startDate <= t.endDate, "生效结束日不能早于开始日。"),
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
  z.object({ kind: z.literal("manual"), typeId }).refine((t) => !!t.typeId, "手动运行要选工作项类型。"),
]);

const recipient = z.custom<AutomationRecipient>(
  (v) => typeof v === "string" && /^(creator|actor|currentNodeOwners|(role|field|node|user):.+)$/.test(v),
  "收件人格式不对。",
);
const text = (message: string) => z.string().trim().min(1, message).max(2000);

const literal = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.object({ start: z.string(), end: z.string() }),
  z.null(),
]);
const valueSource = z.object({ field: z.string().min(1), relation: z.string().nullable().optional() });
const target = z.object({
  relation: z.string().min(1, "要选通过哪条关联找工作项。"),
  condition: condition.nullable().optional(),
});

/** 外部接口地址：http 或 https，不带用户名密码。是不是内网地址在发请求时检查（域名可能解析到内网）。 */
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, "请填写 http 或 https 开头的地址。");
/** 这些请求头由系统设置，不能自己填。 */
const RESERVED_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection"]);
const header = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, "请求头名称只能用字母、数字和 - 等符号。")
    .refine((n) => !RESERVED_HEADERS.has(n.toLowerCase()), "这个请求头由系统设置。"),
  value: z
    .string()
    .max(2000)
    .refine((v) => !/[\r\n]/.test(v), "请求头的值不能换行。"),
});

const actionBody = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("setField"),
    field: z.string().min(1),
    value: literal,
    copy: valueSource.nullable().optional(),
  }),
  z.object({
    type: z.literal("setRole"),
    role: z.string().min(1),
    userIds: z.array(z.string()),
    copy: valueSource.nullable().optional(),
  }),
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
    fields: z
      .array(z.object({ field: z.string().min(1), value: literal.optional(), from: z.string().nullable().optional() }))
      .max(50)
      .nullable()
      .optional(),
  }),
  z.object({
    type: z.literal("notify"),
    to: z.array(recipient).min(1, "通知至少要有一个收件人。"),
    text: text("通知内容不能为空。"),
  }),
  z.object({
    type: z.literal("httpRequest"),
    url: httpUrl,
    headers: z.array(header).max(20).nullable().optional(),
    body: z.string().max(20_000).nullable().optional(),
  }),
]);

export const automationAction = z
  .intersection(actionBody, z.object({ target: target.nullable().optional() }))
  .refine(
    (a) => !a.target || (TARGETABLE_ACTIONS as readonly string[]).includes(a.type),
    "这个动作只能作用在触发的工作项上。",
  );

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

/**
 * 规则的触发类型可以是别的空间的类型（跨空间自动化）：这时要同时是那个空间的管理员。
 * 动作作用到跨空间关联的工作项上时不用额外检查：规则以创建人身份执行，没有权限的动作会失败并记下原因。
 */
async function assertTriggerSpace(tx: Transaction, spaceId: string, typeId: string | undefined, userID: string) {
  if (!typeId) return;
  const type = await tx.run(zql.workItemType.where("id", typeId).one());
  if (!type) throw new Error("触发的工作项类型不存在。");
  if (type.spaceId !== spaceId) await assertAdmin(tx, type.spaceId, userID);
}

/** 新建自动化规则。只有空间管理员可以；规则以创建人身份执行。 */
export async function createAutomation(tx: Transaction, args: z.output<typeof createAutomationArgs>, userID: string) {
  await assertAdmin(tx, args.spaceId, userID);
  await assertTriggerSpace(tx, args.spaceId, args.trigger.typeId, userID);
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
  const rule = await adminRule(tx, args.id, userID);
  await assertTriggerSpace(tx, rule.spaceId, args.trigger.typeId, userID);
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
  const requests = await tx.run(zql.automationRequest.where("ruleId", args.id));
  for (const r of requests) await tx.mutate.automationRequest.delete({ id: r.id });
  await tx.mutate.automationRule.delete({ id: args.id });
}

export const runAutomationArgs = z.object({ ruleId: z.string(), workItemId: z.string() });

/**
 * 手动运行一条「手动运行」规则：检查规则和工作项对得上，事件由服务端写出，之后和别的事件一样执行。
 * 规则所在空间的管理员，或者能编辑这个工作项的人（在工作项详情里点）都可以运行。
 */
export async function checkManualRun(tx: Transaction, args: z.output<typeof runAutomationArgs>, userID: string) {
  const rule = await tx.run(zql.automationRule.where("id", args.ruleId).one());
  if (!rule) throw new Error("规则不存在。");
  if (!rule.enabled) throw new Error("规则已停用。");
  const trigger = rule.trigger as { kind: string; typeId?: string };
  if (trigger.kind !== "manual") throw new Error("这条规则不是手动运行的规则。");
  const item = await tx.run(zql.workItem.where("id", args.workItemId).one());
  if (!item || item.deletedAt) throw new Error("工作项不存在。");
  if (trigger.typeId && item.typeId !== trigger.typeId) throw new Error("工作项的类型和规则不一致。");
  await requireWriter(tx, item.spaceId, userID);
  return { spaceId: item.spaceId, ruleSpaceId: rule.spaceId };
}
