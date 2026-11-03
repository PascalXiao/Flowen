import {
  type DetailLayout,
  type LayoutItem,
  type LayoutSection,
  type LayoutTab,
  resolveLayout,
  SYSTEM_TAB_NAME,
  type SystemTab,
} from "@fp/engine";
import { ArrowDown, ArrowUp, Plus, Settings2, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ConditionEditor, type ConditionField } from "@/components/ConditionEditor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { cn, newId } from "@/lib/utils";

interface Draft {
  tabs: LayoutTab[];
  hidden: string[];
  create: { mode: "sync" } | { mode: "custom"; items: LayoutItem[] };
  labelPosition: "side" | "top";
}

type LayoutField = { key: string; name: string; dataType?: string; options?: ConditionField["options"] };

function initialDraft(fields: readonly LayoutField[], layout: DetailLayout | null): Draft {
  const resolved = resolveLayout(fields, layout);
  return {
    tabs: structuredClone(resolved.tabs),
    hidden: [...(layout?.hidden ?? [])].filter((k) => fields.some((f) => f.key === k)),
    create: layout?.create?.mode === "custom" ? structuredClone(layout.create) : { mode: "sync" },
    labelPosition: resolved.labelPosition,
  };
}

function move<T>(list: readonly T[], index: number, by: number): T[] {
  const to = index + by;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to] as T, next[index] as T];
  return next;
}

const CONTROL_LABEL: Record<
  Exclude<LayoutItem["kind"], "field" | "relation" | "relatedField" | "nodeInfo" | "relationTable" | "nodeTable">,
  string
> = {
  text: "提示文字",
  relations: "全部关联工作项",
  roles: "角色与人员",
  subItems: "子工作项",
  attachments: "附件",
};

/**
 * 页面布局编辑器，对照飞书项目的页面布局：
 * 详情页由页签组成，自定义页签里分组、组里放字段和控件；系统页签（节点详情、评论、动态）可以删掉再加回来；
 * 新建页可以和详情页同步，也可以单独布局。改完点保存才生效。
 */
