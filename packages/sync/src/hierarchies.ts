import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";
import { assertAdmin } from "./templates.ts";

/** 一个空间最多几棵层级树、一棵树最多几层（含第一层）。 */
export const MAX_HIERARCHIES = 10;
export const MAX_HIERARCHY_DEPTH = 20;

const layerArgs = z.object({
  typeId: z.string(),
  relationDefId: z.string().nullable(),
  reverse: z.boolean().optional(),
  repeat: z.boolean().optional(),
});
export type HierarchyLayerArgs = z.output<typeof layerArgs>;

export const createHierarchyArgs = z.object({
  id: z.string(),
  spaceId: z.string(),
  name: z.string().trim().min(1, "层级要有名称。").max(50),
  rootTypeId: z.string(),
  layers: z.array(layerArgs).max(MAX_HIERARCHY_DEPTH - 1),
});
export const updateHierarchyArgs = z.object({
  id: z.string(),
  name: z.string().trim().min(1, "层级要有名称。").max(50).optional(),
  layers: z
    .array(layerArgs)
    .max(MAX_HIERARCHY_DEPTH - 1)
    .optional(),
});
export const deleteHierarchyArgs = z.object({ id: z.string() });

interface RelationDefLike {
  id: string;
  name: string;
  fromTypeId: string;
  toTypeId: string;
}

/** 层级里能用的工作项类型：本空间的，以及沿跨空间关联走到的别的空间的。 */
export interface HierarchyTypeLike {
  id: string;
  spaceId: string;
}

/**
 * 从某个类型往下一层能走的路：沿碰到这个类型的自定义关系的两个方向（包括跨空间关联，
 * 走到别的空间后也能沿那个空间自己的关系继续往下），或者子工作项关系到同一个空间的任意类型。
 */
export interface HierarchyStep {
  typeId: string;
  relationDefId: string | null;
  reverse: boolean;
}

export function nextSteps(
  typeId: string,
  defs: readonly RelationDefLike[],
  types: readonly HierarchyTypeLike[],
): HierarchyStep[] {
  const spaceId = types.find((t) => t.id === typeId)?.spaceId;
  const steps: HierarchyStep[] = [];
  for (const d of defs) {
    if (d.fromTypeId === typeId) steps.push({ typeId: d.toTypeId, relationDefId: d.id, reverse: false });
    // 同类型的关系正反两个方向是一样的，只留正向
    if (d.toTypeId === typeId && d.fromTypeId !== d.toTypeId)
      steps.push({ typeId: d.fromTypeId, relationDefId: d.id, reverse: true });
  }
  // 子工作项只能建在同一个空间里
  for (const t of types) if (t.spaceId === spaceId) steps.push({ typeId: t.id, relationDefId: null, reverse: false });
  return steps;
}

/** 检查每一层都能从上一层走到；返回第一个问题，没有问题时返回 null。 */
export function checkLayers(
  spaceId: string,
  rootTypeId: string,
  layers: readonly HierarchyLayerArgs[],
  defs: readonly RelationDefLike[],
  types: readonly HierarchyTypeLike[],
): string | null {
  if (types.find((t) => t.id === rootTypeId)?.spaceId !== spaceId) return "第一层的工作项类型不存在。";
  let parent = rootTypeId;
  for (const [i, layer] of layers.entries()) {
    const ok = nextSteps(parent, defs, types).some(
      (s) =>
        s.typeId === layer.typeId && s.relationDefId === layer.relationDefId && s.reverse === (layer.reverse ?? false),
    );
    if (!ok) return `第 ${i + 2} 层和上一层之间没有这条关系。`;
    if (layer.repeat && parent !== layer.typeId && layer.relationDefId !== null) {
      // 层级循环只能用两端类型相同的关系，或者子工作项关系
      const def = defs.find((d) => d.id === layer.relationDefId);
      if (def && def.fromTypeId !== def.toTypeId) return `第 ${i + 2} 层的关系两端类型不同，不能循环。`;
    }
    parent = layer.typeId;
  }
  return null;
}

/**
 * 检查层级要用的配置：本空间和层级经过的别的空间的类型，以及碰到这些空间的关系。
 * 层级走进别的空间时，改层级的人也要是那个空间的成员（不然看不到那边的配置）。
 */
