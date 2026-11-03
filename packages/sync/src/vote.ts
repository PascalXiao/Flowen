import type { VoteConfig, VoteSummary } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { hasAnyRole, myRoles, requireWriter } from "./access.ts";
import { fieldDefOf, storeFieldValue } from "./field-values.ts";
import { assertNotFrozen } from "./lifecycle.ts";
import { itemVisible } from "./permissions.ts";
import { zql } from "./schema.gen.ts";

export const castVoteArgs = z.object({
  workItemId: z.string(),
  fieldKey: z.string(),
  choices: z.array(z.string()).max(100),
  remark: z.string().trim().max(1000).optional(),
});
export const revealVoteArgs = z.object({ workItemId: z.string(), fieldKey: z.string(), revealed: z.boolean() });

/** 投票字段和它的设置、当前汇总。 */
async function voteField(tx: Transaction, workItemId: string, fieldKey: string, userID: string) {
  const item = await tx.run(zql.workItem.where("id", workItemId).where(itemVisible(userID)).one());
  if (!item) throw new Error("工作项不存在或没有权限。");
  const { isAdmin } = await requireWriter(tx, item.spaceId, userID);
  assertNotFrozen(item);
  if (item.status === "terminated") throw new Error("工作项已终止。");
  const field = await fieldDefOf(tx, item.typeId, fieldKey);
  if (field.dataType !== "vote") throw new Error(`「${field.name}」不是投票字段。`);
  const config: VoteConfig = (field.config as { vote?: VoteConfig } | null)?.vote ?? { mode: "single" };
  const row = await tx.run(zql.fieldValue.where("workItemId", workItemId).where("fieldKey", fieldKey).one());
  const summary: VoteSummary = {
    voters: (row?.value as VoteSummary | null)?.voters ?? [],
    revealed: (row?.value as VoteSummary | null)?.revealed ?? false,
  };
  return { item, field, config, summary, isAdmin };
}

/**
 * 投票或改票：表态、单选只能选一个，多选至少选一个；备注必填时要写。
 * 盲投且没放榜时票只有自己看得到；汇总（谁投过、是否放榜）存在字段值里，列表和筛选用。
 */
export async function castVote(tx: Transaction, args: z.output<typeof castVoteArgs>, userID: string) {
  const { item, field, config, summary } = await voteField(tx, args.workItemId, args.fieldKey, userID);
  const options = new Set((field.options ?? []).filter((o) => !o.disabled).map((o) => o.value));
  const choices = [...new Set(args.choices)];
  if (choices.length === 0) throw new Error("请选择一项再投票。");
  if (config.mode !== "multi" && choices.length > 1) throw new Error("只能选一项。");
  for (const c of choices) if (!options.has(c)) throw new Error(`没有选项「${c}」。`);
  const remark = args.remark?.trim() || null;
  if (config.remark === "required" && !remark) throw new Error("请填写投票备注。");
  await tx.mutate.voteBallot.upsert({
    workItemId: item.id,
    fieldKey: field.key,
    userId: userID,
    choices,
    remark: config.remark === "off" ? null : remark,
    revealed: !config.blind || summary.revealed,
    votedAt: Date.now(),
  });
  const next: VoteSummary = {
    voters: summary.voters.includes(userID) ? summary.voters : [...summary.voters, userID],
    revealed: summary.revealed,
  };
  await storeFieldValue(tx, item.id, { key: field.key, name: field.name, dataType: "vote" }, next);
  return { spaceId: item.spaceId };
}

/** 放榜或收起结果：空间管理员和投票字段设置里的放榜角色。只对盲投有意义。 */
export async function revealVote(tx: Transaction, args: z.output<typeof revealVoteArgs>, userID: string) {
  const { item, field, config, summary, isAdmin } = await voteField(tx, args.workItemId, args.fieldKey, userID);
  if (!config.blind) throw new Error(`「${field.name}」不是盲投，结果一直公开。`);
  if (!isAdmin && !(config.revealRoles?.length && hasAnyRole(config.revealRoles, await myRoles(tx, item.id, userID))))
    throw new Error("没有放榜权限。");
  const ballots = await tx.run(zql.voteBallot.where("workItemId", item.id).where("fieldKey", field.key));
  for (const b of ballots)
    if (b.revealed !== args.revealed)
      await tx.mutate.voteBallot.update({
        workItemId: b.workItemId,
        fieldKey: b.fieldKey,
        userId: b.userId,
        revealed: args.revealed,
      });
  await storeFieldValue(
    tx,
    item.id,
    { key: field.key, name: field.name, dataType: "vote" },
    { ...summary, revealed: args.revealed },
  );
  return { spaceId: item.spaceId };
}
