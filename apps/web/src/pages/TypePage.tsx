import {
  CASCADE_FIELD_TYPES,
  FIELD_TYPE_LABEL,
  type FieldDataType,
  type FieldOption,
  FORMULA_FUNCTIONS,
  OPTION_FIELD_TYPES,
  type RoleConfig,
} from "@fp/engine";
import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { ColumnsEditor } from "@/components/ColumnsEditor";
import { FieldConfigSheet, type FieldPatch } from "@/components/FieldConfigSheet";
import { LayoutEditor } from "@/components/LayoutEditor";
import { PermissionsEditor } from "@/components/PermissionsEditor";
import { RoleConfigSheet } from "@/components/RoleConfigSheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/input";
import { ErrorBanner, PageBody } from "@/components/ui/page";
import { Tabs } from "@/components/ui/tabs";
import type { ListDisplay } from "@/components/WorkItemList";
import { withLineOptions } from "@/lib/fields";
import { columnSources } from "@/lib/list-columns";
import { newId } from "@/lib/utils";

/** 新建字段时可选的类型，按飞书项目的字段类型分组。 */
const TYPE_GROUPS = [
  ["文本", ["text", "textarea", "richText"]],
  ["选项", ["select", "multiSelect", "cascadeSelect", "cascadeMulti", "radio", "businessLine"]],
  ["人员", ["singleUser", "user"]],
  ["日期", ["date", "dateRange", "datetime"]],
  [
    "其他",
    [
      "number",
      "bool",
      "link",
      "docLink",
      "attachment",
      "phone",
      "email",
      "signal",
      "multiSignal",
      "fieldGroup",
      "formula",
      "vote",
    ],
  ],
] as const satisfies readonly (readonly [string, readonly FieldDataType[]])[];
type NewFieldType = (typeof TYPE_GROUPS)[number][1][number];

/**
 * 新字段的选项：逗号分隔；级联字段每项可以写成路径「华东/上海」，缺的上级一并建出来。
 */
function parseOptions(source: string, cascade: boolean): (FieldOption & { label: string })[] {
  const options: (FieldOption & { label: string })[] = [];
  for (const item of source
    .split(/[,，、\n]/)
    .map((o) => o.trim())
    .filter(Boolean)) {
    let parent: string | undefined;
    for (const part of (cascade ? item.split("/") : [item]).map((p) => p.trim()).filter(Boolean)) {
      const found = options.find((o) => o.label === part && o.parent === parent);
      if (found) {
        parent = found.value;
        continue;
      }
      let value = part;
      for (let n = 2; options.some((o) => o.value === value); n++) value = `${part}-${n}`;
      options.push({ value, label: part, ...(parent && { parent }) });
      parent = value;
    }
  }
  return options;
}

/** 公式里的 {字段键} 换成 {字段名} 显示。 */
export function displayFormula(source: string, fields: readonly { key: string; name: string }[]) {
  return source.replace(/\{([^}]*)\}/g, (all, key: string) => {
    const name = fields.find((f) => f.key === key)?.name;
    return name ? `{${name}}` : all;
  });
}

/** 工作项配置的页签，和飞书项目一致：基本信息、字段、页面布局、流程、角色。 */
export const TYPE_MENU_TABS = ["baseInfo", "field", "layout", "workflow", "role", "columns", "permission"] as const;
export type TypeMenuTab = (typeof TYPE_MENU_TABS)[number];
const TYPE_MENU_LABEL: Record<TypeMenuTab, string> = {
  baseInfo: "基本信息",
  field: "字段",
  layout: "页面布局",
  workflow: "流程",
  role: "角色",
  columns: "列",
  permission: "权限",
};

