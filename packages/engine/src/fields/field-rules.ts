/*
 * 字段规则：对照飞书项目字段配置的「数据规则」和表单项检查器。
 *
 * - 有效性：满足条件时字段才有效。无效的字段不显示、不必填、不套默认值，规则优先于下面几条。
 * - 条件显示：满足条件时才在表单和详情页显示。
 * - 必填：不必填 / 必填 / 满足条件时必填。只对显示出来的有效字段生效。
 * - 默认值：统一默认，或按条件默认（从上到下取第一个命中的，多值字段也可以取所有命中的并集），
 *   只在新建时套用，用户填了的不覆盖。
 * - 选项：可以禁用（不能再选，已选的保留），可以设满足条件才展示，多选里可以设排他（选它就不能选别的）。
 *
 * 条件都只看本工作项的字段值；一个字段的条件引用别的字段，前端在别的字段变化时重新求值。
 */

import { type Condition, conditionFields, evaluate, type Fields } from "../flow/condition.ts";
import {
  CASCADE_FIELD_TYPES,
  conditionValue,
  FIELD_GROUP_COLUMN_TYPES,
  type FieldDataType,
  type FieldGroupColumn,
  type FieldOption,
  type FieldSpec,
  MULTI_VALUE_FIELD_TYPES,
  type NumberFormat,
  OPTION_FIELD_TYPES,
} from "./field-value.ts";

/**
 * 条件里的「流程类型」：新建工作项时选的流程模板名。它不是字段，条件和默认值里写成这个键，
 * 求值时由新建的地方放进条件用的值里（对照飞书项目里「需求类型」当条件用）。
 */
export const TEMPLATE_CONDITION_KEY = "$template";
export const TEMPLATE_CONDITION_NAME = "流程类型";

export type DefaultValue =
  | { mode: "fixed"; value: unknown }
  | {
      mode: "conditional";
      rules: { when: Condition; value: unknown }[];
      /** first：取第一个命中的；union：多值字段取所有命中的并集。 */
      combine?: "first" | "union";
    };

/** 字段上除名称、类型、选项以外的配置，存在 field_def.config。 */
export interface FieldConfig {
  /** 帮助说明：字段名旁边的提示，可以带链接。 */
  description?: string | null;
  /** 对接标识：开放接口里引用这个字段的名字，同一类型内唯一。 */
  alias?: string | null;
  /** 有效性：为空时总是有效。 */
  validWhen?: Condition | null;
  /** 条件显示：为空时总是显示。 */
  showWhen?: Condition | null;
  /** 条件必填（字段的 required 为 false 时才看）。 */
  requiredWhen?: Condition | null;
  defaultValue?: DefaultValue | null;
  /** 单行文本：同一类型下不能和别的工作项重复。 */
  unique?: boolean | null;
  /** 数字格式。 */
  number?: NumberFormat | null;
  /** 级联字段：必须选到最后一级。 */
  leafOnly?: boolean | null;
  /** 选项按条件展示：选项值 → 条件。 */
  optionWhen?: Record<string, Condition> | null;
  /** 多选里的排他选项：选了它就只能选它。 */
  exclusiveOptions?: string[] | null;
  /** 公式字段：工作项完成后不再重算，保留完成时的结果。 */
  freezeOnComplete?: boolean | null;
  /** 字段组的列。 */
  columns?: FieldGroupColumn[] | null;
}

/** 规则求值需要的字段定义。 */
export interface RuleField extends FieldSpec {
  key: string;
  required?: boolean | null;
  config?: FieldConfig | null;
}

export interface FieldState {
  valid: boolean;
  visible: boolean;
  required: boolean;
}

/** 条件求值用的字段值：按字段键，值换成条件能比较的形式（见 conditionValue）。 */
export function conditionView(fields: readonly RuleField[], values: Fields): Fields {
  const view: Record<string, unknown> = { ...values };
  for (const f of fields) if (f.key in values) view[f.key] = conditionValue(f, values[f.key]);
  return view;
}

const holds = (condition: Condition | null | undefined, view: Fields) => !condition || evaluate(condition, view);

/** 一个字段此刻是否有效、是否显示、是否必填。 */
export function fieldState(field: RuleField, view: Fields): FieldState {
  const config = field.config ?? {};
  const valid = holds(config.validWhen, view);
  const visible = valid && holds(config.showWhen, view);
  const required =
    visible && (field.required === true || (!!config.requiredWhen && evaluate(config.requiredWhen, view)));
  return { valid, visible, required };
}

