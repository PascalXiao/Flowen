import { type CompareOp, type Condition, SIGNAL_STATE_LABEL, SIGNAL_STATES } from "@fp/engine";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

/** 条件里能用的字段。 */
export interface ConditionField {
  key: string;
  name: string;
  options: readonly { value: string; label?: string }[] | null;
  dataType?: string;
}

type Simple = Extract<Condition, { kind: "equal" | "notEqual" | "notEmpty" | "compare" }>;
const isSimple = (c: Condition): c is Simple =>
  c.kind === "equal" || c.kind === "notEqual" || c.kind === "notEmpty" || c.kind === "compare";

/** 判断方式：下拉里的值 → 条件。比较类只对数字、日期字段出现。 */
const COMPARE_LABEL: Record<CompareOp, string> = { gt: "大于", gte: "大于等于", lt: "小于", lte: "小于等于" };
const ordered = (field: ConditionField | undefined) =>
  ["number", "date", "datetime", "dateRange"].includes(field?.dataType ?? "");
/** 「等于」对这些字段表示「包含」（级联字段选上级时，下级也算）。 */
const contains = (field: ConditionField | undefined) =>
  ["multiSelect", "user", "cascadeSelect", "cascadeMulti", "businessLine", "attachment", "multiSignal"].includes(
    field?.dataType ?? "",
  );
const choices = (field: ConditionField | undefined): ConditionField["options"] =>
  field?.dataType === "bool"
    ? [
        { value: "true", label: "是" },
        { value: "false", label: "否" },
      ]
    : field?.dataType === "signal" || field?.dataType === "multiSignal"
      ? SIGNAL_STATES.map((s) => ({ value: s, label: SIGNAL_STATE_LABEL[s] }))
      : (field?.options ?? null);

/** 新条件或换了字段时的默认值。 */
function initial(field: ConditionField | undefined, key: string): Simple {
  const first = choices(field)?.[0]?.value;
  if (first !== undefined)
    return { kind: "equal", field: key, value: field?.dataType === "bool" ? first === "true" : first };
  return { kind: "notEmpty", field: key };
}

/** 把条件拆成“全部满足/任一满足 + 一组简单条件”；嵌套的复杂条件返回 null，界面上只读。 */
function flatten(condition: Condition | undefined): { mode: "all" | "any"; items: Simple[] } | null {
  if (!condition) return { mode: "all", items: [] };
  if (isSimple(condition)) return { mode: "all", items: [condition] };
  if (condition.items.every(isSimple)) return { mode: condition.kind, items: condition.items as Simple[] };
  return null;
}

function combine(mode: "all" | "any", items: Simple[]): Condition | undefined {
  if (items.length === 0) return undefined;
  if (items.length === 1) return items[0];
  return { kind: mode, items };
}

export function ConditionEditor({
  label,
  value,
  fields,
  onChange,
}: {
  label: string;
  value: Condition | undefined;
  fields: readonly ConditionField[];
  onChange: (condition: Condition | undefined) => void;
}) {
  const flat = flatten(value);
  if (!flat)
    return (
      <div className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-fg">{label}</span>
        <code className="rounded bg-canvas p-2 text-xs">{JSON.stringify(value)}</code>
        <Button variant="outline" size="sm" onClick={() => onChange(undefined)}>
          清除复杂条件
        </Button>
      </div>
    );
  const { mode, items } = flat;
  const set = (next: Simple[], nextMode = mode) => onChange(combine(nextMode, next));
  const firstField = fields[0];

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium text-fg">{label}</legend>
      {items.length > 1 && (
        <Select
          aria-label={`${label}的组合方式`}
          value={mode}
          onChange={(e) => set(items, e.target.value as "all" | "any")}
        >
          <option value="all">全部满足</option>
          <option value="any">任一满足</option>
        </Select>
      )}
      {items.map((item, i) => {
        const field = fields.find((f) => f.key === item.field);
        const update = (patch: Simple) => set(items.map((x, j) => (j === i ? patch : x)));
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 条件没有自己的 id，按位置编辑
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <Select
              aria-label="字段"
              value={item.field}
              onChange={(e) =>
                update(
                  initial(
                    fields.find((f) => f.key === e.target.value),
                    e.target.value,
                  ),
                )
              }
            >
              {!field && <option value={item.field}>{item.field}（不存在）</option>}
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="判断"
              value={item.kind === "compare" ? item.op : item.kind}
              onChange={(e) => {
                const op = e.target.value;
                if (op === "notEmpty") return update({ kind: "notEmpty", field: item.field });
                const value =
                  item.kind === "notEmpty" ? (initial(field, item.field) as { value?: unknown }).value : item.value;
                if (op === "equal" || op === "notEqual")
                  return update({
                    kind: op,
                    field: item.field,
                    value: (value ?? "") as string | number | boolean,
                  });
                update({
                  kind: "compare",
                  field: item.field,
                  op: op as CompareOp,
                  value: field?.dataType === "number" ? Number(value) || 0 : String(value ?? ""),
                });
              }}
            >
              <option value="equal">{contains(field) ? "包含" : "等于"}</option>
              <option value="notEqual">{contains(field) ? "不包含" : "不等于"}</option>
              {ordered(field) &&
                Object.entries(COMPARE_LABEL).map(([op, text]) => (
                  <option key={op} value={op}>
                    {text}
                  </option>
                ))}
              <option value="notEmpty">不为空</option>
            </Select>
            {item.kind !== "notEmpty" &&
              (choices(field) ? (
                <Select
                  aria-label="值"
                  value={String(item.value)}
                  onChange={(e) =>
                    update({
                      ...item,
                      value: field?.dataType === "bool" ? e.target.value === "true" : e.target.value,
                    } as Simple)
                  }
                >
                  {choices(field)?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label || o.value}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  aria-label="值"
                  type={
                    field?.dataType === "number"
                      ? "number"
                      : field?.dataType === "date" || field?.dataType === "dateRange"
                        ? "date"
                        : "text"
                  }
                  className="h-8 w-36"
                  value={String(item.value)}
                  onChange={(e) =>
                    update({
                      ...item,
                      value: field?.dataType === "number" ? Number(e.target.value) : e.target.value,
                    } as Simple)
                  }
                />
              ))}
            <button
              type="button"
              aria-label="删除条件"
              className="px-1 text-fg-subtle hover:text-danger-600"
              onClick={() => set(items.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        );
      })}
      {firstField && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => set([...items, initial(firstField, firstField.key)])}>
            + 添加条件
          </Button>
        </div>
      )}
    </fieldset>
  );
}