/** 空间配置 → 工作项 → 某个工作项：全屏的配置页。 */
export function TypePage() {
  const { spaceId, typeKey } = useParams({ from: "/app/spaces/$spaceId/setting/workObject/$typeKey" });
  const { menuTab = "baseInfo" } = useSearch({ from: "/app/spaces/$spaceId/setting/workObject/$typeKey" });
  const navigate = useNavigate();
  const [space, result] = useQuery(queries.spaces.byId({ id: spaceId }));
  const type = space?.workItemTypes.find((t) => t.key === typeKey);
  if (!type)
    return (
      <p className="p-6 text-sm text-fg-muted">
        {result.type === "complete" && space !== undefined ? "这个空间里没有这种工作项。" : "加载中…"}
      </p>
    );
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line-subtle bg-surface px-4">
        <span className="flex min-w-0 items-center gap-2 font-semibold">
          <span
            aria-hidden
            className="flex size-5 shrink-0 items-center justify-center rounded bg-brand-500 text-xs font-medium text-white"
          >
            {type.name.slice(0, 1)}
          </span>
          <span className="truncate">{type.name}</span>
        </span>
        <Tabs
          label="工作项配置"
          className="mx-auto"
          value={menuTab}
          onChange={(next) => navigate({ to: ".", search: { menuTab: next } })}
          items={TYPE_MENU_TABS.map((k) => [k, TYPE_MENU_LABEL[k]] as const)}
        />
        <Link
          to="/spaces/$spaceId/setting/$tab"
          params={{ spaceId, tab: "workObjectSetting" }}
          aria-label="关闭"
          className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg"
        >
          <X className="size-5" />
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
        <TypeConfig typeId={type.id} tab={menuTab} />
      </div>
    </div>
  );
}

