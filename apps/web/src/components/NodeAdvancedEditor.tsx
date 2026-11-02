import type {
  ConclusionOption,
  Condition,
  FlowDefinition,
  NodeButton,
  NodeDefinition,
  NodeEventAction,
  NodeFieldDefinition,
} from "@fp/engine";
import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { ConditionEditor, type ConditionField } from "@/components/ConditionEditor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/input";
import { newId } from "@/lib/utils";

type NodeData = Omit<NodeDefinition, "position">;
type TypeField = {
  key: string;
  name: string;
  dataType: string;
  options: readonly { value: string; label: string }[] | null;
};

const NODE_STATE_OPTIONS = [
  { value: "notStarted", label: "未开始" },
  { value: "inProgress", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "skipped", label: "已跳过" },
];

/** 条件里能用的「字段」：工作项字段，加上每个节点的状态和完成结论（状态计算规则、卡点用）。 */
export function flowConditionFields(definition: FlowDefinition, fields: readonly TypeField[]): ConditionField[] {
  return [
    ...fields.map((f) => ({ key: f.key, name: f.name, dataType: f.dataType, options: f.options })),
    ...definition.nodes.map((n) => ({
      key: `$node.${n.key}`,
      name: `节点状态：${n.name}`,
      dataType: "select",
      options: NODE_STATE_OPTIONS,
    })),
    ...definition.nodes
      .filter((n) => n.conclusion)
      .map((n) => ({
        key: `$conclusion.${n.key}`,
        name: `完成结论：${n.name}`,
        dataType: "select",
        options: n.conclusion?.options.map((o) => ({ value: o.value, label: o.label })) ?? [],
      })),
  ];
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <details className="rounded-md border border-line-subtle bg-surface px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium select-none">{title}</summary>
      <div className="flex flex-col gap-2 pt-2">
        {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
        {children}
      </div>
    </details>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-sm">
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/**
 * 节点的高级配置，对照飞书项目节点配置：里程碑、限制节点、相对排期、完成结论、自定义按钮、节点字段、
 * 到达 / 完成事件。
 */
export function NodeAdvancedEditor({
  data,
  fields,
  roles,
  onChange,
}: {
  data: NodeData;
  fields: readonly TypeField[];
  roles: readonly { key: string; name: string }[];
  onChange: (patch: Partial<NodeData>) => void;
}) {
  const dateFields = fields.filter((f) => f.dataType === "date" || f.dataType === "dateRange");
  const writable = fields.filter(
    (f) => !["formula", "relation", "signal", "multiSignal", "attachment", "fieldGroup"].includes(f.dataType),
  );
  const conclusion = data.conclusion;
  return (
    <div className="flex flex-col gap-2">
      <Section title="节点设置">
        <Check
          label="里程碑（只有截止日期，不占工期）"
          checked={!!data.milestone}
          onChange={(v) => onChange({ milestone: v || undefined })}
        />
        <Check
          label="限制节点（只有空间管理员能完成）"
          checked={!!data.restricted}
          onChange={(v) => onChange({ restricted: v || undefined })}
        />
        {/* 节点下的子工作项：类型 + 关联，可选排期联动 */}
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-muted">节点下的子工作项</span>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="子工作项类型"
              placeholder="类型名"
              className="h-8 w-32"
              value={data.subItems?.type ?? ""}
              onChange={(e) =>
                onChange({
                  subItems:
                    e.target.value || data.subItems?.relation
                      ? { ...data.subItems, type: e.target.value, relation: data.subItems?.relation ?? "" }
                      : undefined,
                })
              }
            />
            <Input
              aria-label="子工作项关联"
              placeholder="关联名"
              className="h-8 w-40"
              value={data.subItems?.relation ?? ""}
              onChange={(e) =>
                onChange({
                  subItems:
                    e.target.value || data.subItems?.type
                      ? { ...data.subItems, type: data.subItems?.type ?? "", relation: e.target.value }
                      : undefined,
                })
              }
            />
          </div>
          {data.subItems && (
            <Check
              label="排期联动（节点排期按子工作项的排期范围更新）"
              checked={!!data.subItems.scheduleLinked}
              onChange={(v) =>
                data.subItems && onChange({ subItems: { ...data.subItems, scheduleLinked: v || undefined } })
              }
            />
          )}
        </div>
        {/* 估分、实际工时、完成时排期必填 */}
        {(() => {
          const effort = data.effort ?? {};
          const set = (patch: Partial<NonNullable<typeof data.effort>>) => {
            const next = { ...effort, ...patch };
            for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
            onChange({ effort: Object.keys(next).length > 0 ? next : undefined });
          };
          return (
            <>
              <Check label="显示估分" checked={!!effort.points} onChange={(v) => set({ points: v || undefined })} />
              <Check
                label="显示实际工时"
                checked={!!effort.hours}
                onChange={(v) => set({ hours: v ? "show" : undefined })}
              />
              {effort.hours && (
                <Check
                  label="完成时实际工时必填"
                  checked={effort.hours === "required"}
                  onChange={(v) => set({ hours: v ? "required" : "show" })}
                />
              )}
              <Check
                label="完成时负责人必填"
                checked={!!effort.ownersRequired}
                onChange={(v) => set({ ownersRequired: v || undefined })}
              />
              <Check
                label="完成时排期必填"
                checked={!!effort.scheduleRequired}
                onChange={(v) => set({ scheduleRequired: v || undefined })}
              />
            </>
          );
        })()}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          相对排期：结束日为
          <Select
            aria-label="相对排期的基准字段"
            value={data.schedule?.field ?? ""}
            className="w-36"
            onChange={(e) =>
              onChange({
                schedule: e.target.value ? { field: e.target.value, offset: data.schedule?.offset ?? 0 } : undefined,
              })
            }
          >
            <option value="">不设置</option>
            {dateFields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </Select>
          {data.schedule && (
            <>
              往后
              <Input
                aria-label="相对排期偏移的工作日"
                type="number"
                className="w-20"
                value={String(data.schedule.offset)}
                onChange={(e) =>
                  onChange({ schedule: { field: data.schedule?.field ?? "", offset: Number(e.target.value) || 0 } })
                }
              />
              个工作日（负数往前推）
            </>
          )}
        </div>
      </Section>

      <Section
        title={`完成结论${conclusion ? `（${conclusion.options.length} 个选项）` : ""}`}
        hint="完成节点时选的结论，如已通过 / 未通过；流程图上按结论显示，状态计算规则和卡点也能判断。"
      >
        {!conclusion ? (
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() =>
              onChange({
                conclusion: {
                  options: [
                    { value: "pass", label: "已通过", passed: true },
                    { value: "fail", label: "未通过", passed: false },
                  ],
                  required: true,
                },
              })
            }
          >
            启用完成结论
          </Button>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {conclusion.options.map((o, i) => {
                const set = (patch: Partial<ConclusionOption>) =>
                  onChange({
                    conclusion: {
                      ...conclusion,
                      options: conclusion.options.map((x, j) => (j === i ? { ...x, ...patch } : x)),
                    },
                  });
                return (
                  <li key={o.value} className="flex items-center gap-2">
                    <Input
                      aria-label={`结论 ${o.label}`}
                      value={o.label}
                      className="flex-1"
                      onChange={(e) => set({ label: e.target.value })}
                    />
                    <label className="flex items-center gap-1 text-xs text-fg-muted">
                      <Checkbox checked={o.passed !== false} onChange={(e) => set({ passed: e.target.checked })} />
                      算通过
                    </label>
                    <button
                      type="button"
                      aria-label={`删除结论 ${o.label}`}
                      className="text-fg-subtle hover:text-danger-600"
                      onClick={() =>
                        onChange({
                          conclusion: { ...conclusion, options: conclusion.options.filter((_, j) => j !== i) },
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={() =>
                onChange({
                  conclusion: {
                    ...conclusion,
                    options: [
                      ...conclusion.options,
                      { value: `c-${newId().slice(0, 6)}`, label: "新结论", passed: true },
                    ],
                  },
                })
              }
            >
              <Plus />
              添加结论选项
            </Button>
            <Check
              label="必须选结论"
              checked={!!conclusion.required}
              onChange={(v) => onChange({ conclusion: { ...conclusion, required: v || undefined } })}
            />
            <Check
              label="必须填意见"
              checked={!!conclusion.commentRequired}
              onChange={(v) => onChange({ conclusion: { ...conclusion, commentRequired: v || undefined } })}
            />
            <Check
              label="每位负责人各自填结论，再汇总"
              checked={!!conclusion.perOwner}
              onChange={(v) => onChange({ conclusion: { ...conclusion, perOwner: v || undefined } })}
            />
            {conclusion.perOwner && (
              <Select
                aria-label="结论汇总方式"
                value={conclusion.aggregate ?? "majority"}
                onChange={(e) =>
                  onChange({ conclusion: { ...conclusion, aggregate: e.target.value as "majority" | "veto" } })
                }
              >
                <option value="majority">少数服从多数</option>
                <option value="veto">一票否决（有人不通过就不通过）</option>
              </Select>
            )}
            <Button variant="link" size="sm" className="w-fit" onClick={() => onChange({ conclusion: undefined })}>
              不用完成结论
            </Button>
          </>
        )}
      </Section>

      <Section
        title={`自定义按钮${data.buttons?.length ? `（${data.buttons.length}）` : ""}`}
        hint="节点卡片上除「确认完成」外的按钮：可以带着结论完成节点，或只改字段值。"
      >
        {(data.buttons ?? []).map((b, i) => (
          <ButtonEditor
            key={b.key}
            button={b}
            conclusions={conclusion?.options ?? []}
            fields={writable}
            roles={roles}
            onChange={(next) => onChange({ buttons: (data.buttons ?? []).map((x, j) => (j === i ? next : x)) })}
            onRemove={() => {
              const rest = (data.buttons ?? []).filter((_, j) => j !== i);
              onChange({ buttons: rest.length ? rest : undefined });
            }}
          />
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() =>
            onChange({
              buttons: [
                ...(data.buttons ?? []),
                { key: `b-${newId().slice(0, 6)}`, label: "新按钮", action: "complete", style: "default" },
              ],
            })
          }
        >
          <Plus />
          添加按钮
        </Button>
      </Section>

      <Section
        title={`节点字段${data.fields?.length ? `（${data.fields.length}）` : ""}`}
        hint="只属于这个节点的字段，填在节点卡片上，值记在节点上（不是工作项字段）。"
      >
        {(data.fields ?? []).map((f, i) => (
          <NodeFieldEditor
            key={f.key}
            field={f}
            onChange={(next) => onChange({ fields: (data.fields ?? []).map((x, j) => (j === i ? next : x)) })}
            onRemove={() => {
              const rest = (data.fields ?? []).filter((_, j) => j !== i);
              onChange({ fields: rest.length ? rest : undefined });
            }}
          />
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() =>
            onChange({
              fields: [
                ...(data.fields ?? []),
                { key: `nf-${newId().slice(0, 6)}`, name: "节点字段", dataType: "text" },
              ],
            })
          }
        >
          <Plus />
          添加节点字段
        </Button>
      </Section>

      <EventsEditor
        title="到达时"
        value={data.onArrive ?? []}
        fields={writable}
        onChange={(onArrive) => onChange({ onArrive: onArrive.length ? onArrive : undefined })}
      />
      <EventsEditor
        title="完成时"
        value={data.onComplete ?? []}
        fields={writable}
        onChange={(onComplete) => onChange({ onComplete: onComplete.length ? onComplete : undefined })}
      />
    </div>
  );
}

const valueText = (v: unknown) => (Array.isArray(v) ? v.join("，") : v === null || v === undefined ? "" : String(v));
/** 字段值输入：按字段类型把文本转成值（多选用逗号分隔，开关用 是/否）。 */
function parseValue(field: TypeField | undefined, text: string): string | number | boolean | string[] | null {
  if (text.trim() === "") return null;
  if (!field) return text;
  if (field.dataType === "number") return Number(text);
  if (field.dataType === "bool") return text === "true" || text === "是";
  if (["multiSelect", "user", "cascadeMulti"].includes(field.dataType))
    return text
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean);
  return text;
}

function ValueInput({
  field,
  value,
  label,
  onChange,
}: {
  field: TypeField | undefined;
  value: unknown;
  label: string;
  onChange: (v: string | number | boolean | string[] | null) => void;
}) {
  if (field?.dataType === "bool")
    return (
      <Select
        aria-label={label}
        value={valueText(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}
      >
        <option value="">清空</option>
        <option value="true">是</option>
        <option value="false">否</option>
      </Select>
    );
  if (field?.options?.length && ["select", "radio"].includes(field.dataType))
    return (
      <Select aria-label={label} value={valueText(value)} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">清空</option>
        {field.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    );
  return (
    <Input
      aria-label={label}
      value={valueText(value)}
      placeholder="值（多个用逗号分隔）"
      onChange={(e) => onChange(parseValue(field, e.target.value))}
    />
  );
}

function ButtonEditor({
  button,
  conclusions,
  fields,
  roles,
  onChange,
  onRemove,
}: {
  button: NodeButton;
  conclusions: readonly ConclusionOption[];
  fields: readonly TypeField[];
  roles: readonly { key: string; name: string }[];
  onChange: (b: NodeButton) => void;
  onRemove: () => void;
}) {
  const assignments = button.assignments ?? [];
  return (
    <div className="flex flex-col gap-2 rounded-md bg-canvas p-2">
      <div className="flex items-center gap-2">
        <Input
          aria-label="按钮名称"
          value={button.label}
          className="flex-1"
          onChange={(e) => onChange({ ...button, label: e.target.value })}
        />
        <Select
          aria-label={`${button.label} 的样式`}
          value={button.style ?? "default"}
          onChange={(e) => onChange({ ...button, style: e.target.value as NodeButton["style"] })}
        >
          <option value="primary">主按钮</option>
          <option value="default">普通</option>
          <option value="warning">警告</option>
        </Select>
        <button
          type="button"
          aria-label={`删除按钮 ${button.label}`}
          className="text-fg-subtle hover:text-danger-600"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Select
          aria-label={`${button.label} 的操作`}
          value={button.action}
          onChange={(e) => onChange({ ...button, action: e.target.value as NodeButton["action"] })}
        >
          <option value="complete">完成节点</option>
          <option value="assign">只改字段值</option>
        </Select>
        {button.action === "complete" && conclusions.length > 0 && (
          <Select
            aria-label={`${button.label} 的结论`}
            value={button.conclusion ?? ""}
            onChange={(e) => {
              const { conclusion: _, ...rest } = button;
              onChange(e.target.value ? { ...rest, conclusion: e.target.value } : rest);
            }}
          >
            <option value="">不带结论</option>
            {conclusions.map((c) => (
              <option key={c.value} value={c.value}>
                结论：{c.label}
              </option>
            ))}
          </Select>
        )}
      </div>
      {assignments.map((a, i) => (
        <div key={`${a.field}-${i}`} className="flex items-center gap-2">
          <Select
            aria-label="改哪个字段"
            value={a.field}
            className="w-36"
            onChange={(e) =>
              onChange({
                ...button,
                assignments: assignments.map((x, j) => (j === i ? { field: e.target.value, value: null } : x)),
              })
            }
          >
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </Select>
          <span className="text-sm text-fg-muted">设为</span>
          <ValueInput
            field={fields.find((f) => f.key === a.field)}
            value={a.value}
            label="字段值"
            onChange={(value) =>
              onChange({ ...button, assignments: assignments.map((x, j) => (j === i ? { ...x, value } : x)) })
            }
          />
          <button
            type="button"
            aria-label="删除这个赋值"
            className="text-fg-subtle hover:text-danger-600"
            onClick={() => {
              const rest = assignments.filter((_, j) => j !== i);
              const { assignments: _, ...base } = button;
              onChange(rest.length ? { ...base, assignments: rest } : base);
            }}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      {fields[0] && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() =>
            onChange({ ...button, assignments: [...assignments, { field: fields[0]?.key ?? "", value: null }] })
          }
        >
          <Plus />
          按下时改字段
        </Button>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
        谁能按（不选时节点负责人能按）：
        {roles.map((r) => {
          const on = button.roles?.includes(r.key) ?? false;
          return (
            <label key={r.key} className="flex items-center gap-1">
              <Checkbox
                checked={on}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...(button.roles ?? []), r.key]
                    : (button.roles ?? []).filter((k) => k !== r.key);
                  const { roles: _, ...rest } = button;
                  onChange(next.length ? { ...rest, roles: next } : rest);
                }}
              />
              {r.name}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function NodeFieldEditor({
  field,
  onChange,
  onRemove,
}: {
  field: NodeFieldDefinition;
  onChange: (f: NodeFieldDefinition) => void;
  onRemove: () => void;
}) {
  const hasOptions = field.dataType === "select" || field.dataType === "multiSelect";
  return (
    <div className="flex flex-col gap-2 rounded-md bg-canvas p-2">
      <div className="flex items-center gap-2">
        <Input
          aria-label="节点字段名称"
          value={field.name}
          className="flex-1"
          onChange={(e) => onChange({ ...field, name: e.target.value })}
        />
        <Select
          aria-label={`${field.name} 的类型`}
          value={field.dataType}
          onChange={(e) => onChange({ ...field, dataType: e.target.value as NodeFieldDefinition["dataType"] })}
        >
          <option value="text">文本</option>
          <option value="number">数字</option>
          <option value="date">日期</option>
          <option value="select">单选</option>
          <option value="multiSelect">多选</option>
        </Select>
        <button
          type="button"
          aria-label={`删除节点字段 ${field.name}`}
          className="text-fg-subtle hover:text-danger-600"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {hasOptions && (
        <Input
          aria-label={`${field.name} 的选项`}
          placeholder="选项，逗号分隔"
          value={(field.options ?? []).map((o) => o.label).join("，")}
          onChange={(e) =>
            onChange({
              ...field,
              options: e.target.value
                .split(/[,，、]/)
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => ({ value: s, label: s })),
            })
          }
        />
      )}
      <Check
        label="完成节点前必填"
        checked={!!field.required}
        onChange={(v) => onChange({ ...field, required: v || undefined })}
      />
    </div>
  );
}

function EventsEditor({
  title,
  value,
  fields,
  onChange,
}: {
  title: string;
  value: NodeEventAction[];
  fields: readonly TypeField[];
  onChange: (value: NodeEventAction[]) => void;
}) {
  return (
    <Section
      title={`节点${title}${value.length ? `（${value.length}）` : ""}`}
      hint={`节点${title}自动做的事：改工作项状态、改字段值。`}
    >
      {value.map((a, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 动作没有 id，按位置编辑
        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
          {a.kind === "setStage" ? (
            <>
              状态改为
              <Input
                aria-label={`${title}改成的状态`}
                className="w-32"
                value={a.stage}
                onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...a, stage: e.target.value } : x)))}
              />
              <Input
                aria-label={`${title}只在这些状态下改`}
                className="w-48"
                placeholder="只在这些状态下改（逗号分隔，可空）"
                value={(a.onlyFrom ?? []).join("，")}
                onChange={(e) => {
                  const onlyFrom = e.target.value
                    .split(/[,，、]/)
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const { onlyFrom: _, ...rest } = a;
                  onChange(value.map((x, j) => (j === i ? (onlyFrom.length ? { ...rest, onlyFrom } : rest) : x)));
                }}
              />
            </>
          ) : (
            <>
              把
              <Select
                aria-label={`${title}改哪个字段`}
                value={a.field}
                className="w-36"
                onChange={(e) =>
                  onChange(
                    value.map((x, j) => (j === i ? { kind: "setField", field: e.target.value, value: null } : x)),
                  )
                }
              >
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </Select>
              设为
              <ValueInput
                field={fields.find((f) => f.key === a.field)}
                value={a.value}
                label={`${title}字段的值`}
                onChange={(v) => onChange(value.map((x, j) => (j === i ? { ...a, value: v } : x)))}
              />
            </>
          )}
          <button
            type="button"
            aria-label="删除这个动作"
            className="text-fg-subtle hover:text-danger-600"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => onChange([...value, { kind: "setStage", stage: "" }])}>
          <Plus />
          改状态
        </Button>
        {fields[0] && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange([...value, { kind: "setField", field: fields[0]?.key ?? "", value: null }])}
          >
            <Plus />
            改字段
          </Button>
        )}
      </div>
    </Section>
  );
}

/** 状态计算规则：从上到下第一个满足的条件组决定工作项状态。 */
export function StageRulesEditor({
  value,
  conditionFields,
  readOnly,
  onChange,
}: {
  value: { when: Condition; stage: string }[];
  conditionFields: ConditionField[];
  readOnly: boolean;
  onChange: (rules: { when: Condition; stage: string }[]) => void;
}) {
  return (
    <fieldset disabled={readOnly} className="flex flex-col gap-2 text-sm">
      <p className="text-xs text-fg-subtle">
        从上到下第一个满足的条件组决定工作项的状态（阶段）；都不满足时按节点事件。条件可以用字段、节点状态和完成结论。
      </p>
      {value.map((rule, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 规则没有 id，按位置编辑
        <div key={i} className="flex flex-col gap-2 rounded-md border border-line-subtle p-2">
          <div className="flex items-center gap-2">
            状态为
            <Input
              aria-label={`规则 ${i + 1} 的状态`}
              className="w-36"
              value={rule.stage}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, stage: e.target.value } : x)))}
            />
            <span className="flex-1" />
            <button
              type="button"
              aria-label={`删除规则 ${i + 1}`}
              className="text-fg-subtle hover:text-danger-600"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <ConditionEditor
            label={`规则 ${i + 1}：满足`}
            value={rule.when}
            fields={conditionFields}
            onChange={(when) => when && onChange(value.map((x, j) => (j === i ? { ...x, when } : x)))}
          />
        </div>
      ))}
      {conditionFields[0] && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() =>
            onChange([...value, { when: { kind: "notEmpty", field: conditionFields[0]?.key ?? "" }, stage: "" }])
          }
        >
          <Plus />
          添加规则
        </Button>
      )}
    </fieldset>
  );
}
