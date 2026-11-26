import {
  applyDefaults,
  availableOptions,
  conditionView,
  defaultRoleMembers,
  evaluate,
  fieldStates,
  type LayoutItem,
  missingRequired,
  resolveLayout,
  roleAppears,
  roleRemovable,
  TEMPLATE_CONDITION_KEY,
} from "@fp/engine";
import { mutators, queries } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useNavigate } from "@tanstack/react-router";
import { FileClock, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { FieldInput, type FieldInputValue, FieldLabel } from "@/components/FieldInput";
import { type PickerMember, RolePicker, toggled } from "@/components/RolePicker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toast } from "@/components/ui/toast";
import { withLineOptions } from "@/lib/fields";
import { newId } from "@/lib/utils";

type Space = NonNullable<QueryResultType<ReturnType<typeof queries.spaces.byId>>>;
type ItemType = Space["workItemTypes"][number];
type Draft = QueryResultType<ReturnType<typeof queries.drafts.mine>>[number];

/** 新建表单的个人偏好（简洁模式、简洁模式下额外显示的字段），存在本机，按工作项类型分开。 */
function usePref<T>(key: string, initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  return [
    value,
    (next) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
    },
  ];
}

function draftTime(at: number) {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

type Lines = Space["businessLines"];

/** 新建工作项：选类型（有已发布流程的才可选）、填名称和选项字段、按角色选人；草稿箱里能接着填之前没建完的。 */
export function CreateWorkItem({
  types,
  members,
  lines,
  label,
  title,
}: {
  types: ItemType[];
  members: PickerMember[];
  lines: Lines;
  label: string;
  title?: string;
}) {
  const zero = useZero();
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const type = types.find((t) => t.id === typeId) ?? types[0];
  const [drafts] = useQuery(queries.drafts.mine({ typeId: type?.id ?? "" }));
  // 正在填的草稿；换一份草稿时表单整个重建
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formKey, setFormKey] = useState(0);
  if (!type) return null;
  const openDraft = (d: Draft | null) => {
    setDraft(d);
    setFormKey((k) => k + 1);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) openDraft(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={title ?? label} className="max-w-2xl">
        <div className="flex flex-col gap-4">
          <div className="-mt-2 flex items-center justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="草稿箱"
                className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-fg-muted text-sm hover:bg-hover hover:text-fg [&_svg]:size-3.5"
              >
                <FileClock />
                草稿箱{drafts.length > 0 ? ` ${drafts.length}` : ""}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>我的{type.name}草稿</DropdownMenuLabel>
                {drafts.length === 0 && (
                  <p className="px-2 py-1.5 text-fg-subtle text-sm">还没有草稿。填过的内容会自动存进来。</p>
                )}
                {drafts.map((d) => (
                  <DropdownMenuItem key={d.id} onSelect={() => openDraft(d)}>
                    <span className={d.name ? "min-w-0 flex-1 truncate" : "min-w-0 flex-1 truncate text-fg-subtle"}>
                      {d.name || "未命名"}
                    </span>
                    {draft?.id === d.id && <span className="text-accent text-xs">正在编辑</span>}
                    <span className="text-fg-subtle text-xs tabular-nums">{draftTime(d.updatedAt ?? 0)}</span>
                    <button
                      type="button"
                      aria-label={`删除草稿${d.name || "未命名"}`}
                      className="rounded p-0.5 text-fg-subtle hover:bg-pressed hover:text-danger-600 [&_svg]:size-3.5"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        zero.mutate(mutators.draft.delete({ id: d.id }));
                        if (draft?.id === d.id) openDraft(null);
                      }}
                    >
                      <Trash2 />
                    </button>
                  </DropdownMenuItem>
                ))}
                {draft && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => openDraft(null)}>
                      <Plus />
                      空白新建
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {types.length > 1 && (
            <Field label="类型">
              <Select
                value={type.id}
                onChange={(e) => {
                  setTypeId(e.target.value);
                  openDraft(null);
                }}
              >
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <CreateWorkItemForm
            key={`${type.id}/${formKey}`}
            type={type}
            members={members}
            lines={lines}
            draft={draft?.typeId === type.id ? draft : null}
            onCancel={() => setOpen(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateWorkItemForm({
  type,
  members,
  lines,
  draft,
  onCancel,
}: {
  type: ItemType;
  members: PickerMember[];
  lines: Lines;
  /** 从草稿箱打开的草稿：表单从它的内容开始。 */
  draft: Draft | null;
  onCancel: () => void;
}) {
  const typeFields = withLineOptions(type.fields, lines);
  const zero = useZero();
  const navigate = useNavigate();
  const [name, setName] = useState(draft?.name ?? "");
  const [keepCreating, setKeepCreating] = useState(false);
  // 一个类型有多套已发布的流程（如标准、快速、变更）时，新建时选用哪套
  const flows = type.flowTemplates.filter((t) => t.currentVersionId);
  const draftFlow = flows.find((t) => t.id === draft?.data.flowTemplateId)?.id;
  const [templateId, setTemplateId] = useState(draftFlow ?? flows[0]?.id ?? "");
  // 用户动过的字段；没动过的字段按默认值规则补上（条件默认值随别的字段变化）
  const [touched, setTouched] = useState<Record<string, FieldInputValue>>(
    (draft?.data.fields as Record<string, FieldInputValue> | undefined) ?? {},
  );
  // 简洁模式：只显示必填字段，外加自己勾选要显示的字段（存在本机）
  const [simple, setSimple] = usePref(`fl.create.simple.${type.id}`, false);
  const [extra, setExtra] = usePref<string[]>(`fl.create.simpleExtra.${type.id}`, []);
  const [error, setError] = useState<string | null>(null);
  // 选的流程类型（流程模板名）也能当条件用
  const templateCondition = { [TEMPLATE_CONDITION_KEY]: flows.find((t) => t.id === templateId)?.name ?? "" };
  const { [TEMPLATE_CONDITION_KEY]: _template, ...defaulted } = applyDefaults(typeFields, {
    ...Object.fromEntries(Object.entries(touched).filter(([, v]) => v !== null)),
    ...templateCondition,
  });
  const fields: Record<string, unknown> = { ...defaulted, ...touched };
  const states = fieldStates(typeFields, { ...fields, ...templateCondition });
  // 角色：按出现规则和分配方式算默认成员（随字段变化），用户改过的角色以用户的为准
  const me = String(zero.userID);
  const [touchedRoles, setTouchedRoles] = useState<Record<string, string[]>>(draft?.data.roles ?? {});
  const [overrides, setOverrides] = useState<{ added: string[]; removed: string[] }>(
    draft?.data.roleOverrides ?? { added: [], removed: [] },
  );
  const view = conditionView(typeFields, { ...fields, ...templateCondition });
  const shownRoles = type.roles.filter((r) => roleAppears(r, view, overrides));
  const assigned = Object.fromEntries(
    shownRoles.map((r) => [r.key, touchedRoles[r.key] ?? defaultRoleMembers(r, view, me)]),
  );
  // 新建时可以直接填的字段（公式字段由系统计算），按详情页布局的顺序，布局里隐藏的不显示
  // 系统外信号由外部系统写入，附件要先有工作项才能上传，都不在新建表单里；按规则不显示的也不显示
  // 按新建页布局：字段（布局可以改显示名、加说明、设显示条件）和提示文字
  type CreateRow = { item: LayoutItem; field: (typeof typeFields)[number] | undefined };
  const createItems = resolveLayout(typeFields, type.detailLayout).create.flatMap((item): CreateRow[] => {
    if (item.kind === "text") return [{ item, field: undefined }];
    if (item.kind !== "field") return [];
    const field = typeFields.find((f) => f.key === item.field);
    if (!field || ["formula", "relation", "signal", "multiSignal", "vote", "multiPerson"].includes(field.dataType))
      return [];
    if (states[field.key]?.visible === false || (item.showWhen && !evaluate(item.showWhen, view))) return [];
    return [{ item, field }];
  });
  // 简洁模式下：必填的、自己勾了要显示的、已经填了值的（比如从草稿来的）照常显示，其余收起
  const filled = (key: string) => {
    const v = touched[key];
    return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
  };
  const optional = createItems.filter(({ field: f }) => f && !states[f.key]?.required);
  const shownItems = simple
    ? createItems.filter(({ field: f }) => f && (states[f.key]?.required || extra.includes(f.key) || filled(f.key)))
    : createItems;

  // 草稿：填过内容后自动存进草稿箱（停手 1.5 秒后），创建成功后删掉
  const [draftId, setDraftId] = useState(draft?.id ?? newId());
  const [savedAt, setSavedAt] = useState<number | null>(draft?.updatedAt ?? null);
  const hasContent = name.trim() !== "" || Object.values(touched).some((v) => v !== null && v !== "");
  const snapshot = JSON.stringify({ name, templateId, touched, touchedRoles, overrides });
  const lastSaved = useRef(draft ? snapshot : "");
  function saveDraft() {
    lastSaved.current = snapshot;
    zero.mutate(
      mutators.draft.save({
        id: draftId,
        typeId: type.id,
        name: name.trim(),
        data: {
          ...(templateId && { flowTemplateId: templateId }),
          fields: touched,
          roles: touchedRoles,
          roleOverrides: overrides,
        },
      }),
    );
    setSavedAt(Date.now());
  }
  const save = useRef(saveDraft);
  save.current = saveDraft;
  useEffect(() => {
    if (!hasContent || snapshot === lastSaved.current) return;
    const timer = setTimeout(() => save.current(), 1500);
    return () => clearTimeout(timer);
  }, [snapshot, hasContent]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!name.trim()) return;
    const missing = missingRequired(
      typeFields.filter((f) => f.dataType !== "attachment"),
      fields,
    );
    if (missing.length > 0) return setError(`请填写必填字段：${missing.map((f) => f.name).join("、")}。`);
    const id = newId();
    // 只交可见（有效且显示）字段的值，被规则藏起来的字段不带
    const values = Object.fromEntries(
      Object.entries(fields).filter(
        ([k, v]) => states[k]?.visible !== false && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0),
      ),
    );
    setError(null);
    const outcome = await zero.mutate(
      mutators.workItem.create({
        id,
        typeId: type.id,
        name: name.trim(),
        ...(templateId && { flowTemplateId: templateId }),
        fields: values as never,
        roles: assigned,
        roleOverrides: overrides,
      }),
    ).client;
    if (outcome.type === "error") return setError(outcome.error.message);
    // 建好了，草稿就没用了
    zero.mutate(mutators.draft.delete({ id: draftId }));
    lastSaved.current = snapshot;
    // 连续新建：留在表单里，只清空名称，接着建下一个
    if (keepCreating) {
      Toast.success({ content: `已创建「${name.trim()}」`, duration: 2 });
      setDraftId(newId());
      setSavedAt(null);
      setName("");
      (form.elements.namedItem("itemName") as HTMLInputElement | null)?.focus();
      return;
    }
    await navigate({
      to: "/spaces/$spaceId/$typeKey/detail/$itemId",
      params: { spaceId: type.spaceId, typeKey: type.key, itemId: id },
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={create}>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {flows.length > 1 && (
        <Field label="流程类型">
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {flows.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={`${type.name}名称`}>
        <Input name="itemName" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      {optional.length > 0 && (
        <div className="-mb-1 flex items-center gap-3 text-sm">
          <Checkbox checked={simple} onChange={(e) => setSimple(e.target.checked)}>
            简洁模式
          </Checkbox>
          <span className="text-fg-subtle text-xs">
            {simple ? `只显示必填字段，已收起 ${createItems.length - shownItems.length} 项` : "显示全部字段"}
          </span>
          {simple && (
            <Popover>
              <PopoverTrigger className="ml-auto cursor-pointer rounded-md px-2 py-0.5 text-accent text-sm hover:bg-hover">
                选择显示的字段
              </PopoverTrigger>
              <PopoverContent align="end" className="flex max-h-72 w-60 flex-col gap-1 overflow-y-auto p-2">
                <p className="px-1 pb-1 text-fg-subtle text-xs">
                  必填字段总会显示。勾选的非必填字段在简洁模式下也显示。
                </p>
                {optional.map(({ field: f }) =>
                  f ? (
                    <Checkbox
                      key={f.key}
                      className="rounded px-1 py-0.5 hover:bg-hover"
                      checked={extra.includes(f.key)}
                      onChange={(e) =>
                        setExtra(e.target.checked ? [...extra, f.key] : extra.filter((k) => k !== f.key))
                      }
                    >
                      <span className="truncate">{f.name}</span>
                    </Checkbox>
                  ) : null,
                )}
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
      {shownItems.length > 0 && (
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {shownItems.map(({ item, field: f }, i) =>
            !f ? (
              <p
                // biome-ignore lint/suspicious/noArrayIndexKey: 提示文字没有 id，按位置渲染
                key={i}
                role="note"
                className="rounded-md bg-brand-50 px-3 py-2 text-sm text-accent sm:col-span-2"
              >
                {item.kind === "text" ? item.text : ""}
              </p>
            ) : (
              <Field
                key={f.key}
                label={
                  <FieldLabel
                    name={(item.kind === "field" && item.label) || f.name}
                    required={states[f.key]?.required}
                    description={f.config?.description}
                  />
                }
                hint={item.kind === "field" ? item.hint : undefined}
                className={
                  f.dataType === "richText" ||
                  f.dataType === "textarea" ||
                  f.dataType === "fieldGroup" ||
                  (item.kind === "field" && item.wide)
                    ? "sm:col-span-2"
                    : undefined
                }
              >
                <FieldInput
                  field={f}
                  label={(item.kind === "field" && item.label) || f.name}
                  value={fields[f.key] ?? null}
                  members={members}
                  options={availableOptions(f, fields, fields[f.key])}
                  live
                  onChange={(value) => setTouched((prev) => ({ ...prev, [f.key]: value }))}
                />
              </Field>
            ),
          )}
        </div>
      )}
      {type.roles.length > 0 && (
        <details className="group rounded-md border border-line-subtle">
          <summary className="cursor-pointer px-3 py-2 text-sm text-fg-muted select-none hover:text-fg">
            角色和负责人（{shownRoles.length}）
          </summary>
          <div className="border-t border-line-subtle px-3 py-2">
            <RolePicker
              roles={shownRoles.map((r) => ({
                key: r.key,
                name: r.name,
                single: !!r.config?.single,
                isOwner: !!r.config?.isOwner,
                removable: roleRemovable(r),
              }))}
              members={members}
              value={assigned}
              onToggle={(roleKey, userId, selected) => {
                const role = type.roles.find((r) => r.key === roleKey);
                setTouchedRoles((prev) => ({
                  ...prev,
                  [roleKey]: toggled(assigned[roleKey], userId, selected, !!role?.config?.single),
                }));
              }}
              onRemove={(roleKey) =>
                setOverrides((o) => ({ added: o.added.filter((k) => k !== roleKey), removed: [...o.removed, roleKey] }))
              }
              addable={type.roles.filter((r) => !shownRoles.includes(r))}
              onAdd={(roleKey) =>
                setOverrides((o) => ({ added: [...o.added, roleKey], removed: o.removed.filter((k) => k !== roleKey) }))
              }
            />
          </div>
        </details>
      )}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Checkbox checked={keepCreating} onChange={(e) => setKeepCreating(e.target.checked)}>
          连续新建
        </Checkbox>
        <output className="mr-auto text-fg-subtle text-xs">
          {savedAt ? `已存入草稿箱 ${draftTime(savedAt)}` : ""}
        </output>
        <Button variant="ghost" disabled={!hasContent} onClick={saveDraft}>
          存草稿
        </Button>
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit">创建</Button>
      </div>
    </form>
  );
}
