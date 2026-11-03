import {
  businessLineOptions,
  exclusiveError,
  type FieldDataType,
  fieldIndex,
  normalizeFieldValue,
  type RuleField,
} from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { assertSpaceMembers } from "./access.ts";
import { zql } from "./schema.gen.ts";

/** 类型上的字段定义；字段不存在时抛错。 */
export async function fieldDefOf(tx: Transaction, typeId: string, fieldKey: string) {
  const field = await tx.run(zql.fieldDef.where("typeId", typeId).where("key", fieldKey).one());
  if (!field) throw new Error(`字段「${fieldKey}」不存在。`);
  return field;
}

/**
 * 按字段规则检查一个已经整理好的值：多选的排他选项、单行文本的重复值校验、
 * 人员字段只能选空间成员、附件字段只能放这个工作项、这个字段上传的附件。
 */
export async function checkFieldValue(
  tx: Transaction,
  item: { id: string; typeId: string; spaceId: string },
  field: RuleField,
  value: unknown,
) {
  if (value === null) return;
  const exclusive = exclusiveError(field, value);
  if (exclusive) throw new Error(exclusive);
  if (field.dataType === "user" || field.dataType === "singleUser")
    await assertSpaceMembers(
      tx,
      item.spaceId,
      (Array.isArray(value) ? value : [value]).map(String),
      `「${field.name}」只能选空间成员。`,
    );
  if (field.dataType === "attachment" && Array.isArray(value)) {
    const files = await tx.run(
      zql.attachment.where("workItemId", item.id).where("fieldKey", field.key).where("id", "IN", value.map(String)),
    );
    if (files.length !== value.length) throw new Error(`「${field.name}」里有不属于这个字段的附件。`);
  }
  if (field.config?.unique && field.dataType === "text") {
    const same = await tx.run(
      zql.fieldValue
        .where("fieldKey", field.key)
        .where("str", String(value))
        .where("workItemId", "!=", item.id)
        .whereExists("workItem", (w) => w.where("typeId", item.typeId)),
    );
    if (same.length > 0) throw new Error(`「${field.name}」不能和别的工作项重复，「${String(value)}」已经被用了。`);
  }
}

/**
 * 写一个字段值：按字段类型校验并整理成规范形式，再按字段规则检查（见 checkFieldValue），
 * 同时维护检索列（num、str 和 field_value_item），列表筛选靠它们。返回旧值和写入的值。
 */
export async function writeFieldValue(
  tx: Transaction,
  item: { id: string; typeId: string; spaceId: string },
  fieldKey: string,
  input: unknown,
): Promise<{ from: unknown; to: unknown; created: boolean }> {
  const [field] = await withRuntimeOptions(tx, item.spaceId, [await fieldDefOf(tx, item.typeId, fieldKey)]);
  if (!field) throw new Error(`字段「${fieldKey}」不存在。`);
  const value = normalizeFieldValue(field, input);
  await checkFieldValue(tx, item, field, value);
  return storeFieldValue(tx, item.id, field, value);
}

/** 写入已经整理好的值，并维护检索列。公式字段的计算结果也走这里，记上计算时间。 */
export async function storeFieldValue(
  tx: Transaction,
  workItemId: string,
  field: { key: string; name: string; dataType: FieldDataType },
  value: unknown,
): Promise<{ from: unknown; to: unknown; created: boolean }> {
  const fieldKey = field.key;
  const before = await tx.run(zql.fieldValue.where("workItemId", workItemId).where("fieldKey", fieldKey).one());
  const index = fieldIndex(field, value);
  const now = Date.now();
  await tx.mutate.fieldValue.upsert({
    workItemId,
    fieldKey,
    value,
    num: index.num,
    str: index.str,
    ...(field.dataType === "formula" && { computedAt: now }),
    updatedAt: now,
  });
  const existing = await tx.run(zql.fieldValueItem.where("workItemId", workItemId).where("fieldKey", fieldKey));
  for (const row of existing)
    if (!index.items.includes(row.item))
      await tx.mutate.fieldValueItem.delete({ workItemId, fieldKey, item: row.item });
  for (const v of index.items)
    if (!existing.some((row) => row.item === v))
      await tx.mutate.fieldValueItem.upsert({ workItemId, fieldKey, item: v });
  return { from: before?.value ?? null, to: value, created: !before };
}

/**
 * 给字段定义补上运行时的选项：「业务线」字段的选项是空间的业务线树。
 * 校验、检索、条件求值都要用到选项，凡是从数据库读出字段定义拿去用的地方都先过这里。
 */
export async function withRuntimeOptions<F extends { dataType: string; options: unknown }>(
  tx: Transaction,
  spaceId: string,
  fields: readonly F[],
): Promise<F[]> {
  if (!fields.some((f) => f.dataType === "businessLine")) return [...fields];
  const lines = await tx.run(zql.businessLine.where("spaceId", spaceId).orderBy("sort", "asc"));
  const options = businessLineOptions(lines);
  return fields.map((f) => (f.dataType === "businessLine" ? { ...f, options } : f));
}