/** 所有字段的状态，按字段键。 */
export function fieldStates(fields: readonly RuleField[], values: Fields): Record<string, FieldState> {
  const view = conditionView(fields, values);
  return Object.fromEntries(fields.map((f) => [f.key, fieldState(f, view)]));
}

/** 此刻可以选的选项：去掉禁用的、条件不满足的；已经选了的总是保留，方便看到和取消。 */
export function availableOptions(field: RuleField, values: Fields, current: unknown = null): FieldOption[] {
  const view = conditionView([field], values);
  const chosen = new Set(
    (Array.isArray(current) ? current : current === null || current === undefined ? [] : [current]).map(String),
  );
  const when = field.config?.optionWhen ?? {};
  const shown = (field.options ?? []).filter((o) => chosen.has(o.value) || (!o.disabled && holds(when[o.value], view)));
  if (!CASCADE_FIELD_TYPES.includes(field.dataType)) return shown;
  // 级联：上级不在时，下级也不显示
  const values_ = new Set(shown.map((o) => o.value));
  return shown.filter((o) => !o.parent || values_.has(o.parent));
}

/** 多选的排他规则：新选了排他选项就只留它，选了别的就去掉排他选项。 */
export function applyExclusive(field: RuleField, before: readonly string[], after: readonly string[]): string[] {
  const exclusive = new Set(field.config?.exclusiveOptions ?? []);
  if (exclusive.size === 0) return [...after];
  const added = after.filter((v) => !before.includes(v));
  const newExclusive = added.find((v) => exclusive.has(v));
  if (newExclusive) return [newExclusive];
  if (added.length > 0) return after.filter((v) => !exclusive.has(v));
  return [...after];
}

/** 校验一组选中的值有没有违反排他规则。返回错误原因，没问题时返回 null。 */
export function exclusiveError(field: RuleField, value: unknown): string | null {
  const exclusive = new Set(field.config?.exclusiveOptions ?? []);
  if (!Array.isArray(value) || value.length < 2) return null;
  const hit = value.find((v) => exclusive.has(String(v)));
  if (!hit) return null;
  const label = field.options?.find((o) => o.value === hit)?.label ?? String(hit);
  return `「${field.name}」选了「${label}」就不能再选别的。`;
}

/**
 * 新建时的默认值：没填、有效的字段按默认值规则补上。按字段顺序逐个算，
 * 前面字段的默认值能被后面字段的条件用到。返回补上默认值之后的全部字段值。
 */
export function applyDefaults(fields: readonly RuleField[], values: Fields): Record<string, unknown> {
  const result: Record<string, unknown> = { ...values };
  // 一个字段的默认值可以按另一个字段（包括同样靠默认值填上的字段）来定，所以多走几遍直到不再有新填上的
  for (let pass = 0; pass < 5; pass++) {
    let filled = false;
    for (const field of fields) {
      const rule = field.config?.defaultValue;
      if (!rule || !isBlank(result[field.key])) continue;
      const view = conditionView(fields, result);
      if (!fieldState(field, view).valid) continue;
      const value = defaultOf(field, rule, view);
      if (!isBlank(value)) {
        result[field.key] = value;
        filled = true;
      }
    }
    if (!filled) break;
  }
  return result;
}

function defaultOf(field: RuleField, rule: DefaultValue, view: Fields): unknown {
  if (rule.mode === "fixed") return rule.value;
  const hits = rule.rules.filter((r) => evaluate(r.when, view));
  if (hits.length === 0) return null;
  if (rule.combine === "union" && MULTI_VALUE_FIELD_TYPES.includes(field.dataType)) {
    const all = hits.flatMap((r) => (Array.isArray(r.value) ? r.value : [r.value]));
    return [...new Set(all.map(String))];
  }
  return hits[0]?.value ?? null;
}

const isBlank = (value: unknown) =>
  value === null ||
  value === undefined ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

/** 必填但没填的字段（只看有效且显示的字段）。 */
export function missingRequired(fields: readonly RuleField[], values: Fields): RuleField[] {
  const states = fieldStates(fields, values);
  return fields.filter((f) => states[f.key]?.required && isBlank(values[f.key]));
}

