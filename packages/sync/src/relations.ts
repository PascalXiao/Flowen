import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { requireWriter } from "./access.ts";
import { recomputeFormulas } from "./formulas.ts";
import { itemVisible } from "./permissions.ts";
import { zql } from "./schema.gen.ts";
import { assertAdmin } from "./templates.ts";

export const createRelationDefArgs = z.object({
  id: z.string(),
  fromTypeId: z.string(),
  toTypeId: z.string(),
  name: z.string().trim().min(1, "关联要有名称。").max(50),
  cardinality: z.enum(["one", "many"]),
  /** 互相关联：另一端的字段名和数量；不填就只在 from 一端有字段。 */
  reverseName: z.string().trim().min(1).max(50).optional(),
  reverseCardinality: z.enum(["one", "many"]).optional(),
});
export const deleteRelationDefArgs = z.object({ id: z.string() });
export const addRelationArgs = z.object({
  id: z.string(),
  relationDefId: z.string(),
  fromId: z.string(),
  toId: z.string(),
});
export const removeRelationArgs = z.object({ id: z.string() });

/** 在类型上定义一种关联，如需求的“关联 SKU”。只有空间管理员可以；两端类型必须在同一个空间。 */
export async function createRelationDef(tx: Transaction, args: z.output<typeof createRelationDefArgs>, userID: string) {
  const from = await tx.run(zql.workItemType.where("id", args.fromTypeId).related("relationDefs").one());
  if (!from) throw new Error("工作项类型不存在。");
  await assertAdmin(tx, from.spaceId, userID);
  const to = await tx.run(zql.workItemType.where("id", args.toTypeId).one());
  if (to?.spaceId !== from.spaceId) throw new Error("只能关联同一个空间的类型。");
  if (from.relationDefs.some((d) => d.name === args.name)) throw new Error(`关联「${args.name}」已经存在。`);
  if (args.reverseName) {
    // 另一端的字段名不能和那一端已有的关联重名
    const taken = [
      ...(await tx.run(zql.relationDef.where("fromTypeId", args.toTypeId))).map((d) => d.name),
      ...(await tx.run(zql.relationDef.where("toTypeId", args.toTypeId))).flatMap((d) =>
        d.reverseName ? [d.reverseName] : [],
      ),
    ];
    if (taken.includes(args.reverseName) || (args.toTypeId === args.fromTypeId && args.reverseName === args.name))
      throw new Error(`关联「${args.reverseName}」已经存在。`);
  }
  await tx.mutate.relationDef.insert({
    id: args.id,
    spaceId: from.spaceId,
    fromTypeId: args.fromTypeId,
    toTypeId: args.toTypeId,
    fieldKey: args.name,
    name: args.name,
    cardinality: args.cardinality,
    reverseName: args.reverseName ?? null,
    reverseCardinality: args.reverseName ? (args.reverseCardinality ?? "many") : null,
    createdAt: Date.now(),
  });
}

/** 删除关联定义，连同已经建立的关联。 */
export async function deleteRelationDef(tx: Transaction, args: z.output<typeof deleteRelationDefArgs>, userID: string) {
  const def = await tx.run(zql.relationDef.where("id", args.id).one());
  if (!def) throw new Error("关联不存在。");
  await assertAdmin(tx, def.spaceId, userID);
  for (const r of await tx.run(zql.relation.where("relationDefId", args.id)))
    await tx.mutate.relation.delete({ id: r.id });
  await tx.mutate.relationDef.delete({ id: args.id });
}

/** 当前用户所在空间里的工作项。 */
function visibleItem(id: string, userID: string) {
  return zql.workItem.where("id", id).where(itemVisible(userID)).one();
}

/**
 * 关联两个工作项。空间管理员和成员可以；两端的类型要和定义一致。
 * 只能关联一个的定义，新关联替换旧的。返回被替换掉的工作项，用来记事件。
 */
export async function addRelation(tx: Transaction, args: z.output<typeof addRelationArgs>, userID: string) {
  const def = await tx.run(zql.relationDef.where("id", args.relationDefId).one());
  const from = await tx.run(visibleItem(args.fromId, userID));
  if (!def || !from) throw new Error("工作项不存在或没有权限。");
  if (from.typeId !== def.fromTypeId) throw new Error(`「${from.name}」不能使用关联「${def.name}」。`);
  const to = await tx.run(zql.workItem.where("id", args.toId).one());
  if (!to || to.spaceId !== from.spaceId || to.typeId !== def.toTypeId)
    throw new Error(`关联「${def.name}」只能选同一个空间里对应类型的工作项。`);
  if (to.id === from.id) throw new Error("不能关联自己。");
  await requireWriter(tx, from.spaceId, userID);

  const existing = await tx.run(zql.relation.where("relationDefId", def.id).where("fromId", from.id));
  if (existing.some((r) => r.toId === to.id)) throw new Error(`已经关联过「${to.name}」。`);
  const replaced = def.cardinality === "one" ? existing : [];
  for (const r of replaced) await tx.mutate.relation.delete({ id: r.id });
  if (def.reverseName && def.reverseCardinality === "one") {
    const crowded = await tx.run(zql.relation.where("relationDefId", def.id).where("toId", to.id));
    for (const r of crowded) await tx.mutate.relation.delete({ id: r.id });
    for (const r of crowded) await recomputeFormulas(tx, r.fromId);
  }
  await tx.mutate.relation.insert({
    id: args.id,
    relationDefId: def.id,
    parentNodeKey: null,
    fromId: from.id,
    toId: to.id,
    createdAt: Date.now(),
  });
  // 两端的公式可能用 RELATED 读关联的工作项
  for (const id of [from.id, to.id, ...replaced.map((r) => r.toId)]) await recomputeFormulas(tx, id);
  return { spaceId: from.spaceId, replaced: replaced.map((r) => r.toId) };
}

/** 取消关联。子工作项关系不能在这里取消。 */
export async function removeRelation(tx: Transaction, args: z.output<typeof removeRelationArgs>, userID: string) {
  const relation = await tx.run(zql.relation.where("id", args.id).one());
  const from = relation && (await tx.run(visibleItem(relation.fromId, userID)));
  if (!relation?.relationDefId || !from) throw new Error("关联不存在或没有权限。");
  await requireWriter(tx, from.spaceId, userID);
  await tx.mutate.relation.delete({ id: args.id });
  for (const id of [relation.fromId, relation.toId]) await recomputeFormulas(tx, id);
  return { spaceId: from.spaceId, relation };
}