/** 工作项配置的内容：按页签显示流程、角色、关联、字段、页面布局。只有空间管理员能改，成员只读。 */
function TypeConfig({ typeId, tab }: { typeId: string; tab: TypeMenuTab }) {
  const zero = useZero();
  const [type, result] = useQuery(queries.types.byId({ id: typeId }));
  const [error, setError] = useState<string | null>(null);
  const [newType, setNewType] = useState<NewFieldType>("select");
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [configuringRole, setConfiguringRole] = useState<string | null>(null);
  const [space] = useQuery(queries.spaces.byId({ id: type?.spaceId ?? "" }));
  const members = (space?.members ?? []).map((m) => ({ userId: m.userId, name: m.user?.name ?? m.userId }));
  const memberName = (id: string) => members.find((m) => m.userId === id)?.name ?? id;
  useActiveSpace(type?.spaceId);

  if (!type)
    return (
      <p className="p-6 text-sm text-fg-muted">{result.type === "complete" ? "类型不存在或没有权限。" : "加载中…"}</p>
    );
  const isAdmin = type.space?.members.some((m) => m.role === "admin") ?? false;
  const fields = withLineOptions(type.fields, type.space?.businessLines);
  // 别的工作项指向本工作项、并且在本端有字段名的互相关联
  const reverseDefs = (space?.workItemTypes ?? [])
    .flatMap((t) => t.relationDefs)
    .filter((d) => d.toTypeId === type.id && d.reverseName);
  async function reorder(index: number, by: -1 | 1) {
    const keys = type ? type.roles.map((r) => r.key) : [];
    const [key] = keys.splice(index, 1);
    if (key) keys.splice(index + by, 0, key);
    setError(null);
    const outcome = await zero.mutate(mutators.roleDef.reorder({ typeId, keys })).client;
    if (outcome.type === "error") setError(outcome.error.message);
  }

  /** 提交表单：先在浏览器里乐观执行，出错时显示原因；成功后清空表单。 */
  function submit(build: (data: FormData) => Parameters<typeof zero.mutate>[0] | null) {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const request = build(new FormData(form));
      if (!request) return;
      setError(null);
      const outcome = await zero.mutate(request).client;
      if (outcome.type === "error") return setError(outcome.error.message);
      form.reset();
    };
  }
  const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

  return (
    <PageBody className="max-w-4xl">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {tab === "baseInfo" && (
        <Section title="基本配置">
          <dl className="grid grid-cols-[6rem_1fr] gap-y-3 text-sm">
            <dt className="text-fg-muted">名称</dt>
            <dd>{type.name}</dd>
            <dt className="text-fg-muted">系统标识</dt>
            <dd className="font-mono text-xs leading-5">{type.key}</dd>
            <dt className="text-fg-muted">流程模式</dt>
            <dd>
              {type.flowMode === "state"
                ? "状态流：适合缺陷、工单这类按状态流转的事项"
                : "节点流：适合多角色协作、分阶段推进的事项"}
            </dd>
            <dt className="text-fg-muted">规模</dt>
            <dd className="text-fg-muted">
              {type.fields.length} 个字段 · {type.roles.length} 个角色 · {type.flowTemplates.length} 套流程
            </dd>
          </dl>
        </Section>
      )}
      {tab === "baseInfo" && (
        <CopySettings
          key={JSON.stringify(type.settings ?? null)}
          fields={type.fields.filter((f) => f.dataType !== "formula")}
          relations={[...type.relationDefs.map((d) => d.name), ...reverseDefs.map((d) => d.reverseName ?? d.name)]}
          roles={type.roles}
          initial={type.settings ?? null}
          canManage={isAdmin}
          onSave={async (settings) => {
            setError(null);
            const outcome = await zero.mutate(mutators.workItemType.setSettings({ id: type.id, settings })).client;
            if (outcome.type === "error") setError(outcome.error.message);
          }}
        />
      )}

      {tab === "workflow" && (
        <Section title="流程模板">
          <ul className="flex flex-col gap-2 text-sm">
            {type.flowTemplates.map((t) => {
              const latest = t.versions[0];
              return (
                <li key={t.id} className="flex items-center gap-3">
                  <Link
                    to="/spaces/$spaceId/setting/workObject/$typeKey/workflow/$templateId"
                    params={{ spaceId: type.spaceId, typeKey: type.key, templateId: t.id }}
                    className="font-medium text-brand-500 hover:underline"
                  >
                    {t.name}
                  </Link>
                  <span className="text-fg-muted">
                    {t.currentVersionId ? "已发布" : "未发布"}
                    {latest && !latest.publishedAt ? `，有草稿 v${latest.version}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          {isAdmin && (
            <form
              className="flex items-end gap-2"
              onSubmit={submit((data) => {
                const name = text(data, "name");
                return name ? mutators.flowTemplate.create({ id: newId(), typeId, key: name, name }) : null;
              })}
            >
              <Label className="flex flex-1 flex-col gap-1.5">
                新模板名称
                <Input name="name" />
              </Label>
              <Button type="submit" variant="outline">
                新建模板
              </Button>
            </form>
          )}
        </Section>
      )}

      {tab === "role" && (
        <Section title="角色">
          <ul aria-label="角色列表" className="flex flex-col text-sm">
            {type.roles.map((r, i) => (
              <li key={r.id} className="flex min-h-9 items-center gap-3 border-b border-line-subtle last:border-0">
                <span className="w-32 truncate font-medium">{r.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                  {roleSummary(r.config, memberName)}
                </span>
                {isAdmin && (
                  <span className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`上移角色 ${r.name}`}
                      disabled={i === 0}
                      onClick={() => reorder(i, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`下移角色 ${r.name}`}
                      disabled={i === type.roles.length - 1}
                      onClick={() => reorder(i, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </span>
                )}
                <Button
                  variant="link"
                  size="sm"
                  aria-label={`配置角色 ${r.name}`}
                  onClick={() => setConfiguringRole(r.id)}
                >
                  {isAdmin ? "配置" : "查看配置"}
                </Button>
              </li>
            ))}
          </ul>
          {isAdmin && (
            <form
              className="flex items-end gap-2"
              onSubmit={submit((data) => {
                const name = text(data, "name");
                return name ? mutators.roleDef.create({ id: newId(), typeId, key: name, name }) : null;
              })}
            >
              <Label className="flex flex-1 flex-col gap-1.5">
                新角色名称
                <Input name="name" />
              </Label>
              <Button type="submit" variant="outline">
                添加角色
              </Button>
            </form>
          )}
        </Section>
      )}

      {tab === "field" && (
        <Section title="字段">
          <table className="w-full text-sm">
            <tbody>
              {type.fields.map((f) => (
                <FieldRow
                  key={f.id}
                  field={f}
                  fields={type.fields}
                  roles={type.roles}
                  canManage={isAdmin}
                  onConfigure={() => setConfiguring(f.id)}
                  onFormula={async (formula) => {
                    setError(null);
                    const outcome = await zero.mutate(mutators.fieldDef.setFormula({ id: f.id, formula })).client;
                    if (outcome.type === "error") setError(outcome.error.message);
                    return outcome.type !== "error";
                  }}
                  onAccess={async (viewRoles, editRoles) => {
                    setError(null);
                    const outcome = await zero.mutate(mutators.fieldDef.setAccess({ id: f.id, viewRoles, editRoles }))
                      .client;
                    if (outcome.type === "error") setError(outcome.error.message);
                  }}
                />
              ))}
            </tbody>
          </table>
          {isAdmin && (
            <form
              className="grid items-end gap-2 sm:grid-cols-[1fr_8rem_1fr_auto]"
              onSubmit={submit((data) => {
                const name = text(data, "name");
                if (!name) return null;
                const dataType = newType;
                const options = parseOptions(text(data, "options"), CASCADE_FIELD_TYPES.includes(dataType));
                return mutators.fieldDef.create({
                  id: newId(),
                  typeId,
                  key: name,
                  name,
                  dataType,
                  ...(OPTION_FIELD_TYPES.includes(dataType) && { options }),
                  ...(dataType === "formula" && { formula: text(data, "formula") }),
                });
              })}
            >
              <Label className="flex flex-col gap-1.5">
                新字段名称
                <Input name="name" />
              </Label>
              <Label className="flex flex-col gap-1.5">
                类型
                <Select name="dataType" value={newType} onChange={(e) => setNewType(e.target.value as typeof newType)}>
                  {TYPE_GROUPS.map(([group, types]) => (
                    <optgroup key={group} label={group}>
                      {types.map((t) => (
                        <option key={t} value={t}>
                          {FIELD_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Label>
              {newType === "formula" ? (
                <Label className="flex flex-col gap-1.5">
                  公式
                  <Input name="formula" placeholder="{工时} * {单价}" />
                </Label>
              ) : (
                <Label className="flex flex-col gap-1.5">
                  {CASCADE_FIELD_TYPES.includes(newType)
                    ? "选项（逗号分隔，用 / 写层级）"
                    : newType === "vote"
                      ? "投票选项（逗号分隔，不填为赞成、反对、弃权）"
                      : "选项（单选、多选用，逗号分隔）"}
                  <Input
                    name="options"
                    placeholder={
                      CASCADE_FIELD_TYPES.includes(newType)
                        ? "华东/上海，华东/杭州，华北"
                        : newType === "vote"
                          ? "方案 A，方案 B"
                          : "是，否"
                    }
                  />
                </Label>
              )}
              <Button type="submit" variant="outline">
                添加字段
              </Button>
              {newType === "formula" && <FormulaHelp />}
            </form>
          )}
        </Section>
      )}

      {(() => {
        const field = fields.find((f) => f.id === configuring);
        return field ? (
          <FieldConfigSheet
            templates={type.flowTemplates.map((t) => t.name)}
            roles={type.roles}
            key={field.id}
            field={field}
            fields={fields}
            members={members}
            canManage={isAdmin}
            onClose={() => setConfiguring(null)}
            onSave={async (patch: FieldPatch) => {
              // 默认值里的值是 JSON，配置的类型比 mutator 参数宽，交给 mutator 校验
              const outcome = await zero.mutate(
                mutators.fieldDef.update({ id: field.id, ...patch, config: patch.config as never }),
              ).client;
              return outcome.type === "error" ? outcome.error.message : null;
            }}
          />
        ) : null;
      })()}

      {(() => {
        const role = type.roles.find((r) => r.id === configuringRole);
        return role ? (
          <RoleConfigSheet
            key={role.id}
            role={role}
            roles={type.roles}
            fields={fields}
            members={members}
            canManage={isAdmin}
            onClose={() => setConfiguringRole(null)}
            onSave={async (patch) => {
              // 条件里的值是 JSON，配置的类型比 mutator 参数宽，交给 mutator 校验
              const outcome = await zero.mutate(
                mutators.roleDef.update({ id: role.id, name: patch.name, config: patch.config as never }),
              ).client;
              return outcome.type === "error" ? outcome.error.message : null;
            }}
          />
        ) : null;
      })()}

      {tab === "columns" && (
        <Section title="默认显示的列">
          <ColumnsEditor
            fields={fields}
            sources={columnSources(
              [
                {
                  id: type.id,
                  roles: type.roles,
                  flowTemplates: type.flowTemplates.map((t) => ({
                    currentVersion: t.versions.find((v) => v.id === t.currentVersionId),
                  })),
                },
              ],
              (space?.workItemTypes ?? []).map((t) => ({
                ...t,
                fields: withLineOptions(t.fields, space?.businessLines),
              })),
            )}
            value={(type.defaultDisplay as ListDisplay | null) ?? null}
            canManage={isAdmin}
            onSave={async (display) => {
              setError(null);
              const outcome = await zero.mutate(
                mutators.workItemType.setDefaultDisplay({ id: typeId, display: display as never }),
              ).client;
              if (outcome.type === "error") setError(outcome.error.message);
              return outcome.type !== "error";
            }}
          />
        </Section>
      )}

      {tab === "permission" && (
        <Section title="权限">
          <PermissionsEditor
            key={JSON.stringify(space?.userGroups.map((g) => g.id))}
            roles={type.roles}
            groups={space?.userGroups ?? []}
            value={type.permissions ?? null}
            canManage={isAdmin}
            onSave={async (permissions) => {
              setError(null);
              const outcome = await zero.mutate(
                mutators.workItemType.setPermissions({ typeId, permissions: permissions as never }),
              ).client;
              if (outcome.type === "error") setError(outcome.error.message);
              return outcome.type !== "error";
            }}
          />
        </Section>
      )}

      {tab === "layout" && (
        <Section title="详情页布局">
          <LayoutEditor
            key={JSON.stringify([type.detailLayout, type.fields.map((f) => f.key)])}
            fields={fields.map((f) => ({
              key: f.key,
              name: f.name,
              dataType: f.dataType,
              options: f.options?.map((o) => ({ value: o.value, label: o.label || o.value })) ?? null,
            }))}
            relationDefs={[...type.relationDefs, ...reverseDefs.map((d) => ({ ...d, name: d.reverseName ?? d.name }))]}
            layout={type.detailLayout ?? null}
            canManage={isAdmin}
            onSave={async (layout) => {
              setError(null);
              // 布局作为 JSON 交给 mutator，由它按结构校验
              const outcome = await zero.mutate(
                mutators.workItemType.setLayout({ id: typeId, layout: layout as never }),
              ).client;
              if (outcome.type === "error") setError(outcome.error.message);
              return outcome.type !== "error";
            }}
          />
        </Section>
      )}
    </PageBody>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

/** 公式写法说明，列出可用的函数。 */
function FormulaHelp() {
  return (
    <details className="text-xs text-fg-muted sm:col-span-4">
      <summary className="cursor-pointer select-none hover:text-fg">公式怎么写</summary>
      <div className="mt-1.5 flex flex-col gap-1">
        <p>
          字段写成 {"{字段名}"}，可以用 + - * / 、比较（&gt; &lt; = !=）和 &amp; 拼接文本；文本用双引号。空值在计算里按
          0 算。子工作项汇总的结果在服务端计算，引用了受限字段时，记得也给公式字段配可见角色。
        </p>
        <p>
          跨工作项：RELATED("关联名") 是关联的工作项列表，CHILDREN() 是子工作项列表，列表.{"{字段}"} 取每一项的字段；
          FILTER、MAP、COUNTIF、SUMIF、ANYOF、ALLOF 的第二个参数里用 each 表示当前项，工作项还有 .名称、.状态、.阶段。
          例：是否存在关联风险 COUNT(RELATED("关联风险")) &gt; 0；进行中的风险个数 COUNTIF(RELATED("关联风险"),
          each.状态 = "inProgress")；NODE("需求评审").结论 = "pass"。
        </p>
        <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
          {Object.values(FORMULA_FUNCTIONS).map((f) => (
            <li key={f.doc} className="font-mono">
              {f.doc}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

type FieldDef = {
  id: string;
  key: string;
  name: string;
  dataType: string;
  formula: string | null;
  required: boolean | null;
  options: readonly { label: string }[] | null;
  config: {
    description?: string | null;
    validWhen?: unknown;
    showWhen?: unknown;
    requiredWhen?: unknown;
    defaultValue?: unknown;
  } | null;
  viewRoles: readonly string[] | null;
  editRoles: readonly string[] | null;
};

/** 角色配置一行概括：出现方式、成员分配、单人、负责人。 */
function roleSummary(config: RoleConfig | null, name: (id: string) => string): string {
  const c = config ?? {};
  const appear =
    c.appear?.mode === "hidden" ? "默认隐藏" : c.appear?.mode === "conditional" ? "满足条件出现" : "默认出现";
  const assign =
    !c.assign || c.assign.mode === "creator"
      ? "成员：创建者"
      : c.assign.mode === "manual"
        ? "成员：自行添加"
        : c.assign.mode === "fixed"
          ? `成员：${c.assign.members.map(name).join("、") || "—"}`
          : `按条件分配（${c.assign.rules.length} 组）`;
  return [appear, assign, c.single ? "单人" : "", c.isOwner ? "负责人" : ""].filter(Boolean).join(" · ");
}

/** 字段上配了哪些规则，一行概括。 */
function rules(field: FieldDef): string {
  const c = field.config ?? {};
  return [
    field.required ? "必填" : c.requiredWhen ? "条件必填" : "",
    c.validWhen ? "有效性" : "",
    c.showWhen ? "条件显示" : "",
    c.defaultValue ? "默认值" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** 字段一行：名称、类型、选项、权限。管理员展开后按角色设置谁能看、谁能改。 */
function FieldRow({
  field,
  fields,
  roles,
  canManage,
  onAccess,
  onFormula,
  onConfigure,
}: {
  field: FieldDef;
  fields: readonly { key: string; name: string }[];
  roles: readonly { key: string; name: string }[];
  canManage: boolean;
  onAccess: (viewRoles: string[], editRoles: string[]) => void;
  onFormula: (formula: string) => Promise<boolean>;
  onConfigure: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const view = [...(field.viewRoles ?? [])];
  const edit = [...(field.editRoles ?? [])];
  const names = (keys: string[]) => keys.map((k) => roles.find((r) => r.key === k)?.name ?? k).join("、");
  const summary = `${view.length ? `可见：${names(view)}` : "所有人可见"} · ${edit.length ? `可改：${names(edit)}` : "所有人可改"}`;
  const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  const chips = (label: string, list: string[], onChange: (next: string[]) => void) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 text-fg-muted">{label}</span>
      {roles.map((r) => {
        const on = list.includes(r.key);
        return (
          <button
            key={r.key}
            type="button"
            aria-pressed={on}
            aria-label={`${field.name}${label}：${r.name}`}
            className={
              on
                ? "h-6 rounded-full border border-brand-500 bg-brand-50 px-2.5 text-xs text-brand-500"
                : "h-6 rounded-full border border-line px-2.5 text-xs text-fg-muted hover:bg-hover"
            }
            onClick={() => onChange(toggle(list, r.key))}
          >
            {r.name}
          </button>
        );
      })}
      {list.length === 0 && <span className="text-xs text-fg-subtle">（不限制）</span>}
    </div>
  );
  return (
    <>
      <tr className="border-b border-line-subtle">
        <td className="py-1.5 pr-4">
          {field.name}
          {rules(field) && <span className="ml-1.5 text-xs text-fg-subtle">{rules(field)}</span>}
        </td>
        <td className="py-1.5 pr-4 text-fg-muted">
          {FIELD_TYPE_LABEL[field.dataType as FieldDataType] ?? field.dataType}
        </td>
        <td className="py-1.5 pr-4 text-fg-muted">
          {field.formula !== null ? (
            editing !== null ? (
              <form
                className="flex items-center gap-1.5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await onFormula(editing)) setEditing(null);
                }}
              >
                <Input
                  aria-label={`${field.name}的公式`}
                  value={editing}
                  onChange={(e) => setEditing(e.target.value)}
                  className="font-mono"
                />
                <Button type="submit" size="sm" variant="outline">
                  保存
                </Button>
              </form>
            ) : (
              <span className="flex items-center gap-1.5">
                <code className="text-xs">{displayFormula(field.formula, fields)}</code>
                {canManage && (
                  <Button
                    variant="link"
                    size="sm"
                    aria-label={`编辑${field.name}的公式`}
                    onClick={() => setEditing(displayFormula(field.formula ?? "", fields))}
                  >
                    编辑
                  </Button>
                )}
              </span>
            )
          ) : (
            field.options?.map((o) => o.label).join(" / ")
          )}
        </td>
        <td className="py-1.5 text-xs text-fg-muted">
          {summary}
          <Button variant="link" size="sm" className="ml-2" aria-label={`配置字段 ${field.name}`} onClick={onConfigure}>
            {canManage ? "配置" : "查看配置"}
          </Button>
          {canManage && (
            <Button
              variant="link"
              size="sm"
              className="ml-2"
              aria-expanded={open}
              aria-label={`设置${field.name}的权限`}
              onClick={() => setOpen(!open)}
            >
              {open ? "收起" : "权限"}
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-line-subtle bg-canvas">
          <td colSpan={4} className="px-3 py-2">
            <div className="flex flex-col gap-2">
              {chips("可见角色", view, (next) => onAccess(next, edit))}
              {chips("可改角色", edit, (next) => onAccess(view, next))}
              <p className="text-xs text-fg-subtle">
                不选表示不限制。配了可见角色后，只有担任这些角色（或可改角色）的人和空间管理员能看到这个字段的值。
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** 复制工作项时不带过去的字段、关联和角色（对照飞书项目工作项类型的「复制配置」）。 */
function CopySettings({
  fields,
  relations,
  roles,
  initial,
  canManage,
  onSave,
}: {
  fields: readonly { key: string; name: string }[];
  relations: readonly string[];
  roles: readonly { key: string; name: string }[];
  initial: { copyExcludeFields?: string[]; copyExcludeRoles?: string[] } | null;
  canManage: boolean;
  onSave: (settings: { copyExcludeFields: string[]; copyExcludeRoles: string[] }) => Promise<void>;
}) {
  const [excludedFields, setExcludedFields] = useState(new Set(initial?.copyExcludeFields ?? []));
  const [excludedRoles, setExcludedRoles] = useState(new Set(initial?.copyExcludeRoles ?? []));
  const toggle = (set: Set<string>, value: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };
  const items = [
    ...fields.map((f) => ({ value: f.key, label: f.name })),
    ...relations.map((r) => ({ value: r, label: `${r}（关联）` })),
  ];
  return (
    <Section title="复制配置">
      <fieldset disabled={!canManage} className="flex flex-col gap-3 text-sm">
        <p className="text-fg-muted">复制工作项时，勾选的字段、关联和角色不带到新工作项上。</p>
        {/* biome-ignore lint/a11y/useSemanticElements: 已经在 fieldset 里，这里只是给一组勾选框起名 */}
        <div role="group" aria-label="复制时不带的字段" className="grid max-h-64 grid-cols-3 gap-1 overflow-y-auto">
          {items.map((it) => (
            <Label key={it.value} className="flex items-center gap-1.5 font-normal">
              <input
                type="checkbox"
                aria-label={`复制时不带${it.label}`}
                checked={excludedFields.has(it.value)}
                onChange={(e) => setExcludedFields(toggle(excludedFields, it.value, e.target.checked))}
              />
              <span className="truncate">{it.label}</span>
            </Label>
          ))}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: 已经在 fieldset 里，这里只是给一组勾选框起名 */}
        <div role="group" aria-label="复制时不带的角色" className="grid grid-cols-3 gap-1">
          {roles.map((r) => (
            <Label key={r.key} className="flex items-center gap-1.5 font-normal">
              <input
                type="checkbox"
                aria-label={`复制时不带角色${r.name}`}
                checked={excludedRoles.has(r.key)}
                onChange={(e) => setExcludedRoles(toggle(excludedRoles, r.key, e.target.checked))}
              />
              <span className="truncate">{r.name}</span>
            </Label>
          ))}
        </div>
        {canManage && (
          <Button
            className="w-fit"
            onClick={() => onSave({ copyExcludeFields: [...excludedFields], copyExcludeRoles: [...excludedRoles] })}
          >
            保存复制配置
          </Button>
        )}
      </fieldset>
    </Section>
  );
}