/** 规则里用到的字段键：有效性、显示、必填、默认值、选项条件。 */
export function ruleFields(config: FieldConfig | null | undefined): string[] {
  if (!config) return [];
  const conditions: Condition[] = [
    ...(config.validWhen ? [config.validWhen] : []),
    ...(config.showWhen ? [config.showWhen] : []),
    ...(config.requiredWhen ? [config.requiredWhen] : []),
    ...(config.defaultValue?.mode === "conditional" ? config.defaultValue.rules.map((r) => r.when) : []),
    ...Object.values(config.optionWhen ?? {}),
  ];
  return [...new Set(conditions.flatMap(conditionFields))];
}

/**
 * 检查字段配置：条件引用的字段存在、不引用自己，选项条件和排他选项指向存在的选项，
 * 级联选项的上级存在且不成环。返回错误原因，没问题时返回 null。
 */
export function checkFieldConfig(
  field: { key: string; name: string; dataType: FieldDataType; options?: readonly FieldOption[] | null },
  config: FieldConfig,
  fieldKeys: readonly string[],
): string | null {
  const known = new Set(fieldKeys);
  for (const key of ruleFields(config)) {
    if (key === field.key) return `「${field.name}」的条件不能引用它自己。`;
    if (!known.has(key)) return `「${field.name}」的条件用到的字段「${key}」不存在。`;
  }
  const options = new Set((field.options ?? []).map((o) => o.value));
  const isOptions = OPTION_FIELD_TYPES.includes(field.dataType);
  for (const value of [...Object.keys(config.optionWhen ?? {}), ...(config.exclusiveOptions ?? [])])
    if (!isOptions || !options.has(value)) return `「${field.name}」没有选项「${value}」。`;
  if (config.exclusiveOptions?.length && field.dataType !== "multiSelect") return "只有多选字段能设排他选项。";
  if (config.unique && field.dataType !== "text") return "只有单行文本能校验重复值。";
  if (config.columns) {
    if (field.dataType !== "fieldGroup") return "只有字段组能设列。";
    const columnError = checkColumns(config.columns);
    if (columnError) return `「${field.name}」${columnError}`;
  }
  if (config.number && field.dataType !== "number") return "只有数字字段能设数字格式。";
  if (config.number?.precision !== undefined && (config.number.precision < 0 || config.number.precision > 10))
    return "小数位数要在 0 到 10 之间。";
  if (config.alias !== undefined && config.alias !== null && !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(config.alias))
    return "对接标识只能用英文字母、数字和下划线，不能以数字开头。";
  return null;
}

/** 检查字段组的列：至少一列，键和名称不重复，类型能用，选项列有选项。 */
export function checkColumns(columns: readonly FieldGroupColumn[]): string | null {
  if (columns.length === 0) return "至少要有一列。";
  if (columns.length > 30) return "最多 30 列。";
  const keys = new Set<string>();
  const names = new Set<string>();
  for (const c of columns) {
    if (!c.key || !c.name.trim()) return "的列要有名称。";
    if (keys.has(c.key) || names.has(c.name)) return `的列「${c.name}」重复了。`;
    keys.add(c.key);
    names.add(c.name);
    if (!(FIELD_GROUP_COLUMN_TYPES as readonly string[]).includes(c.dataType)) return `的列「${c.name}」类型不能用。`;
    if (OPTION_FIELD_TYPES.includes(c.dataType)) {
      if (!c.options?.length) return `的列「${c.name}」至少要有一个选项。`;
      const error = checkOptions(c.dataType, c.options);
      if (error) return `的列「${c.name}」${error}`;
    }
  }
  return null;
}

/** 检查选项：值不重复；级联选项的上级存在、不成环。返回错误原因，没问题时返回 null。 */
export function checkOptions(dataType: FieldDataType, options: readonly FieldOption[]): string | null {
  const values = new Set<string>();
  for (const o of options) {
    if (values.has(o.value)) return `选项「${o.label ?? o.value}」重复了。`;
    values.add(o.value);
  }
  const cascade = CASCADE_FIELD_TYPES.includes(dataType);
  const byValue = new Map(options.map((o) => [o.value, o]));
  for (const o of options) {
    if (!o.parent) continue;
    if (!cascade) return "只有级联字段的选项能有上级。";
    if (!byValue.has(o.parent)) return `选项「${o.label ?? o.value}」的上级不存在。`;
    const seen = new Set([o.value]);
    for (let p = byValue.get(o.parent); p; p = p.parent ? byValue.get(p.parent) : undefined) {
      if (seen.has(p.value)) return `选项「${o.label ?? o.value}」的上下级成环了。`;
      seen.add(p.value);
    }
  }
  return null;
}
