import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";

/*
 * 关注、收藏和最近浏览：都是个人的，只影响自己的列表页签（我关注的、我收藏的、最近浏览）。
 * 能看到工作项的人（包括访客）都可以。
 */

export const markArgs = z.object({
  workItemId: z.string(),
  kind: z.enum(["follow", "star"]),
  on: z.boolean(),
});
export const visitArgs = z.object({ workItemId: z.string() });

async function visible(tx: Transaction, workItemId: string, userID: string) {
  const item = await tx.run(
    zql.workItem
      .where("id", workItemId)
      .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)))
      .one(),
  );
  if (!item) throw new Error("工作项不存在或没有权限。");
  return item;
}

/** 关注或收藏（on 为 false 时取消）。 */
export async function setMark(tx: Transaction, args: z.output<typeof markArgs>, userID: string) {
  await visible(tx, args.workItemId, userID);
  const key = { workItemId: args.workItemId, userId: userID, kind: args.kind };
  if (args.on) await tx.mutate.workItemMark.upsert({ ...key, createdAt: Date.now() });
  else await tx.mutate.workItemMark.delete(key);
}

/** 记一次浏览（每人每个工作项只留最后一次）。 */
export async function recordVisit(tx: Transaction, args: z.output<typeof visitArgs>, userID: string) {
  await visible(tx, args.workItemId, userID);
  await tx.mutate.workItemVisit.upsert({ workItemId: args.workItemId, userId: userID, visitedAt: Date.now() });
}
