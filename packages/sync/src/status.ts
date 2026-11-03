import { isFinal, type StatusEvent, StatusFlow, statusFlowOf } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { requireWriter } from "./access.ts";
import { recomputeParentFormulas } from "./formulas.ts";
import { zql } from "./schema.gen.ts";

export const transitionArgs = z.object({ workItemId: z.string(), to: z.string() });

/**
 * 状态流工作项流转到另一个状态。流转要在状态流里定义过；配了角色的流转只有担任这些角色的人（或空间管理员）能操作；
 * 有条件的流转按当前字段值判断。进入“已完成 / 已关闭”类状态时工作项完成，离开时重新打开。
 */
export async function transitionStatus(
  tx: Transaction,
  args: z.output<typeof transitionArgs>,
  userID: string,
): Promise<{ spaceId: string; events: StatusEvent[] }> {
  const item = await tx.run(
    zql.workItem
      .where("id", args.workItemId)
      .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)))
      .related("flowVersion")
      .related("fieldValues")
      .related("roleMembers", (r) => r.where("userId", userID))
      .one(),
  );
  if (!item) throw new Error("工作项不存在或没有权限。");
  if (item.status === "terminated") throw new Error("工作项已终止。");
  if (item.frozen) throw new Error("工作项已冻结，解冻后才能修改。");
  const definition = statusFlowOf(item.flowVersion?.definition);
  if (!definition) throw new Error("这个工作项不是状态流。");
  const { isAdmin } = await requireWriter(tx, item.spaceId, userID);

  const flow = new StatusFlow(definition);
  const events = flow.transition(
    item.flowStatus ?? flow.initial.key,
    args.to,
    { userId: userID, roles: item.roleMembers.map((m) => m.roleKey), isAdmin },
    Object.fromEntries(item.fieldValues.map((f) => [f.fieldKey, f.value])),
  );
  const target = flow.status(args.to);
  await tx.mutate.workItem.update({
    id: item.id,
    flowStatus: target.key,
    stage: target.name,
    status: isFinal(target.category) ? "completed" : "inProgress",
    updatedAt: Date.now(),
  });
  await recomputeParentFormulas(tx, item.id);
  return { spaceId: item.spaceId, events };
}
