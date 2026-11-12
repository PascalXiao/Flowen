/**
 * 跨空间关联：关联定义的另一端可能是别的空间的工作项类型。
 * 空间查询（spaces.byId）里，本空间类型出发的关联带着 toType，别的空间指向本空间的关联在 incomingRelationDefs 里、带着 fromType。
 * 这里把它们合在一起，并把别的空间的类型补成和本空间类型一样的形状，按类型找名称、字段、流程的地方不用区分。
 */

interface ForeignTypeLike {
  id: string;
  name: string;
  spaceId: string;
  space?: { id: string; name: string } | null | undefined;
  fields: readonly ForeignField[];
  flowTemplates: readonly { currentVersion?: { definition: unknown } | null | undefined }[];
}
interface ForeignField {
  key: string;
  name: string;
  dataType: string;
  options: readonly { value: string; label: string }[] | null;
  formula?: unknown;
}

/** 关联定义（两个方向通用的部分）。 */
export interface RelDef {
  id: string;
  spaceId: string;
  toSpaceId: string;
  fromTypeId: string;
  toTypeId: string;
  name: string;
  reverseName: string | null;
  cardinality: "one" | "many";
  reverseCardinality: "one" | "many" | null;
}

interface SpaceWithRelations {
  id: string;
  workItemTypes: readonly {
    id: string;
    relationDefs: readonly (RelDef & { toType?: ForeignTypeLike | null | undefined })[];
  }[];
  incomingRelationDefs?: readonly (RelDef & { fromType?: ForeignTypeLike | null | undefined })[];
}

/** 空间里能用的全部关联定义：本空间类型出发的，加上别的空间指向本空间类型的。 */
export function spaceRelationDefs(space: SpaceWithRelations): RelDef[] {
  return [...space.workItemTypes.flatMap((t) => t.relationDefs), ...(space.incomingRelationDefs ?? [])];
}

/** 是不是跨空间关联。 */
export const isCrossSpace = (d: Pick<RelDef, "spaceId" | "toSpaceId">) => d.spaceId !== d.toSpaceId;

/** 别的空间的类型，补成本空间类型的形状：名称前面带空间名，没有角色；relationDefs 是它指向本空间的关联。 */
export type ForeignType = ForeignTypeLike & {
  foreign: true;
  roles: readonly { key: string; name: string }[];
  relationDefs: readonly RelDef[];
};

/** 关联另一端在别的空间的类型。 */
export function foreignTypes(space: SpaceWithRelations): ForeignType[] {
  const out = new Map<string, ForeignType>();
  const add = (t: ForeignTypeLike | null | undefined) => {
    if (!t || t.spaceId === space.id || out.has(t.id)) return;
    out.set(t.id, {
      ...t,
      name: t.space ? `${t.space.name} / ${t.name}` : t.name,
      foreign: true,
      roles: [],
      relationDefs: [],
    });
  };
  for (const t of space.workItemTypes) for (const d of t.relationDefs) add(d.toType);
  for (const d of space.incomingRelationDefs ?? []) {
    add(d.fromType);
    const t = out.get(d.fromTypeId);
    if (t) t.relationDefs = [...t.relationDefs, d];
  }
  return [...out.values()];
}