export function LayoutEditor({
  fields,
  relationDefs,
  layout,
  canManage,
  onSave,
}: {
  fields: readonly LayoutField[];
  relationDefs: readonly { id: string; name: string }[];
  layout: DetailLayout | null;
  canManage: boolean;
  onSave: (layout: DetailLayout | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => initialDraft(fields, layout));
  const [dirty, setDirty] = useState(false);
  const [page, setPage] = useState<"detail" | "create">("detail");
  const [tabKey, setTabKey] = useState(draft.tabs[0]?.key ?? "");
  const update = (next: Draft) => {
    setDraft(next);
    setDirty(true);
  };
  const nameOf = (key: string) => fields.find((f) => f.key === key)?.name ?? key;
  const conditionFields: ConditionField[] = fields
    .filter((f) => !["richText", "attachment", "formula", "fieldGroup"].includes(f.dataType ?? ""))
    .map((f) => ({ key: f.key, name: f.name, dataType: f.dataType ?? "text", options: f.options ?? null }));
  const itemLabel = (item: LayoutItem) =>
    item.kind === "field"
      ? item.label
        ? `${item.label}（${nameOf(item.field)}）`
        : nameOf(item.field)
      : item.kind === "relation"
        ? `关联：${relationDefs.find((d) => d.id === item.relationDefId)?.name ?? "（已删除）"}`
        : item.kind === "nodeTable"
          ? `多节点视图：${item.title || item.nodes.join("、") || "（未选节点）"}`
          : item.kind === "relationTable"
            ? `关联工作项视图：${relationDefs.find((d) => d.id === item.relationDefId)?.name ?? "（已删除）"}`
            : item.kind === "nodeInfo"
              ? `节点信息：${item.label || item.node || "（未选节点）"}`
              : item.kind === "relatedField"
                ? `关联信息：${relationDefs.find((d) => d.id === item.relationDefId)?.name ?? "（已删除）"} · ${item.label || item.field || "（未选字段）"}`
                : item.kind === "text"
                  ? `提示文字：${item.text.slice(0, 20) || "（空）"}`
                  : CONTROL_LABEL[item.kind];

  const tab = draft.tabs.find((t) => t.key === tabKey) ?? draft.tabs[0];
  const setTabs = (tabs: LayoutTab[]) => update({ ...draft, tabs });
  const patchTab = (key: string, patch: Partial<LayoutTab>) =>
    setTabs(draft.tabs.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const sections = tab?.sections ?? [];
  const setSections = (next: LayoutSection[]) => tab && patchTab(tab.key, { sections: next });
  const removedSystem = (["nodes", "comments", "activity"] as const).filter(
    (s) => !draft.tabs.some((t) => t.system === s),
  );

  async function save(next: DetailLayout | null) {
    if (await onSave(next)) {
      const fresh = initialDraft(fields, next);
      setDraft(fresh);
      setTabKey(fresh.tabs[0]?.key ?? "");
      setDirty(false);
    }
  }

  return (
    <fieldset disabled={!canManage} className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-fg-muted">
        详情页由页签组成：自定义页签里分组，组里放字段和控件（提示文字、关联工作项、子工作项、角色与人员、附件），
        同一个字段可以放在多处。设为不显示的字段在详情页和新建页上都不出现，但仍然可以用在公式、筛选和自动化里；
        没放进布局的字段排在第一个页签最后的「其他字段」里。
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="编辑哪个页面"
          value={page}
          onChange={setPage}
          items={[
            ["detail", "详情页"],
            ["create", "新建页"],
          ]}
        />
        <span className="flex items-center gap-2 text-fg-muted">
          字段名位置
          <Select
            aria-label="字段名位置"
            value={draft.labelPosition}
            onChange={(e) => update({ ...draft, labelPosition: e.target.value as "side" | "top" })}
          >
            <option value="side">左侧</option>
            <option value="top">上方</option>
          </Select>
        </span>
      </div>

      {page === "detail" && (
        <>
          <div role="tablist" aria-label="布局页签" className="flex flex-wrap items-center gap-1.5">
            {draft.tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.key === tab?.key}
                className={cn(
                  "h-7 rounded-md border px-2.5",
                  t.key === tab?.key ? "border-brand-500 bg-brand-50 text-brand-500" : "border-line hover:bg-hover",
                )}
                onClick={() => setTabKey(t.key)}
              >
                {t.name}
                {t.system && <span className="ml-1 text-xs text-fg-subtle">系统</span>}
              </button>
            ))}
            {canManage && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const key = `tab-${newId().slice(0, 8)}`;
                  let n = draft.tabs.length;
                  while (draft.tabs.some((t) => t.name === `页签 ${n}`)) n++;
                  setTabs([...draft.tabs, { key, name: `页签 ${n}`, sections: [{ name: "分组 1", items: [] }] }]);
                  setTabKey(key);
                }}
              >
                <Plus />
                添加页签
              </Button>
            )}
            {canManage && removedSystem.length > 0 && (
              <Select
                aria-label="加回系统页签"
                value=""
                className="w-36"
                onChange={(e) => {
                  const system = e.target.value as SystemTab;
                  if (system) setTabs([...draft.tabs, { key: system, name: SYSTEM_TAB_NAME[system], system }]);
                }}
              >
                <option value="">加回系统页签…</option>
                {removedSystem.map((s) => (
                  <option key={s} value={s}>
                    {SYSTEM_TAB_NAME[s]}
                  </option>
                ))}
              </Select>
            )}
          </div>

          {tab && (
            <section
              aria-label={`页签 ${tab.name}`}
              className="flex flex-col gap-3 rounded-lg border border-line-subtle p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="页签名称"
                  className="w-44"
                  value={tab.name}
                  onChange={(e) => patchTab(tab.key, { name: e.target.value })}
                />
                <span className="flex-1" />
                <IconButton
                  label={`左移页签 ${tab.name}`}
                  disabled={draft.tabs[0]?.key === tab.key}
                  onClick={() => setTabs(move(draft.tabs, draft.tabs.indexOf(tab), -1))}
                >
                  <ArrowUp className="-rotate-90" />
                </IconButton>
                <IconButton
                  label={`右移页签 ${tab.name}`}
                  disabled={draft.tabs[draft.tabs.length - 1]?.key === tab.key}
                  onClick={() => setTabs(move(draft.tabs, draft.tabs.indexOf(tab), 1))}
                >
                  <ArrowDown className="-rotate-90" />
                </IconButton>
                <Button
                  variant="link"
                  size="sm"
                  aria-label={`删除页签 ${tab.name}`}
                  disabled={!tab.system && draft.tabs.filter((t) => !t.system).length === 1}
                  onClick={() => {
                    const rest = draft.tabs.filter((t) => t.key !== tab.key);
                    setTabs(rest);
                    setTabKey(rest[0]?.key ?? "");
                  }}
                >
                  删除页签
                </Button>
              </div>
              <Collapsible title="显示条件" summary={tab.showWhen ? "满足条件时显示" : "总是显示"}>
                <ConditionEditor
                  label={`页签「${tab.name}」的显示条件`}
                  value={tab.showWhen}
                  fields={conditionFields}
                  onChange={(showWhen) =>
                    setTabs(
                      draft.tabs.map((t) => {
                        if (t.key !== tab.key) return t;
                        const { showWhen: _, ...rest } = t;
                        return showWhen ? { ...rest, showWhen } : rest;
                      }),
                    )
                  }
                />
              </Collapsible>

              {tab.system ? (
                <p className="text-fg-subtle">系统页签的内容是固定的，可以改名、调顺序或删掉。</p>
              ) : (
                <>
                  {sections.map((section, si) => (
                    <SectionEditor
                      // biome-ignore lint/suspicious/noArrayIndexKey: 分组名正在编辑，只能按位置区分
                      key={si}
                      section={section}
                      index={si}
                      count={sections.length}
                      fields={fields}
                      relationDefs={relationDefs}
                      conditionFields={conditionFields}
                      itemLabel={itemLabel}
                      onChange={(next) => setSections(sections.map((s, j) => (j === si ? next : s)))}
                      onMove={(by) => setSections(move(sections, si, by))}
                      onRemove={() => setSections(sections.filter((_, j) => j !== si))}
                    />
                  ))}
                  <div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        let n = sections.length + 1;
                        while (sections.some((s) => s.name === `分组 ${n}`)) n++;
                        setSections([...sections, { name: `分组 ${n}`, items: [] }]);
                      }}
                    >
                      添加分组
                    </Button>
                  </div>
                </>
              )}
            </section>
          )}

          <section aria-label="不显示的字段" className="flex flex-col gap-2 rounded-lg bg-canvas p-3">
            <span className="text-fg-muted">不显示的字段</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.hidden.map((key) => (
                <span key={key} className="inline-flex h-6 items-center gap-1 rounded-full bg-surface px-2 text-xs">
                  {nameOf(key)}
                  <button
                    type="button"
                    aria-label={`显示 ${nameOf(key)}`}
                    className="text-fg-subtle hover:text-danger-600"
                    onClick={() => update({ ...draft, hidden: draft.hidden.filter((k) => k !== key) })}
                  >
                    ×
                  </button>
                </span>
              ))}
              <Select
                aria-label="设为不显示"
                value=""
                className="w-44"
                onChange={(e) => {
                  const key = e.target.value;
                  if (!key) return;
                  // 不显示的字段从各个分组里拿掉
                  const tabs = draft.tabs.map((t) => ({
                    ...t,
                    ...(t.sections && {
                      sections: t.sections.map((s) => ({
                        ...s,
                        items: s.items.filter((i) => i.kind !== "field" || i.field !== key),
                      })),
                    }),
                  }));
                  update({ ...draft, tabs, hidden: [...draft.hidden, key] });
                }}
              >
                <option value="">设为不显示…</option>
                {fields
                  .filter((f) => !draft.hidden.includes(f.key))
                  .map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.name}
                    </option>
                  ))}
              </Select>
            </div>
          </section>
        </>
      )}

      {page === "create" && (
        <section aria-label="新建页布局" className="flex flex-col gap-3 rounded-lg border border-line-subtle p-3">
          <Segmented
            label="新建页布局"
            value={draft.create.mode}
            onChange={(mode) =>
              update({
                ...draft,
                create:
                  mode === "sync"
                    ? { mode: "sync" }
                    : {
                        mode: "custom",
                        items: resolveLayout(fields, { tabs: draft.tabs, hidden: draft.hidden }).create,
                      },
              })
            }
            items={[
              ["sync", "与详情页同步"],
              ["custom", "单独布局"],
            ]}
          />
          {draft.create.mode === "sync" ? (
            <p className="text-fg-subtle">新建页按详情页里字段的顺序显示，详情页上勾了「新建页不显示」的字段不出现。</p>
          ) : (
            <ItemsEditor
              items={draft.create.items}
              fields={fields}
              relationDefs={[]}
              conditionFields={conditionFields}
              itemLabel={itemLabel}
              forCreate
              onChange={(items) => update({ ...draft, create: { mode: "custom", items } })}
            />
          )}
        </section>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex-1" />
          {layout && (
            <Button variant="ghost" onClick={() => save(null)}>
              恢复默认
            </Button>
          )}
          <Button
            disabled={!dirty}
            onClick={() =>
              save({
                tabs: draft.tabs.map((t) => ({
                  ...t,
                  name: t.name.trim(),
                  ...(t.sections && { sections: t.sections.map((s) => ({ ...s, name: s.name.trim() })) }),
                })),
                hidden: draft.hidden,
                create: draft.create,
                labelPosition: draft.labelPosition,
              })
            }
          >
            保存布局
          </Button>
        </div>
      )}
    </fieldset>
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
    <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}

