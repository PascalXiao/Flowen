import { appendEvents, type Database, schema } from "@fp/db";
import {
  type DateTrigger,
  dateTriggerTarget,
  dayFromDate,
  dayOfDateValue,
  localSlot,
  type ScheduleTrigger,
  scheduleDue,
} from "@fp/engine";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";

export const HOUR_MS = 3_600_000;

/**
 * 时钟每个整点调用一次：找出这个整点该触发的定时规则和动态时间规则，给每个命中的工作项写一条事件。
 * 事件和普通事件一样经 Outbox 交给工作项的事件流，再由 matchRules 认领（payload 里带规则 id）、按条件筛、执行。
 * 每个（规则、工作项、整点）先占 automation_fire 一行，占到了才写事件，所以重试或时钟重复调用不会重复触发。
 * 返回写出的事件数。
 */
export async function tickAutomations(database: Database, slot: number): Promise<number> {
  const { db } = database;
  const at = Math.floor(slot / HOUR_MS) * HOUR_MS;
  const rules = (await db.query.automationRule.findMany({ where: eq(schema.automationRule.enabled, true) })).filter(
    (r) => r.trigger.kind === "schedule" || r.trigger.kind === "dateReached",
  );
  if (rules.length === 0) return 0;
  const spaces = await db.query.space.findMany({
    where: inArray(schema.space.id, [...new Set(rules.map((r) => r.spaceId))]),
  });
  const zoneOf = new Map(spaces.map((s) => [s.id, s.timezone]));

  let written = 0;
  for (const rule of rules) {
    const trigger = rule.trigger as ScheduleTrigger | DateTrigger;
    if (!trigger.typeId) continue;
    const local = localSlot(at, zoneOf.get(rule.spaceId) ?? "Asia/Shanghai");
    let itemIds: string[];
    if (trigger.kind === "schedule") {
      if (!scheduleDue(trigger, local)) continue;
      itemIds = (
        await db.query.workItem.findMany({
          columns: { id: true },
          where: and(
            eq(schema.workItem.spaceId, rule.spaceId),
            eq(schema.workItem.typeId, trigger.typeId),
            ne(schema.workItem.status, "terminated"),
            isNull(schema.workItem.deletedAt),
          ),
        })
      ).map((i) => i.id);
    } else {
      const target = dateTriggerTarget(trigger, local);
      if (target === null) continue;
      itemIds = await dueItems(database, rule.spaceId, trigger, target);
    }
    for (const workItemId of itemIds) {
      const fired = await db.transaction(async (tx) => {
        const claimed = await tx
          .insert(schema.automationFire)
          .values({ ruleId: rule.id, workItemId, slot: at })
          .onConflictDoNothing()
          .returning();
        if (claimed.length === 0) return false;
        await appendEvents(tx, [
          { spaceId: rule.spaceId, workItemId, kind: trigger.kind, payload: { ruleId: rule.id, slot: at } },
        ]);
        return true;
      });
      if (fired) written++;
    }
  }
  return written;
}

/** 日期（字段值或节点计划完成日）正好是 target 那天、还没完成也没终止的工作项。 */
async function dueItems(database: Database, spaceId: string, trigger: DateTrigger, target: number) {
  const { db } = database;
  const items = await db.query.workItem.findMany({
    columns: { id: true },
    where: and(
      eq(schema.workItem.spaceId, spaceId),
      eq(schema.workItem.typeId, trigger.typeId as string),
      eq(schema.workItem.status, "inProgress"),
      isNull(schema.workItem.deletedAt),
    ),
  });
  if (items.length === 0) return [];
  const ids = items.map((i) => i.id);
  if (trigger.date.startsWith("node:")) {
    const nodeKey = trigger.date.slice(5);
    const nodes = await db.query.nodeInstance.findMany({
      where: and(inArray(schema.nodeInstance.workItemId, ids), eq(schema.nodeInstance.nodeKey, nodeKey)),
    });
    return nodes
      .filter((n) => n.state !== "completed" && n.state !== "skipped" && n.plannedEnd)
      .filter((n) => dayFromDate(n.plannedEnd as Date) === target)
      .map((n) => n.workItemId);
  }
  const values = await db.query.fieldValue.findMany({
    where: and(inArray(schema.fieldValue.workItemId, ids), eq(schema.fieldValue.fieldKey, trigger.date)),
  });
  return values.filter((v) => dayOfDateValue(v.value) === target).map((v) => v.workItemId);
}
