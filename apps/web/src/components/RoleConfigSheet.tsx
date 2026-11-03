import { SideSheet } from "@douyinfe/semi-ui";
import type { Condition, FieldOption, RoleAssign, RoleConfig, RoleEditors } from "@fp/engine";
import { Plus, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ConditionEditor, type ConditionField } from "@/components/ConditionEditor";
import type { FieldMember } from "@/components/FieldInput";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Label, Select, Textarea } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface ConfigurableRole {
  id: string;
  key: string;
  name: string;
  config: RoleConfig | null;
}

type AppearMode = "default" | "hidden" | "conditional";
type AssignMode = RoleAssign["mode"];
type EditorsMode = RoleEditors["mode"];

/**
 * 角色配置抽屉，对照飞书项目的角色管理：出现方式、成员分配、负责人、单人、谁能改成员。
 */
export function RoleConfigSheet({
  role,
  roles,
  fields,
  members,
  canManage,
  onClose,
  onSave,
}: {
  role: ConfigurableRole;
  roles: readonly { key: string; name: string }[];
  fields: readonly { key: string; name: string; dataType: string; options: readonly FieldOption[] | null }[];
  members: readonly FieldMember[];
  canManage: boolean;
  onClose: () => void;
  onSave: (patch: { name: string; config: RoleConfig | null }) => Promise<string | null>;
}) {
  const c = role.config ?? {};
  const [name, setName] = useState(role.name);
  const [appear, setAppear] = useState<AppearMode>(c.appear?.mode ?? "default");
  const [appearWhen, setAppearWhen] = useState<Condition | undefined>(
    c.appear?.mode === "conditional" ? c.appear.when : undefined,
  );
  const [allowRemove, setAllowRemove] = useState(
    c.appear && c.appear.mode !== "hidden" ? c.appear.allowRemove !== false : true,
  );
  const [assign, setAssign] = useState<AssignMode>(c.assign?.mode ?? "creator");
  const [fixed, setFixed] = useState<string[]>(c.assign?.mode === "fixed" ? c.assign.members : []);
  const [rules, setRules] = useState<{ when: Condition | undefined; members: string[] }[]>(
    c.assign?.mode === "conditional" ? c.assign.rules : [],
  );
  const [combine, setCombine] = useState<"first" | "union">(
    c.assign?.mode === "conditional" ? (c.assign.combine ?? "first") : "first",
  );
  const [fallback, setFallback] = useState<string[]>(c.assign?.mode === "conditional" ? (c.assign.fallback ?? []) : []);
  const [single, setSingle] = useState(!!c.single);
  const [isOwner, setIsOwner] = useState(!!c.isOwner);
  const [editors, setEditors] = useState<EditorsMode>(c.editors?.mode ?? "anyone");
  const [editorRoles, setEditorRoles] = useState<string[]>(c.editors?.mode === "roles" ? c.editors.roles : []);
  const [description, setDescription] = useState(c.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const conditionFields: ConditionField[] = fields
    .filter((f) => !["richText", "attachment", "formula", "fieldGroup"].includes(f.dataType))
    .map((f) => ({
      key: f.key,
      name: f.name,
      dataType: f.dataType,
      options: f.options?.map((o) => ({ value: o.value, label: o.label || o.value })) ?? null,
    }));
  const firstCondition = (): Condition | undefined => {
    const first = conditionFields[0];
    return first ? { kind: "notEmpty", field: first.key } : undefined;
  };

  async function save() {
    setSaving(true);
    setError(null);
    const config: RoleConfig = {
      appear:
        appear === "default"
          ? allowRemove
            ? null
            : { mode: "default", allowRemove: false }
          : appear === "hidden"
            ? { mode: "hidden" }
            : appearWhen
              ? { mode: "conditional", when: appearWhen, ...(!allowRemove && { allowRemove: false }) }
              : null,
      assign:
        assign === "creator"
          ? null
          : assign === "manual"
            ? { mode: "manual" }
            : assign === "fixed"
              ? { mode: "fixed", members: fixed }
              : {
                  mode: "conditional",
                  rules: rules.filter((r): r is { when: Condition; members: string[] } => !!r.when),
                  combine,
                  ...(fallback.length > 0 && { fallback }),
                },
      single: single || null,
      isOwner: isOwner || null,
      editors:
        editors === "anyone" ? null : editors === "roles" ? { mode: "roles", roles: editorRoles } : { mode: editors },
      description: description.trim() || null,
    };
    const empty = Object.values(config).every((v) => v === null || v === undefined);
    const outcome = await onSave({ name: name.trim(), config: empty ? null : config });
    setSaving(false);
    if (outcome) setError(outcome);
    else onClose();
  }

  return (
    <SideSheet
      visible
      title={`角色配置 · ${role.name}`}
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
          <Field label="角色名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-fg-muted">角色 ID</span>
            <span className="font-mono text-xs">{role.key}</span>
          </div>
          <Check label="是否为负责人（可以删除、终止工作项，增删角色）" checked={isOwner} onChange={setIsOwner} />
          <Check label="限制为单人" checked={single} onChange={setSingle} />
        </Group>

        <Group title="出现方式">
          <Segmented
            label="出现方式"
            value={appear}
            onChange={(m) => {
              setAppear(m);
              if (m === "conditional" && !appearWhen) setAppearWhen(firstCondition());
            }}
            items={[
              ["default", "默认出现"],
              ["hidden", "默认隐藏"],
              ["conditional", "满足条件出现"],
            ]}
          />
          <p className="text-xs text-fg-subtle">
            {appear === "hidden"
              ? "工作项上默认没有这个角色，需要时在角色区「添加角色」。"
              : "用户手动增删后，这个工作项上的角色不再跟着规则变。"}
          </p>
          {appear === "conditional" && (
            <ConditionEditor label="出现条件" value={appearWhen} fields={conditionFields} onChange={setAppearWhen} />
          )}
          {appear !== "hidden" && (
            <Check label="允许用户删除这个角色" checked={allowRemove} onChange={setAllowRemove} />
          )}
        </Group>

        <Group title="成员分配">
          <Segmented
            label="成员分配"
            value={assign}
            onChange={(m) => {
              setAssign(m);
              if (m === "conditional" && rules.length === 0) setRules([{ when: firstCondition(), members: [] }]);
            }}
            items={[
              ["creator", "创建者"],
              ["manual", "自行添加"],
              ["fixed", "全部默认分配"],
              ["conditional", "按条件默认分配"],
            ]}
          />
          {assign === "fixed" && (
            <Field label="默认成员">
              <MemberChips label="默认成员" members={members} value={fixed} onChange={setFixed} />
            </Field>
          )}
          {assign === "conditional" && (
            <div className="flex flex-col gap-3">
              <Label className="flex items-center gap-2">
                命中多个条件组时
                <Select value={combine} onChange={(e) => setCombine(e.target.value as "first" | "union")}>
                  <option value="first">取第一个（从上到下）</option>
                  <option value="union">取并集</option>
                </Select>
              </Label>
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
                  <Field label="默认成员">
                    <MemberChips
                      label={`条件组 ${i + 1} 的成员`}
                      members={members}
                      value={rule.members}
                      onChange={(m) => setRules(rules.map((r, j) => (j === i ? { ...r, members: m } : r)))}
                    />
                  </Field>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="w-fit"
                onClick={() => setRules([...rules, { when: firstCondition(), members: [] }])}
              >
                <Plus />
                添加条件组
              </Button>
              <Field label="未命中任何条件组时">
                <MemberChips label="兜底成员" members={members} value={fallback} onChange={setFallback} />
              </Field>
            </div>
          )}
        </Group>

        <Group title="谁能修改成员">
          <Segmented
            label="谁能修改成员"
            value={editors}
            onChange={setEditors}
            items={[
              ["anyone", "任何人"],
              ["admin", "空间管理员"],
              ["creator", "创建人"],
              ["roles", "指定角色"],
            ]}
          />
          {editors === "roles" && (
            <div className="flex flex-wrap gap-1.5">
              {roles.map((r) => {
                const on = editorRoles.includes(r.key);
                return (
                  <button
                    key={r.key}
                    type="button"
                    aria-pressed={on}
                    className={cn(
                      "h-6 rounded-full border px-2.5 text-xs",
                      on ? "border-brand-500 bg-brand-50 text-brand-500" : "border-line text-fg-muted hover:bg-hover",
                    )}
                    onClick={() =>
                      setEditorRoles(on ? editorRoles.filter((k) => k !== r.key) : [...editorRoles, r.key])
                    }
                  >
                    {r.name}
                  </button>
                );
              })}
            </div>
          )}
        </Group>

        <Group title="说明">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Group>
      </fieldset>
    </SideSheet>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** 选成员：已选的人显示成可以点掉的标签，下拉里加人。 */
function MemberChips({
  label,
  members,
  value,
  onChange,
}: {
  label: string;
  members: readonly FieldMember[];
  value: readonly string[];
  onChange: (value: string[]) => void;
}) {
  const name = (id: string) => members.find((m) => m.userId === id)?.name ?? id;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => (
        <span key={id} className="inline-flex h-6 items-center gap-1 rounded-full bg-hover px-2 text-xs">
          {name(id)}
          <button
            type="button"
            aria-label={`移除 ${name(id)}`}
            className="text-fg-subtle hover:text-danger-600"
            onClick={() => onChange(value.filter((v) => v !== id))}
          >
            ×
          </button>
        </span>
      ))}
      <Select
        aria-label={`给${label}加人`}
        value=""
        className="w-36"
        onChange={(e) => e.target.value && onChange([...value, e.target.value])}
      >
        <option value="">加人…</option>
        {members
          .filter((m) => !value.includes(m.userId))
          .map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
      </Select>
    </div>
  );
}
