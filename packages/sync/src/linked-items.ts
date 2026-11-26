import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { itemVisible } from "./permissions.ts";
import { addRelation } from "./relations.ts";
import { zql } from "./schema.gen.ts";
import { createWorkItem } from "./work-items.ts";

export const createLinkedItemArgs = z.object({
  /** 新工作项的 id。 */
  id: z.string(),
  relationId: z.string(),
  relationDefId: z.string(),
  /** 已有的那个工作项。 */
  itemId: z.string(),
  /** 新工作项在关联的哪一端：to 是本端关联出去的，from 是对端字段（反向）。 */
  side: z.enum(["from", "to"]),
  name: z.string().trim().min(1, "工作项要有名称。").max(200),
  /** 把已有工作项上同键、同类型的字段值带过去。 */
  copyFields: z.boolean().optional(),
});

/** 选项类字段的值里出现的选项值。 */
function optionValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(optionValues);
  return [];
}

/**
 * 带过去的字段类型：值不依赖本空间的数据。人员、业务线、级联、公式、附件这类和空间配置、成员绑在一起的不带。
 */
const COPIED = new Set([
  "text",
  "textarea",
  "richText",
  "number",
  "bool",
  "date",
  "datetime",
  "dateRange",
  "select",
  "radio",
  "multiSelect",
  "link",
  "phone",
  "email",
]);

/**
 * 同步创建：在关联另一端的类型（跨空间关联就是在另一个空间）里新建一个工作项，并直接关联上。
 * 可以把已有工作项上同键、同类型的字段值带过去（选项类字段只带对方也有的选项）；
 * 关联建好后，这条关联上的字段同步规则照常把源字段同步过去。
 * 要能在对方空间新建工作项（成员、可编辑、类型的新建权限）。
 */
export async function createLinkedItem(tx: Transaction, args: z.output<typeof createLinkedItemArgs>, userID: string) {
  const def = await tx.run(zql.relationDef.where("id", args.relationDefId).one());
  const item = await tx.run(
    zql.workItem
      .where("id", args.itemId)
      .where(itemVisible(userID))
      .related("fieldValues")
      .related("type", (t) => t.related("fields"))
      .one(),
  );
  if (!def || !item) throw new Error("工作项不存在或没有权限。");
  const ownTypeId = args.side === "to" ? def.fromTypeId : def.toTypeId;
  if (item.typeId !== ownTypeId) throw new Error(`「${item.name}」不能使用关联「${def.name}」。`);
  const typeId = args.side === "to" ? def.toTypeId : def.fromTypeId;

  const fields: Record<string, unknown> = {};
  if (args.copyFields) {
    const targetFields = await tx.run(zql.fieldDef.where("typeId", typeId));
    const sourceFields = new Map((item.type?.fields ?? []).map((f) => [f.key, f]));
    for (const v of item.fieldValues) {
      const source = sourceFields.get(v.fieldKey);
      const target = targetFields.find((f) => f.key === v.fieldKey);
      if (!source || !target || source.dataType !== target.dataType || !COPIED.has(target.dataType)) continue;
      if (v.value === null || v.value === undefined) continue;
      if (["select", "radio", "multiSelect"].includes(target.dataType)) {
        const allowed = new Set((target.options ?? []).map((o) => o.value));
        if (!optionValues(v.value).every((o) => allowed.has(o))) continue;
      }
      fields[v.fieldKey] = v.value;
    }
  }

  const created = await createWorkItem(
    tx,
    { id: args.id, typeId, name: args.name, fields: fields as never, roles: {} },
    userID,
  );
  const [fromId, toId] = args.side === "to" ? [item.id, args.id] : [args.id, item.id];
  const linked = await addRelation(tx, { id: args.relationId, relationDefId: def.id, fromId, toId }, userID);
  return { created, typeId, fromId, toId, fromSpaceId: linked.spaceId, replaced: linked.replaced };
}
