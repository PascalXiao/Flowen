import { schema } from "@fp/db";
import { and, eq, ne } from "drizzle-orm";
import type { MutatorRunner } from "./index.ts";

/** 被依赖的节点不用再等了的事件：节点完成、被跳过，或它的工作项终止、删除。 */
const NODE_KINDS = new Set(["nodeCompleted", "nodeSkipped"]);
const ITEM_KINDS = new Set(["workItemTerminated", "workItemDeleted"]);

/**
 * 节点完成后，重算别的工作项里在等它的节点（同一个工作项里的依赖在完成时已经一起算了）。
 * 以对方工作项创建人的身份执行；重算没有变化时什么也不做，重试安全。
 * 一个工作项重算失败（如创建人已不在空间里）不影响其他的。
 */
export async function cascadeDependencies(runner: MutatorRunner, eventId: number): Promise<number> {
  const { db } = runner.database;
  const event = await db.query.eventLog.findFirst({ where: eq(schema.eventLog.id, eventId) });
  if (!event?.workItemId) return 0;
  const nodeKey = (event.payload as { node?: unknown } | null)?.node;
  const byNode = NODE_KINDS.has(event.kind) && typeof nodeKey === "string";
  if (!byNode && !ITEM_KINDS.has(event.kind)) return 0;
  const waiting = await db
    .selectDistinct({ workItemId: schema.nodeDependency.workItemId, createdBy: schema.workItem.createdBy })
    .from(schema.nodeDependency)
    .innerJoin(schema.nodeInstance, eq(schema.nodeInstance.id, schema.nodeDependency.targetNodeId))
    .innerJoin(schema.workItem, eq(schema.workItem.id, schema.nodeDependency.workItemId))
    .where(
      and(
        eq(schema.nodeInstance.workItemId, event.workItemId),
        ne(schema.nodeDependency.workItemId, event.workItemId),
        byNode ? eq(schema.nodeInstance.nodeKey, nodeKey as string) : undefined,
      ),
    );
  let done = 0;
  for (const w of waiting) {
    try {
      await runner.run("node.recheck", { workItemId: w.workItemId }, { userID: w.createdBy });
      done++;
    } catch (error) {
      console.warn(`依赖重算失败：工作项 ${w.workItemId}`, error);
    }
  }
  return done;
}
