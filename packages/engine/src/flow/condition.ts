/** 工作项的字段值，按字段键索引。 */
export type Fields = Readonly<Record<string, unknown>>;

/** 对工作项字段求值的条件，用于节点出现条件和卡点。可序列化为 JSON 存进流程定义。 */
export type Condition =
  /** 等于；多值字段（多选、人员）表示包含这个值。 */
  | { kind: "equal"; field: string; value: string | number | boolean }
  /** 不等于；空值也算不等于，多值字段表示不包含这个值。 */
  | { kind: "notEqual"; field: string; value: string | number | boolean }
  | { kind: "notEmpty"; field: string }
  /** 大小比较，用于数字和日期（YYYY-MM-DD 按字符串比较即按日期先后）。 */
  | { kind: "compare"; field: string; op: CompareOp; value: number | string }
  | { kind: "all"; items: Condition[] }
  | { kind: "any"; items: Condition[] };

export type CompareOp = "gt" | "gte" | "lt" | "lte";

export const cond = {
  equal: (field: string, value: string | number | boolean): Condition => ({ kind: "equal", field, value }),
  notEqual: (field: string, value: string | number | boolean): Condition => ({ kind: "notEqual", field, value }),
  notEmpty: (field: string): Condition => ({ kind: "notEmpty", field }),
  compare: (field: string, op: CompareOp, value: number | string): Condition => ({ kind: "compare", field, op, value }),
  all: (...items: Condition[]): Condition => ({ kind: "all", items }),
  any: (...items: Condition[]): Condition => ({ kind: "any", items }),
};

export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** 数字按数值比较，日期（YYYY-MM-DD）按字符串比较；空值和多值不满足任何比较。 */
function compare(actual: unknown, op: CompareOp, expected: number | string): boolean {
  if (isEmpty(actual) || Array.isArray(actual)) return false;
  const a = typeof expected === "number" ? Number(actual) : String(actual);
  if (typeof a === "number" && Number.isNaN(a)) return false;
  switch (op) {
    case "gt":
      return a > expected;
    case "gte":
      return a >= expected;
    case "lt":
      return a < expected;
    case "lte":
      return a <= expected;
  }
}

export function evaluate(condition: Condition, fields: Fields): boolean {
  switch (condition.kind) {
    case "equal": {
      const actual = fields[condition.field];
      if (Array.isArray(actual)) return actual.some((v) => String(v) === String(condition.value));
      return actual !== null && actual !== undefined && String(actual) === String(condition.value);
    }
    case "notEqual":
      return !evaluate({ kind: "equal", field: condition.field, value: condition.value }, fields);
    case "compare":
      return compare(fields[condition.field], condition.op, condition.value);
    case "notEmpty":
      return !isEmpty(fields[condition.field]);
    case "all":
      return condition.items.every((c) => evaluate(c, fields));
    case "any":
      return condition.items.some((c) => evaluate(c, fields));
  }
}

/** 条件里用到的字段键。 */
export function conditionFields(condition: Condition): string[] {
  return condition.kind === "all" || condition.kind === "any"
    ? condition.items.flatMap(conditionFields)
    : [condition.field];
}