function Collapsible({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <details className="rounded-md bg-canvas px-3 py-2">
      <summary className="cursor-pointer select-none text-fg-muted">
        {title}：{summary}
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}

/** 一个分组：名称、一栏两栏、默认收起，下面是组里的字段和控件。 */
function SectionEditor({
  section,
  index,
  count,
  fields,
  relationDefs,
  conditionFields,
  itemLabel,
  onChange,
  onMove,
  onRemove,
}: {
  section: LayoutSection;
  index: number;
  count: number;
  fields: readonly LayoutField[];
  relationDefs: readonly { id: string; name: string }[];
  conditionFields: ConditionField[];
  itemLabel: (item: LayoutItem) => string;
  onChange: (section: LayoutSection) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  return (
    <section
      aria-label={`分组 ${section.name}`}
      className="flex flex-col gap-2 rounded-lg border border-line-subtle p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="分组名称"
          className="w-44"
          value={section.name}
          onChange={(e) => onChange({ ...section, name: e.target.value })}
        />
        <Select
          aria-label={`分组 ${section.name} 的栏数`}
          value={String(section.columns ?? 2)}
          onChange={(e) => onChange({ ...section, columns: Number(e.target.value) as 1 | 2 })}
        >
          <option value="2">两栏</option>
          <option value="1">一栏</option>
        </Select>
        <label className="flex items-center gap-1.5 text-fg-muted">
          <Checkbox
            checked={!!section.collapsed}
            onChange={(e) => onChange({ ...section, collapsed: e.target.checked || undefined })}
          />
          默认收起
        </label>
        <span className="flex-1" />
        <IconButton label={`上移分组 ${section.name}`} disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowUp />
        </IconButton>
        <IconButton label={`下移分组 ${section.name}`} disabled={index === count - 1} onClick={() => onMove(1)}>
          <ArrowDown />
        </IconButton>
        <Button variant="link" size="sm" aria-label={`删除分组 ${section.name}`} onClick={onRemove}>
          删除
        </Button>
      </div>
      <ItemsEditor
        items={section.items}
        fields={fields}
        relationDefs={relationDefs}
        conditionFields={conditionFields}
        itemLabel={itemLabel}
        onChange={(items) => onChange({ ...section, items })}
      />
    </section>
  );
}

/** 字段和控件列表：调顺序、删除、展开设置，底部「添加」从资源库里选。 */
function ItemsEditor({
  items,
  fields,
  relationDefs,
  conditionFields,
  itemLabel,
  forCreate = false,
  onChange,
}: {
  items: readonly LayoutItem[];
  fields: readonly LayoutField[];
  relationDefs: readonly { id: string; name: string }[];
  conditionFields: ConditionField[];
  itemLabel: (item: LayoutItem) => string;
  forCreate?: boolean;
  onChange: (items: LayoutItem[]) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const patch = (i: number, next: LayoutItem) => onChange(items.map((x, j) => (j === i ? next : x)));
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 同一字段可以放多次，只能按位置区分
          <li key={i} className="flex flex-col gap-2 rounded-md px-1 py-0.5 hover:bg-hover/50">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate">{itemLabel(item)}</span>
              {item.kind !== "relations" &&
                item.kind !== "roles" &&
                item.kind !== "subItems" &&
                item.kind !== "attachments" && (
                  <IconButton label={`设置 ${itemLabel(item)}`} onClick={() => setOpen(open === i ? null : i)}>
                    <Settings2 />
                  </IconButton>
                )}
              <IconButton
                label={`上移${itemLabel(item)}`}
                disabled={i === 0}
                onClick={() => onChange(move(items, i, -1))}
              >
                <ArrowUp />
              </IconButton>
              <IconButton
                label={`下移${itemLabel(item)}`}
                disabled={i === items.length - 1}
                onClick={() => onChange(move(items, i, 1))}
              >
                <ArrowDown />
              </IconButton>
              <IconButton label={`移除 ${itemLabel(item)}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                <Trash2 />
              </IconButton>
            </div>
            {open === i && (
              <div className="flex flex-col gap-2 rounded-md bg-canvas p-3">
                {item.kind === "field" && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="显示名">
                        <Input
                          value={item.label ?? ""}
                          placeholder={fields.find((f) => f.key === item.field)?.name}
                          onChange={(e) => patch(i, { ...item, label: e.target.value || undefined })}
                        />
                      </Field>
                      <Field label="附加说明">
                        <Input
                          value={item.hint ?? ""}
                          onChange={(e) => patch(i, { ...item, hint: e.target.value || undefined })}
                        />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      {!forCreate && (
                        <label className="flex items-center gap-1.5">
                          <Checkbox
                            checked={!!item.createHidden}
                            onChange={(e) => patch(i, { ...item, createHidden: e.target.checked || undefined })}
                          />
                          新建页不显示
                        </label>
                      )}
                      <label className="flex items-center gap-1.5">
                        <Checkbox
                          checked={!!item.wide}
                          onChange={(e) => patch(i, { ...item, wide: e.target.checked || undefined })}
                        />
                        占满一行
                      </label>
                    </div>
                    <ConditionEditor
                      label="显示条件（不设表示总是显示）"
                      value={item.showWhen}
                      fields={conditionFields.filter((f) => f.key !== item.field)}
                      onChange={(showWhen) => {
                        const { showWhen: _, ...rest } = item;
                        patch(i, showWhen ? { ...rest, showWhen } : rest);
                      }}
                    />
                  </>
                )}
                {item.kind === "text" && (
                  <>
                    <Textarea
                      aria-label="提示文字内容"
                      value={item.text}
                      onChange={(e) => patch(i, { ...item, text: e.target.value })}
                    />
                    <Select
                      aria-label="提示样式"
                      value={item.tone ?? "info"}
                      onChange={(e) => patch(i, { ...item, tone: e.target.value as "info" | "warning" })}
                    >
                      <option value="info">普通提示</option>
                      <option value="warning">警示</option>
                    </Select>
                  </>
                )}
                {item.kind === "nodeTable" && (
                  <>
                    <Field label="节点（节点名，逗号分隔）">
                      <Input
                        value={item.nodes.join(", ")}
                        onChange={(e) =>
                          patch(i, {
                            ...item,
                            nodes: e.target.value
                              .split(/[,，、]/)
                              .map((c) => c.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </Field>
                    <Field label="只在这个流程类型上显示">
                      <Input
                        value={item.template ?? ""}
                        onChange={(e) => patch(i, { ...item, template: e.target.value || undefined })}
                      />
                    </Field>
                    <Field label="标题">
                      <Input
                        value={item.title ?? ""}
                        onChange={(e) => patch(i, { ...item, title: e.target.value || undefined })}
                      />
                    </Field>
                  </>
                )}
                {item.kind === "relationTable" && (
                  <>
                    <Field label="列（对端字段名，逗号分隔）">
                      <Input
                        value={item.columns.join(", ")}
                        onChange={(e) =>
                          patch(i, {
                            ...item,
                            columns: e.target.value
                              .split(/[,，、]/)
                              .map((c) => c.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </Field>
                    <Field label="标题">
                      <Input
                        value={item.title ?? ""}
                        onChange={(e) => patch(i, { ...item, title: e.target.value || undefined })}
                      />
                    </Field>
                  </>
                )}
                {item.kind === "nodeInfo" && (
                  <>
                    <Field label="节点（节点名或键）">
                      <Input value={item.node} onChange={(e) => patch(i, { ...item, node: e.target.value })} />
                    </Field>
                    <Field label="显示名">
                      <Input
                        value={item.label ?? ""}
                        onChange={(e) => patch(i, { ...item, label: e.target.value || undefined })}
                      />
                    </Field>
                  </>
                )}
                {item.kind === "relatedField" && (
                  <>
                    <Field label="对端字段（字段名）">
                      <Input value={item.field} onChange={(e) => patch(i, { ...item, field: e.target.value })} />
                    </Field>
                    <Field label="显示名">
                      <Input
                        value={item.label ?? ""}
                        onChange={(e) => patch(i, { ...item, label: e.target.value || undefined })}
                      />
                    </Field>
                  </>
                )}
                {item.kind === "relation" && (
                  <Field label="标题">
                    <Input
                      value={item.title ?? ""}
                      onChange={(e) => patch(i, { ...item, title: e.target.value || undefined })}
                    />
                  </Field>
                )}
              </div>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="text-fg-subtle">空分组不会显示。从下面添加字段或控件。</li>}
      </ul>
      <Select
        aria-label="添加字段或控件"
        value=""
        className="w-56"
        onChange={(e) => {
          const [kind, id = ""] = e.target.value.split(":");
          if (!kind) return;
          const item: LayoutItem =
            kind === "field"
              ? { kind: "field", field: id }
              : kind === "relation"
                ? { kind: "relation", relationDefId: id }
                : kind === "relatedField"
                  ? { kind: "relatedField", relationDefId: id, field: "" }
                  : kind === "nodeInfo"
                    ? { kind: "nodeInfo", node: "" }
                    : kind === "nodeTable"
                      ? { kind: "nodeTable", nodes: [] }
                      : kind === "relationTable"
                        ? { kind: "relationTable", relationDefId: id, columns: ["名称", "状态"] }
                        : kind === "text"
                          ? { kind: "text", text: "提示文字" }
                          : { kind: kind as "relations" | "roles" | "subItems" | "attachments" };
          onChange([...items, item]);
          if (["text", "relatedField", "nodeInfo", "relationTable", "nodeTable"].includes(kind)) setOpen(items.length);
        }}
      >
        <option value="">添加字段或控件…</option>
        <optgroup label="字段">
          {fields.map((f) => (
            <option key={f.key} value={`field:${f.key}`}>
              {f.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="控件">
          <option value="text:">提示文字</option>
          {!forCreate && (
            <>
              <option value="relations:">全部关联工作项</option>
              {relationDefs.map((d) => (
                <option key={d.id} value={`relation:${d.id}`}>
                  关联：{d.name}
                </option>
              ))}
              {relationDefs.map((d) => (
                <option key={`table-${d.id}`} value={`relationTable:${d.id}`}>
                  关联工作项视图：{d.name}
                </option>
              ))}
              {relationDefs.map((d) => (
                <option key={`info-${d.id}`} value={`relatedField:${d.id}`}>
                  关联信息：{d.name}
                </option>
              ))}
              <option value="nodeInfo:">节点信息</option>
              <option value="nodeTable:">多节点视图</option>
              <option value="subItems:">子工作项</option>
              <option value="roles:">角色与人员</option>
              <option value="attachments:">附件</option>
            </>
          )}
        </optgroup>
      </Select>
    </div>
  );
}
