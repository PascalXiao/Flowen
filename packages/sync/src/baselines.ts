import { dayFromDate, dayToIso } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { requireWriter } from "./access.ts";
import { itemVisible } from "./permissions.ts";
import { zql } from "./schema.gen.ts";

/** 一个工作项最多存的基线数：够对比立项、几次大调整，不至于越攒越多。 */
export const MAX_BASELINES = 10;

export const saveBaselineArgs = z.object({
  id: z.string(),
  workItemId: z.string(),
  name: z.string().trim().min(1, "基线要有名称。").max(60),
});
export const deleteBaselineArgs = z.object({ id: z.string() });

/**
 * 把工作项当前所有节点的计划日期存成一条基线。空间成员都可以（访客不行）；
 * 跳过的、还没排期的节点不进基线。
 */
export async function saveBaseline(tx: Transaction, args: z.output<typeof saveBaselineArgs>, userID: string) {
  const item = await tx.run(
    zql.workItem.where("id", args.workItemId).where(itemVisible(userID)).related("nodes").related("baselines").one(),
  );
  if (!item) throw new Error("工作项不存在或没有权限。");
  await requireWriter(tx, item.spaceId, userID);
  if (item.baselines.length >= MAX_BASELINES)
    throw new Error(`一个工作项最多存 ${MAX_BASELINES} 条基线，先删掉不用的。`);
  const nodes: Record<string, { start: string; end: string }> = {};
  for (const n of item.nodes) {
    if (n.state === "skipped" || n.plannedStart == null || n.plannedEnd == null) continue;
    nodes[n.nodeKey] = { start: dayToIso(dayFromDate(n.plannedStart)), end: dayToIso(dayFromDate(n.plannedEnd)) };
  }
  if (Object.keys(nodes).length === 0) throw new Error("还没有排期，存不了基线。");
  await tx.mutate.planBaseline.insert({
    id: args.id,
    workItemId: item.id,
    name: args.name,
    nodes,
    createdBy: userID,
    createdAt: Date.now(),
  });
  return { spaceId: item.spaceId, nodes: Object.keys(nodes).length };
}

/** 删基线：存它的人或空间管理员。 */
export async function deleteBaseline(tx: Transaction, args: z.output<typeof deleteBaselineArgs>, userID: string) {
  const baseline = await tx.run(zql.planBaseline.where("id", args.id).one());
  if (!baseline) throw new Error("基线不存在。");
  const item = await tx.run(zql.workItem.where("id", baseline.workItemId).where(itemVisible(userID)).one());
  if (!item) throw new Error("工作项不存在或没有权限。");
  const { isAdmin } = await requireWriter(tx, item.spaceId, userID);
  if (!isAdmin && baseline.createdBy !== userID) throw new Error("只有存基线的人或空间管理员可以删除。");
  await tx.mutate.planBaseline.delete({ id: args.id });
  return { spaceId: item.spaceId, baseline };
}
