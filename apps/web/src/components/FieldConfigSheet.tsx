import { SideSheet } from "@douyinfe/semi-ui";
import {
  CASCADE_FIELD_TYPES,
  type Condition,
  type DefaultValue,
  FIELD_GROUP_COLUMN_TYPES,
  FIELD_TYPE_LABEL,
  type FieldDataType,
  type FieldGroupColumn,
  type FieldOption,
  type FieldConfig as FieldRules,
  MULTI_VALUE_FIELD_TYPES,
  type NumberFormat,
  OPTION_FIELD_TYPES,
  optionPath,
  SYSTEM_WRITTEN_FIELD_TYPES,
  TEMPLATE_CONDITION_KEY,
  TEMPLATE_CONDITION_NAME,
} from "@fp/engine";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ConditionEditor, type ConditionField } from "@/components/ConditionEditor";
import { FieldInput, type FieldInputValue, type FieldMember } from "@/components/FieldInput";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Label, Select, Textarea } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";

export interface ConfigurableField {
  id: string;
  key: string;
  name: string;
  dataType: string;
  required: boolean | null;
  options: readonly FieldOption[] | null;
  config: FieldRules | null;
}

/** 交给 fieldDef.update 的改动。 */
export interface FieldPatch {
  name: string;
  required: boolean;
  options?: (FieldOption & { label: string })[];
  config: FieldRules | null;
}

type RequiredMode = "none" | "always" | "conditional";
type DefaultMode = "none" | "fixed" | "conditional";

/** 选项的显示文字；级联选项带上上级路径。 */
const optionText = (options: readonly FieldOption[], o: FieldOption, cascade: boolean) =>
  cascade
    ? optionPath(options, o.value)
        .map((v) => options.find((x) => x.value === v)?.label || v)
        .join(" / ")
    : o.label || o.value;

/** 去掉配置里的空值，全空时返回 null。 */
function compact(config: FieldRules): FieldRules | null {
  const entries = Object.entries(config).filter(
    ([, v]) =>
      v !== undefined &&
      v !== null &&
      v !== "" &&
      v !== false &&
      !(Array.isArray(v) && v.length === 0) &&
      !(typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0),
  );
  return entries.length > 0 ? (Object.fromEntries(entries) as FieldRules) : null;
}

/**
 * 字段配置抽屉，对照飞书项目的字段配置：基础信息、选项、数据规则（有效性、显示、必填、默认值）和高级设置。
 * 改完点保存一次提交。
 */
