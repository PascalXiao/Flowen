import { schema } from "@fp/db";
import { and, eq, inArray, or } from "drizzle-orm";
import type { MutatorRunner } from "./index.ts";

type Rule = typeof schema.linkRule.$inferSelect;

/**
 * 空间关联：一条事件发生后，按联动规则改关联的工作项。以规则创建人（空间管理员）的身份执行，
 * 写出的事件带 causedBy。字段和排期同步不再被联动写出的事件触发，避免双向规则来回同步；
 * 节点驱动可以接着往下传（完成一个节点驱动下一个工作项，再驱动下一个）。
 * 一个工作项联动失败不影响其他的。
 */
export async function cascadeLinks(runner: MutatorRunner, eventId: number): Promise<number> {
  const { db } = runner.database;
  const event = await db.query.eventLog.findFirst({ where: eq(schema.eventLog.id, eventId) });
  if (!event?.workItemId) return 0;
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const item = await db.query.workItem.findFirst({ where: eq(schema.workItem.id, event.workItemId) });
  if (!item) return 0;
  // 规则按关联定义找：跨空间关联的规则可能建在另一端的空间里
  const defs = await db.query.relationDef.findMany({
    where: or(eq(schema.relationDef.fromTypeId, item.typeId), eq(schema.relationDef.toTypeId, item.typeId)),
  });
  if (defs.length === 0) return 0;
  const rules = await db.query.linkRule.findMany({
    where: and(
      inArray(
        schema.linkRule.relationDefId,
        defs.map((d) => d.id),
      ),
      eq(schema.linkRule.enabled, true),
    ),
    with: { def: true },
  });
  if (rules.length === 0) return 0;
  const fromLink = event.causedBy != null;

  /** 这条规则下，item 作为源头时关联到的目标工作项。 */
  const targetsOf = async (rule: Rule & { def: typeof schema.relationDef.$inferSelect | null }) => {
    if (!rule.def) return [];
    const sourceType = rule.sourceSide === "from" ? rule.def.fromTypeId : rule.def.toTypeId;
    if (sourceType !== item.typeId) return [];
    const edges = await db.query.relation.findMany({
      where: and(
        eq(schema.relation.relationDefId, rule.relationDefId),
        rule.sourceSide === "from" ? eq(schema.relation.fromId, item.id) : eq(schema.relation.toId, item.id),
      ),
    });
    return edges.map((e) => (rule.sourceSide === "from" ? e.toId : e.fromId));
  };
  let done = 0;
  const run = async (rule: Rule, name: string, args: unknown) => {
    try {
      await runner.run(name, args, { userID: rule.createdBy, causedBy: eventId });
      done++;
    } catch (error) {
      console.warn(`空间关联「${rule.name}」联动失败：${name}`, error);
    }
  };
  const fieldValue = async (workItemId: string, fieldKey: string) =>
    (
      await db.query.fieldValue.findFirst({
        where: and(eq(schema.fieldValue.workItemId, workItemId), eq(schema.fieldValue.fieldKey, fieldKey)),
      })
    )?.value ?? null;

  for (const rule of rules) {
    const c = rule.config;
    switch (event.kind) {
      case "fieldChanged": {
        const key = payload.fieldKey ?? payload.field;
        if (fromLink || c.kind !== "field" || c.sourceField !== key) break;
        const value = await fieldValue(item.id, c.sourceField);
        for (const target of await targetsOf(rule))
          await run(rule, "fieldValue.set", { workItemId: target, fieldKey: c.targetField, value });
        break;
      }
      case "relationAdded": {
        // 建立关联时把源字段同步一次：event 在 from 一端，对端是 payload.toId
        if (fromLink || c.kind !== "field" || payload.relationDefId !== rule.relationDefId) break;
        const toId = String(payload.toId);
        const [source, target] = rule.sourceSide === "from" ? [item.id, toId] : [toId, item.id];
        await run(rule, "fieldValue.set", {
          workItemId: target,
          fieldKey: c.targetField,
          value: await fieldValue(source, c.sourceField),
        });
        break;
      }
      case "nodeCompleted": {
        if (c.kind !== "nodeDrive" || c.sourceNode !== payload.node) break;
        const targets = await targetsOf(rule);
        if (targets.length === 0) break;
        if (c.mode === "allow") {
          for (const target of targets) await run(rule, "node.recheck", { workItemId: target });
          break;
        }
        // 即完成：只完成正在进行的目标节点
        const live = await db.query.nodeInstance.findMany({
          where: and(
            inArray(schema.nodeInstance.workItemId, targets),
            eq(schema.nodeInstance.nodeKey, c.targetNode),
            eq(schema.nodeInstance.state, "inProgress"),
          ),
        });
        for (const n of live) await run(rule, "node.confirm", { workItemId: n.workItemId, nodeKey: c.targetNode });
        break;
      }
      case "nodePlanChanged": {
        if (fromLink || c.kind !== "nodeSchedule" || c.sourceNode !== payload.node) break;
        const plan =
          typeof payload.start === "string" && typeof payload.end === "string"
            ? { start: payload.start, end: payload.end }
            : {};
        for (const target of await targetsOf(rule))
          await run(rule, "node.setPlan", { workItemId: target, nodeKey: c.targetNode, ...plan });
        break;
      }
      case "workItemTerminated":
      case "workItemDeleted":
      case "workItemRestored": {
        // 源工作项终止、删除后，目标节点不用再等它
        if (c.kind !== "nodeDrive" || c.mode !== "allow") break;
        for (const target of await targetsOf(rule)) await run(rule, "node.recheck", { workItemId: target });
        break;
      }
      case "relationRemoved": {
        // 解除关联：目标不用再等这个源头。event 在 from 一端
        if (c.kind !== "nodeDrive" || c.mode !== "allow" || payload.relationDefId !== rule.relationDefId) break;
        const toId = String(payload.toId);
        await run(rule, "node.recheck", { workItemId: rule.sourceSide === "from" ? toId : item.id });
        break;
      }
    }
  }
  return done;
}
