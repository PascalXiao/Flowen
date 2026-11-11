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

/** 从某个类型往下一层能走的路：沿自定义关系的两个方向，或者子工作项关系到任意类型。 */
export interface HierarchyStep {
  typeId: string;
  relationDefId: string | null;
  reverse: boolean;
}

export function nextSteps(
  typeId: string,
  defs: readonly RelationDefLike[],
  typeIds: readonly string[],
): HierarchyStep[] {
  const steps: HierarchyStep[] = [];
  for (const d of defs) {
    if (d.fromTypeId === typeId) steps.push({ typeId: d.toTypeId, relationDefId: d.id, reverse: false });
    // 同类型的关系正反两个方向是一样的，只留正向
    if (d.toTypeId === typeId && d.fromTypeId !== d.toTypeId)
      steps.push({ typeId: d.fromTypeId, relationDefId: d.id, reverse: true });
  }
  for (const t of typeIds) steps.push({ typeId: t, relationDefId: null, reverse: false });
  return steps;
}

/** 检查每一层都能从上一层走到；返回第一个问题，没有问题时返回 null。 */
export function checkLayers(
  rootTypeId: string,
  layers: readonly HierarchyLayerArgs[],
  defs: readonly RelationDefLike[],
  typeIds: readonly string[],
): string | null {
  if (!typeIds.includes(rootTypeId)) return "第一层的工作项类型不存在。";
  let parent = rootTypeId;
  for (const [i, layer] of layers.entries()) {
    const ok = nextSteps(parent, defs, typeIds).some(
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

async function spaceConfig(tx: Transaction, spaceId: string) {
  const types = await tx.run(zql.workItemType.where("spaceId", spaceId));
  const defs = await tx.run(zql.relationDef.where("spaceId", spaceId));
  return { typeIds: types.map((t) => t.id), defs };
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
  const { typeIds, defs } = await spaceConfig(tx, args.spaceId);
  const problem = checkLayers(args.rootTypeId, args.layers, defs, typeIds);
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
    const { typeIds, defs } = await spaceConfig(tx, current.spaceId);
    const problem = checkLayers(current.rootTypeId, args.layers, defs, typeIds);
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

/** 删关系前看有没有层级在用它。 */
export async function hierarchiesUsing(tx: Transaction, spaceId: string, relationDefId: string) {
  const all = await tx.run(zql.hierarchy.where("spaceId", spaceId));
  return all.filter((h) => h.layers.some((l) => l.relationDefId === relationDefId)).map((h) => h.name);
}