export function FieldConfigSheet({
  field,
  fields,
  members,
  templates = [],
  canManage,
  onClose,
  onSave,
}: {
  field: ConfigurableField;
  fields: readonly ConfigurableField[];
  /** 这个工作项的流程模板名：条件里可以按流程类型判断。 */
  templates?: readonly string[];
  members: readonly FieldMember[];
  canManage: boolean;
  onClose: () => void;
  onSave: (patch: FieldPatch) => Promise<string | null>;
}) {
  const dataType = field.dataType as FieldDataType;
  const isOptions = OPTION_FIELD_TYPES.includes(dataType);
  const cascade = CASCADE_FIELD_TYPES.includes(dataType);
  const systemWritten = SYSTEM_WRITTEN_FIELD_TYPES.includes(dataType);
  const initial = field.config ?? {};

  const [name, setName] = useState(field.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [alias, setAlias] = useState(initial.alias ?? "");
  const [options, setOptions] = useState<FieldOption[]>([...(field.options ?? [])]);
  const [optionWhen, setOptionWhen] = useState<Record<string, Condition>>({ ...(initial.optionWhen ?? {}) });
  const [exclusive, setExclusive] = useState<string[]>([...(initial.exclusiveOptions ?? [])]);
  const [validWhen, setValidWhen] = useState<Condition | undefined>(initial.validWhen ?? undefined);
  const [showWhen, setShowWhen] = useState<Condition | undefined>(initial.showWhen ?? undefined);
  const [requiredMode, setRequiredMode] = useState<RequiredMode>(
    field.required ? "always" : initial.requiredWhen ? "conditional" : "none",
  );
  const [requiredWhen, setRequiredWhen] = useState<Condition | undefined>(initial.requiredWhen ?? undefined);
  const [defaultMode, setDefaultMode] = useState<DefaultMode>(initial.defaultValue?.mode ?? "none");
  const [fixedDefault, setFixedDefault] = useState<unknown>(
    initial.defaultValue?.mode === "fixed" ? initial.defaultValue.value : null,
  );
  const [rules, setRules] = useState<{ when: Condition | undefined; value: unknown }[]>(
    initial.defaultValue?.mode === "conditional" ? initial.defaultValue.rules : [],
  );
  const [combine, setCombine] = useState<"first" | "union">(
    initial.defaultValue?.mode === "conditional" ? (initial.defaultValue.combine ?? "first") : "first",
  );
  const [number, setNumber] = useState<NumberFormat>({ ...(initial.number ?? {}) });
  const [leafOnly, setLeafOnly] = useState(initial.leafOnly ?? false);
  const [unique, setUnique] = useState(initial.unique ?? false);
  const [freeze, setFreeze] = useState(initial.freezeOnComplete ?? false);
  const [columns, setColumns] = useState<FieldGroupColumn[]>([...(initial.columns ?? [])]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 条件只能引用别的字段；可以用来判断的字段和选项
  const conditionFields: ConditionField[] = fields
    .filter(
      (f) =>
        f.key !== field.key && f.dataType !== "richText" && f.dataType !== "attachment" && f.dataType !== "fieldGroup",
    )
    .map((f) => ({
      key: f.key,
      name: f.name,
      dataType: f.dataType,
      options: f.options?.map((o) => ({ value: o.value, label: o.label || o.value })) ?? null,
    }));
  if (templates.length > 1)
    conditionFields.push({
      key: TEMPLATE_CONDITION_KEY,
      name: TEMPLATE_CONDITION_NAME,
      dataType: "select",
      options: templates.map((t) => ({ value: t, label: t })),
    });
  // 默认值控件用的字段：选项用编辑中的选项
  const inputField = { key: field.key, name: field.name, dataType: field.dataType, options, config: null };
  const canDefault = !systemWritten && dataType !== "attachment" && dataType !== "fieldGroup";

  function buildDefault(): DefaultValue | null {
    if (defaultMode === "fixed")
      return fixedDefault === null || fixedDefault === undefined ? null : { mode: "fixed", value: fixedDefault };
    if (defaultMode === "conditional") {
      const complete = rules.filter((r): r is { when: Condition; value: unknown } => !!r.when);
      return complete.length > 0 ? { mode: "conditional", rules: complete, combine } : null;
    }
    return null;
  }

  async function save() {
    setSaving(true);
    setError(null);
    const values = new Set(options.map((o) => o.value));
    const config = compact({
      description: description.trim(),
      alias: alias.trim(),
      validWhen: validWhen ?? null,
      showWhen: showWhen ?? null,
      requiredWhen: requiredMode === "conditional" ? (requiredWhen ?? null) : null,
      defaultValue: canDefault ? buildDefault() : null,
      number: dataType === "number" && Object.values(number).some((v) => v !== undefined) ? number : null,
      leafOnly: cascade && leafOnly,
      unique: dataType === "text" && unique,
      freezeOnComplete: dataType === "formula" && freeze,
      optionWhen: isOptions
        ? compact(Object.fromEntries(Object.entries(optionWhen).filter(([v]) => values.has(v))) as FieldRules)
        : null,
      exclusiveOptions: dataType === "multiSelect" ? exclusive.filter((v) => values.has(v)) : null,
      columns:
        dataType === "fieldGroup"
          ? columns.map((c) => ({
              ...c,
              name: c.name.trim(),
              options: OPTION_FIELD_TYPES.includes(c.dataType) ? (c.options ?? []) : null,
            }))
          : null,
    } as FieldRules);
    const outcome = await onSave({
      name: name.trim(),
      required: requiredMode === "always",
      ...(isOptions && { options: options.map((o) => ({ ...o, label: o.label?.trim() || o.value })) }),
      config,
    });
    setSaving(false);
    if (outcome) setError(outcome);
    else onClose();
  }

  return (
    <SideSheet
      visible
      title={`字段配置 · ${field.name}`}
      width={560}
      onCancel={onClose}
      footer={
        canManage && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button onClick={save} disabled={saving || !name.trim()}>
              保存
            </Button>
          </div>
        )
      }
    >
      <fieldset disabled={!canManage} className="flex flex-col gap-5 pb-4">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        <Group title="基础信息">
          <Field label="字段名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <ReadOnly label="字段类型" value={FIELD_TYPE_LABEL[dataType] ?? field.dataType} />
            <ReadOnly label="字段 ID" value={field.key} />
          </div>
        </Group>

        {isOptions && (
          <Group title="选项">
            <OptionsEditor
              options={options}
              cascade={cascade}
              multi={dataType === "multiSelect"}
              exclusive={exclusive}
              optionWhen={optionWhen}
              conditionFields={conditionFields}
              onChange={setOptions}
              onExclusive={setExclusive}
              onOptionWhen={setOptionWhen}
            />
            {cascade && <CheckRow label="必须选到最后一级" checked={leafOnly} onChange={setLeafOnly} />}
          </Group>
        )}

        {dataType === "fieldGroup" && (
          <Group title="列">
            <ColumnsEditor columns={columns} onChange={setColumns} />
          </Group>
        )}

        {dataType === "number" && (
          <Group title="数字格式">
            <NumberFormatEditor value={number} onChange={setNumber} />
          </Group>
        )}

        <Group title="数据规则">
          <RuleBlock
            label="有效性"
            hint="无效时字段不显示、不必填、不套默认值，优先于下面几条规则。"
            mode={validWhen ? "conditional" : "always"}
            modes={[
              ["always", "默认有效"],
              ["conditional", "满足条件时有效"],
            ]}
            onMode={(m) =>
              setValidWhen(m === "conditional" ? (validWhen ?? emptyCondition(conditionFields)) : undefined)
            }
          >
            {validWhen && (
              <ConditionEditor label="有效条件" value={validWhen} fields={conditionFields} onChange={setValidWhen} />
            )}
          </RuleBlock>
          <RuleBlock
            label="显示"
            mode={showWhen ? "conditional" : "always"}
            modes={[
              ["always", "全部可见"],
              ["conditional", "满足条件时显示"],
            ]}
            onMode={(m) => setShowWhen(m === "conditional" ? (showWhen ?? emptyCondition(conditionFields)) : undefined)}
          >
            {showWhen && (
              <ConditionEditor label="显示条件" value={showWhen} fields={conditionFields} onChange={setShowWhen} />
            )}
          </RuleBlock>
          {!systemWritten && (
            <RuleBlock
              label="必填"
              mode={requiredMode}
              modes={[
                ["none", "非必填"],
                ["always", "必填"],
                ["conditional", "条件必填"],
              ]}
              onMode={(m) => {
                setRequiredMode(m as RequiredMode);
                if (m === "conditional" && !requiredWhen) setRequiredWhen(emptyCondition(conditionFields));
              }}
            >
              {requiredMode === "conditional" && (
                <ConditionEditor
                  label="必填条件"
                  value={requiredWhen}
                  fields={conditionFields}
                  onChange={setRequiredWhen}
                />
              )}
            </RuleBlock>
          )}
          {canDefault && (
            <RuleBlock
              label="默认值"
              hint="只在新建时套用，用户填了的不覆盖。"
              mode={defaultMode}
              modes={[
                ["none", "不设置"],
                ["fixed", "统一默认"],
                ["conditional", "按条件默认"],
              ]}
              onMode={(m) => setDefaultMode(m as DefaultMode)}
            >
              {defaultMode === "fixed" && (
                <FieldInput
                  field={inputField}
                  label="默认值"
                  value={fixedDefault}
                  members={members}
                  live
                  onChange={(v: FieldInputValue) => setFixedDefault(v)}
                />
              )}
              {defaultMode === "conditional" && (
                <div className="flex flex-col gap-3">
                  {MULTI_VALUE_FIELD_TYPES.includes(dataType) && (
                    <Label className="flex items-center gap-2">
                      命中多个条件时
                      <Select value={combine} onChange={(e) => setCombine(e.target.value as "first" | "union")}>
                        <option value="first">取第一个（从上到下）</option>
                        <option value="union">取并集</option>
                      </Select>
                    </Label>
                  )}
                  {rules.map((rule, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 条件组没有 id，按位置编辑
                    <div key={i} className="flex flex-col gap-2 rounded-md border border-line-subtle p-3">
                      <div className="flex items-center justify-between text-sm font-medium">
                        条件组 {i + 1}
                        <button
                          type="button"
                          aria-label={`删除条件组 ${i + 1}`}
                          className="text-fg-subtle hover:text-danger-600"
                          onClick={() => setRules(rules.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                      <ConditionEditor
                        label="满足"
                        value={rule.when}
                        fields={conditionFields}
                        onChange={(when) => setRules(rules.map((r, j) => (j === i ? { ...r, when } : r)))}
                      />
                      <Field label="默认为">
                        <FieldInput
                          field={inputField}
                          label={`条件组 ${i + 1} 的默认值`}
                          value={rule.value}
                          members={members}
                          live
                          onChange={(value: FieldInputValue) =>
                            setRules(rules.map((r, j) => (j === i ? { ...r, value } : r)))
                          }
                        />
                      </Field>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit"
                    onClick={() => setRules([...rules, { when: emptyCondition(conditionFields), value: null }])}
                  >
                    <Plus />
                    添加条件组
                  </Button>
                </div>
              )}
            </RuleBlock>
          )}
          {dataType === "text" && (
            <CheckRow label="校验重复值（同类型下不能重复）" checked={unique} onChange={setUnique} />
          )}
          {dataType === "formula" && (
            <CheckRow label="工作项完成后冻结结果（不再重算）" checked={freeze} onChange={setFreeze} />
          )}
        </Group>

        <Group title="高级设置">
          <Field label="对接标识" hint="开放接口里可以用它代替字段 ID，只能用英文字母、数字和下划线。">
            <Input value={alias} placeholder="如 filing_no" onChange={(e) => setAlias(e.target.value)} />
          </Field>
          <Field label="帮助说明" hint="显示在字段名旁边的提示。">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </Group>
      </fieldset>
    </SideSheet>
  );
}

function emptyCondition(fields: readonly ConditionField[]): Condition | undefined {
  const first = fields[0];
  return first ? { kind: "notEmpty", field: first.key } : undefined;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-fg-muted">{label}</span>
      <span className="truncate font-mono text-xs leading-8 text-fg">{value}</span>
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** 一条规则：标题、几种方式的分段选择，选了「条件」时下面出现条件编辑。 */
function RuleBlock({
  label,
  hint,
  mode,
  modes,
  onMode,
  children,
}: {
  label: string;
  hint?: string;
  mode: string;
  modes: readonly (readonly [string, string])[];
  onMode: (mode: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-line-subtle pb-3 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-fg-muted">{label}</span>
        <Segmented label={label} value={mode} onChange={onMode} items={modes} />
      </div>
      {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
      {children}
    </div>
  );
}

/** 选项列表：改名、调顺序、禁用、排他、按条件展示；级联选项选上级。 */
/** 字段组的列：名称、类型，选项列在下面编辑选项。列的键建好后不变，改名不影响已填的数据。 */
function ColumnsEditor({
  columns,
  onChange,
}: {
  columns: FieldGroupColumn[];
  onChange: (columns: FieldGroupColumn[]) => void;
}) {
  const update = (i: number, patch: Partial<FieldGroupColumn>) =>
    onChange(columns.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const nextKey = () => {
    let n = columns.length + 1;
    while (columns.some((c) => c.key === `列${n}`)) n++;
    return `列${n}`;
  };
  return (
    <div className="flex flex-col gap-3">
      {columns.map((c, i) => (
        <div key={c.key} className="flex flex-col gap-2 rounded border border-line p-2">
          <div className="flex items-center gap-2">
            <Input
              aria-label={`第 ${i + 1} 列名称`}
              value={c.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
            <Select
              aria-label={`第 ${i + 1} 列类型`}
              value={c.dataType}
              onChange={(e) => update(i, { dataType: e.target.value as FieldGroupColumn["dataType"] })}
            >
              {FIELD_GROUP_COLUMN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
            <button
              type="button"
              aria-label={`删除第 ${i + 1} 列`}
              disabled={columns.length <= 1}
              className="rounded p-1.5 text-fg-subtle hover:bg-canvas hover:text-danger-500 disabled:opacity-40"
              onClick={() => onChange(columns.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          {OPTION_FIELD_TYPES.includes(c.dataType) && (
            <OptionsEditor
              options={[...(c.options ?? [])]}
              cascade={CASCADE_FIELD_TYPES.includes(c.dataType)}
              multi={c.dataType === "multiSelect"}
              exclusive={[]}
              optionWhen={{}}
              conditionFields={[]}
              onChange={(options) => update(i, { options })}
              onExclusive={() => {}}
              onOptionWhen={() => {}}
            />
          )}
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={columns.length >= 30}
        onClick={() => {
          const key = nextKey();
          onChange([...columns, { key, name: key, dataType: "text" }]);
        }}
      >
        <Plus />
        添加列
      </Button>
    </div>
  );
}

function OptionsEditor({
  options,
  cascade,
  multi,
  exclusive,
  optionWhen,
  conditionFields,
  onChange,
  onExclusive,
  onOptionWhen,
}: {
  options: FieldOption[];
  cascade: boolean;
  multi: boolean;
  exclusive: string[];
  optionWhen: Record<string, Condition>;
  conditionFields: readonly ConditionField[];
  onChange: (options: FieldOption[]) => void;
  onExclusive: (values: string[]) => void;
  onOptionWhen: (when: Record<string, Condition>) => void;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const update = (i: number, patch: Partial<FieldOption>) =>
    onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const move = (i: number, by: number) => {
    const next = [...options];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i + by, 0, item);
    onChange(next);
  };
  function add() {
    // 级联可以一次写一条路径「华东/上海」，缺的上级一并建出来
    const parts = draft
      .split(cascade ? "/" : /\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...options];
    let parent: string | undefined;
    for (const part of cascade ? parts : parts.slice(0, 1)) {
      const found = next.find((o) => (o.label || o.value) === part && o.parent === parent);
      if (found) {
        parent = found.value;
        continue;
      }
      let value = part;
      for (let n = 2; next.some((o) => o.value === value); n++) value = `${part}-${n}`;
      next.push({ value, label: part, ...(parent && { parent }) });
      parent = value;
    }
    onChange(next);
    setDraft("");
  }
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label="选项列表" className="flex flex-col gap-1">
        {options.map((o, i) => (
          <li key={o.value} className="flex flex-col gap-1.5 rounded-md px-1 py-1 hover:bg-hover/50">
            <div className="flex items-center gap-1.5">
              <Input
                aria-label={`选项 ${o.label || o.value} 的名称`}
                value={o.label ?? ""}
                className="flex-1"
                onChange={(e) => update(i, { label: e.target.value })}
              />
              {cascade && (
                <Select
                  aria-label={`选项 ${o.label || o.value} 的上级`}
                  value={o.parent ?? ""}
                  className="w-40"
                  onChange={(e) => update(i, { parent: e.target.value || undefined })}
                >
                  <option value="">（第一级）</option>
                  {options
                    .filter((p) => p.value !== o.value && !optionPath(options, p.value).includes(o.value))
                    .map((p) => (
                      <option key={p.value} value={p.value}>
                        {optionText(options, p, true)}
                      </option>
                    ))}
                </Select>
              )}
              <IconButton label="上移" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp />
              </IconButton>
              <IconButton label="下移" disabled={i === options.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown />
              </IconButton>
              <IconButton
                label={`删除选项 ${o.label || o.value}`}
                onClick={() => onChange(options.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </IconButton>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-1 text-xs text-fg-muted">
              <label className="flex items-center gap-1">
                <Checkbox
                  checked={!!o.disabled}
                  onChange={(e) => update(i, { disabled: e.target.checked || undefined })}
                />
                禁用
              </label>
              {multi && (
                <label className="flex items-center gap-1">
                  <Checkbox
                    checked={exclusive.includes(o.value)}
                    onChange={(e) =>
                      onExclusive(e.target.checked ? [...exclusive, o.value] : exclusive.filter((v) => v !== o.value))
                    }
                  />
                  排他
                </label>
              )}
              <button
                type="button"
                className="text-brand-500 hover:underline"
                onClick={() => setOpen(open === o.value ? null : o.value)}
              >
                {optionWhen[o.value] ? "按条件展示（已设置）" : "按条件展示"}
              </button>
            </div>
            {open === o.value && (
              <div className="rounded-md border border-line-subtle p-2">
                <ConditionEditor
                  label={`满足条件时才展示「${o.label || o.value}」`}
                  value={optionWhen[o.value]}
                  fields={conditionFields}
                  onChange={(when) => {
                    const next = { ...optionWhen };
                    if (when) next[o.value] = when;
                    else delete next[o.value];
                    onOptionWhen(next);
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Input
          aria-label="新选项"
          value={draft}
          placeholder={cascade ? "新选项，可写路径：华东/上海" : "新选项"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="outline" onClick={add}>
          添加选项
        </Button>
      </div>
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className="flex size-7 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-hover hover:text-fg disabled:opacity-30 [&_svg]:size-3.5"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const SCALES: readonly (readonly [NonNullable<NumberFormat["scale"]>, string])[] = [
  ["raw", "原值"],
  ["percent", "百分比 %"],
  ["permille", "千分比 ‰"],
  ["thousand", "千"],
  ["tenThousand", "万"],
  ["million", "百万"],
];

function NumberFormatEditor({ value, onChange }: { value: NumberFormat; onChange: (v: NumberFormat) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="缩放">
        <Select
          value={value.scale ?? "raw"}
          onChange={(e) => onChange({ ...value, scale: e.target.value as NumberFormat["scale"] })}
        >
          {SCALES.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="小数位数">
        <Select
          value={value.precision === undefined ? "" : String(value.precision)}
          onChange={(e) => {
            const { precision: _, ...rest } = value;
            onChange(e.target.value === "" ? rest : { ...rest, precision: Number(e.target.value) });
          }}
        >
          <option value="">原样</option>
          {[0, 1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="符号">
        <Input
          value={value.symbol ?? ""}
          placeholder="如 ¥、件"
          onChange={(e) => onChange({ ...value, symbol: e.target.value || undefined })}
        />
      </Field>
      <Field label="符号位置">
        <Select
          value={value.symbolPosition ?? "before"}
          onChange={(e) => onChange({ ...value, symbolPosition: e.target.value as "before" | "after" })}
        >
          <option value="before">数字前</option>
          <option value="after">数字后</option>
        </Select>
      </Field>
      <label className="col-span-2 flex items-center gap-2 text-sm">
        <Checkbox
          checked={!!value.thousands}
          onChange={(e) => onChange({ ...value, thousands: e.target.checked || undefined })}
        />
        千分位分隔
      </label>
    </div>
  );
}
