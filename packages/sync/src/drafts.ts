import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";

/*
 * 新建工作项的草稿箱：每人自己的，只有自己看得到。
 * 新建表单里填过内容后自动保存（也可以手动存），创建成功或手动删除时去掉。
 */

export const saveItemDraftArgs = z.object({
  id: z.string().min(1).max(64),
  typeId: z.string(),
  name: z.string().max(500),
  data: z.object({
    flowTemplateId: z.string().optional(),
    fields: z.record(z.string(), z.json()).optional(),
    roles: z.record(z.string(), z.array(z.string()).max(200)).optional(),
    roleOverrides: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }).optional(),
  }),
});
export const deleteItemDraftArgs = z.object({ id: z.string() });

/** 每人每种工作项最多留这么多份草稿，再存就挤掉最旧的。 */
export const DRAFT_LIMIT = 20;

export async function saveItemDraft(tx: Transaction, args: z.output<typeof saveItemDraftArgs>, userID: string) {
  const existing = await tx.run(zql.workItemDraft.where("id", args.id).one());
  if (existing && existing.userId !== userID) throw new Error("草稿不存在。");
  if (!existing) {
    const type = await tx.run(
      zql.workItemType
        .where("id", args.typeId)
        .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)))
        .one(),
    );
    if (!type) throw new Error("工作项类型不存在或没有权限。");
    const mine = await tx.run(
      zql.workItemDraft.where("userId", userID).where("typeId", args.typeId).orderBy("updatedAt", "desc"),
    );
    for (const old of mine.slice(DRAFT_LIMIT - 1)) await tx.mutate.workItemDraft.delete({ id: old.id });
  }
  await tx.mutate.workItemDraft.upsert({
    id: args.id,
    userId: userID,
    typeId: existing?.typeId ?? args.typeId,
    name: args.name,
    data: args.data as never,
    updatedAt: Date.now(),
  });
}

export async function deleteItemDraft(tx: Transaction, args: z.output<typeof deleteItemDraftArgs>, userID: string) {
  const existing = await tx.run(zql.workItemDraft.where("id", args.id).one());
  if (!existing || existing.userId !== userID) return;
  await tx.mutate.workItemDraft.delete({ id: args.id });
}
