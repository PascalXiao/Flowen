import { businessLineOptions, type FieldOption } from "@fp/engine";

/**
 * 给字段补上运行时的选项：「业务线」字段的选项是空间的业务线树。
 * 字段控件、条件编辑、规则求值都要用到选项，从查询拿到字段后先过这里。
 */
export function withLineOptions<F extends { dataType: string; options: readonly FieldOption[] | null }>(
  fields: readonly F[],
  lines: readonly { id: string; name: string; parentId: string | null; disabled: boolean | null }[] | undefined,
): F[] {
  if (!fields.some((f) => f.dataType === "businessLine")) return [...fields];
  const options = businessLineOptions(lines ?? []);
  return fields.map((f) => (f.dataType === "businessLine" ? { ...f, options } : f));
}