async function layerConfig(tx: Transaction, spaceId: string, layers: readonly HierarchyLayerArgs[], userID: string) {
  const layerTypes = layers.length
    ? await tx.run(zql.workItemType.where("id", "IN", [...new Set(layers.map((l) => l.typeId))]))
    : [];
  const spaceIds = [...new Set([spaceId, ...layerTypes.map((t) => t.spaceId)])];
  for (const other of spaceIds.filter((s) => s !== spaceId)) {
    const member = await tx.run(zql.spaceMember.where("spaceId", other).where("userId", userID).one());
    if (!member) throw new Error("层级经过的别的空间，你也要是那个空间的成员。");
  }
  const types = await tx.run(zql.workItemType.where("spaceId", "IN", spaceIds));
  const defs = [
    ...(await tx.run(zql.relationDef.where("spaceId", "IN", spaceIds))),
    ...(await tx.run(zql.relationDef.where("toSpaceId", "IN", spaceIds))),
  ];
  // 跨空间关联另一端的类型（可能在第三个空间）也算进来
  const known = new Set(types.map((t) => t.id));
  const far = [...new Set(defs.flatMap((d) => [d.fromTypeId, d.toTypeId]).filter((id) => !known.has(id)))];
  const farTypes = far.length ? await tx.run(zql.workItemType.where("id", "IN", far)) : [];
  return { types: [...types, ...farTypes], defs };
}

const clean = (layers: readonly HierarchyLayerArgs[]) =>
  layers.map((l) => ({
    typeId: l.typeId,
    relationDefId: l.relationDefId,
    ...(l.reverse && { reverse: true }),
    ...(l.repeat && { repeat: true }),
  }));

/** 新建一棵层级树。只有空间管理员可以。 */
export async function createHierarchy(tx: Transaction, args: z.output<typeof createHierarchyArgs>, userID: string) {
  await assertAdmin(tx, args.spaceId, userID);
  const existing = await tx.run(zql.hierarchy.where("spaceId", args.spaceId));
  if (existing.length >= MAX_HIERARCHIES) throw new Error(`一个空间最多 ${MAX_HIERARCHIES} 个层级。`);
  if (existing.some((h) => h.name === args.name)) throw new Error(`层级「${args.name}」已经存在。`);
  const { types, defs } = await layerConfig(tx, args.spaceId, args.layers, userID);
  const problem = checkLayers(args.spaceId, args.rootTypeId, args.layers, defs, types);
  if (problem) throw new Error(problem);
  await tx.mutate.hierarchy.insert({
    id: args.id,
    spaceId: args.spaceId,
    name: args.name,
    rootTypeId: args.rootTypeId,
    layers: clean(args.layers),
    createdBy: userID,
    createdAt: Date.now(),
  });
}

/** 改名或改层：第一层不能改，要换第一层就新建一棵。 */
export async function updateHierarchy(tx: Transaction, args: z.output<typeof updateHierarchyArgs>, userID: string) {
  const current = await tx.run(zql.hierarchy.where("id", args.id).one());
  if (!current) throw new Error("层级不存在。");
  await assertAdmin(tx, current.spaceId, userID);
  if (args.name !== undefined && args.name !== current.name) {
    const clash = await tx.run(zql.hierarchy.where("spaceId", current.spaceId).where("name", args.name).one());
    if (clash) throw new Error(`层级「${args.name}」已经存在。`);
  }
  if (args.layers) {
    const { types, defs } = await layerConfig(tx, current.spaceId, args.layers, userID);
    const problem = checkLayers(current.spaceId, current.rootTypeId, args.layers, defs, types);
    if (problem) throw new Error(problem);
  }
  await tx.mutate.hierarchy.update({
    id: args.id,
    ...(args.name !== undefined && { name: args.name }),
    ...(args.layers && { layers: clean(args.layers) }),
  });
}

export async function deleteHierarchy(tx: Transaction, args: z.output<typeof deleteHierarchyArgs>, userID: string) {
  const current = await tx.run(zql.hierarchy.where("id", args.id).one());
  if (!current) throw new Error("层级不存在。");
  await assertAdmin(tx, current.spaceId, userID);
  await tx.mutate.hierarchy.delete({ id: args.id });
}

/** 删关系前看有没有层级在用它。层级可以跨空间，所以每个空间的层级都要看。 */
export async function hierarchiesUsing(tx: Transaction, relationDefId: string) {
  const all = await tx.run(zql.hierarchy);
  return all.filter((h) => h.layers.some((l) => l.relationDefId === relationDefId)).map((h) => h.name);
}
