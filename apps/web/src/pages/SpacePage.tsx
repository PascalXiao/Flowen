import { SideSheet } from "@douyinfe/semi-ui";
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
import { mutators, queries, type WorkItemFilterArgs } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Columns3, GanttChartSquare, List, ListTree, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { Board } from "@/components/Board";
import { FieldInput, type FieldInputValue, FieldLabel } from "@/components/FieldInput";
import { FilterBar } from "@/components/FilterBar";
import { type PickerMember, RolePicker, toggled } from "@/components/RolePicker";
import { SpaceGantt } from "@/components/SpaceGantt";
import { TreeView } from "@/components/TreeView";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { EmptyState, ErrorBanner, PageBody, PageHeader } from "@/components/ui/page";
import { Segmented, Tabs } from "@/components/ui/tabs";
import { type ListDisplay, WorkItemList } from "@/components/WorkItemList";
import { env } from "@/lib/env";
import { withLineOptions } from "@/lib/fields";
import { newId } from "@/lib/utils";
import { WorkItemView } from "@/pages/WorkItemPage";

const NO_CALENDAR = { holidays: [], extraWorkdays: [] };

type Space = NonNullable<QueryResultType<ReturnType<typeof queries.spaces.byId>>>;
type ItemType = Space["workItemTypes"][number];

/**
 * 工作项主页（飞书项目左侧导航里的一个工作项，如「项目」「缺陷」）：
 * 「工作项列表」页签是这种类型的列表和统计，「视图列表」页签是这种类型保存过的视图。
 */
export function WorkItemHomePage() {
  const { spaceId, typeKey } = useParams({ from: "/app/spaces/$spaceId/$typeKey" });
  const { tab, view: viewId, item: openItem } = useSearch({ from: "/app/spaces/$spaceId/$typeKey" });
  const navigate = useNavigate();
  const zero = useZero();
  const [space, spaceResult] = useQuery(queries.spaces.byId({ id: spaceId }));
  useActiveSpace(spaceId);

  if (!space)
    return (
      <p className="p-6 text-sm text-fg-subtle">
        {spaceResult.type === "complete" ? "空间不存在或没有权限。" : "加载中…"}
      </p>
    );
  const type = space.workItemTypes.find((t) => t.key === typeKey);
  if (!type) return <p className="p-6 text-sm text-fg-subtle">这个空间里没有这种工作项。</p>;
  const myRole = space.members.find((m) => m.userId === zero.userID)?.role;
  const isAdmin = myRole === "admin";
  const members: PickerMember[] = space.members.map((m) => ({ userId: m.userId, name: m.user?.name ?? m.userId }));
  const published = type.flowTemplates.some((f) => f.currentVersionId);
  const views = space.views.filter((v) => v.filter?.typeIds?.includes(type.id));

  return (
    <>
      <PageHeader
        title={type.name}
        actions={
          published &&
          myRole !== "guest" && (
            <CreateWorkItem
              types={[type]}
              members={members.filter((m) => space.members.find((x) => x.userId === m.userId)?.role !== "guest")}
              lines={space.businessLines}
              label="新建"
              title={`新建${type.name}`}
            />
          )
        }
        tabs={
          <Tabs
            label="工作项主页"
            value={tab ?? "items"}
            onChange={(next) => navigate({ to: ".", search: next === "views" ? { tab: "views" as const } : {} })}
            items={[
              ["items", "工作项列表"],
              ["views", "视图列表"],
            ]}
          />
        }
      />
      {openItem && (
        <SideSheet
          visible
          width="72%"
          // 挂在内容区里（左侧导航不被盖住），和飞书项目的抽屉一样
          getPopupContainer={() => document.querySelector("main") ?? document.body}
          bodyStyle={{ padding: 0 }}
          title={
            <Link
              to="/spaces/$spaceId/$typeKey/detail/$itemId"
              params={{ spaceId, typeKey, itemId: openItem }}
              className="text-sm font-normal text-brand-500"
            >
              全屏打开
            </Link>
          }
          onCancel={() => navigate({ to: ".", search: (prev) => ({ ...prev, item: undefined }) })}
        >
          <WorkItemView itemId={openItem} />
        </SideSheet>
      )}
      <PageBody className="max-w-none">
        {tab === "views" ? (
          <ViewList
            views={views}
            members={members}
            canDelete={(v) => isAdmin || v.createdBy === zero.userID}
            onOpen={(id) => navigate({ to: ".", search: { view: id } })}
          />
        ) : !published ? (
          <div className="rounded-lg border border-line-subtle bg-surface shadow-card">
            <EmptyState
              title={`${type.name}还没有发布的流程`}
              description={
                isAdmin
                  ? "在空间配置里给它配置字段、角色和流程，发布后就能新建。"
                  : "请空间管理员先在空间配置里配置并发布流程。"
              }
              action={
                isAdmin && (
                  <Button variant="outline" asChild>
                    <Link
                      to="/spaces/$spaceId/setting/workObject/$typeKey"
                      params={{ spaceId, typeKey }}
                      search={{ menuTab: "workflow" }}
                    >
                      配置{type.name}
                    </Link>
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <WorkItems
            key={`${type.id}-${viewId ?? ""}`}
            space={space}
            type={type}
            view={views.find((v) => v.id === viewId)}
            views={views}
            members={members}
            isAdmin={isAdmin}
          />
        )}
      </PageBody>
    </>
  );
}

type SavedView = Space["views"][number];

/** 视图列表：这种工作项保存过的视图，分「全部视图」「我创建的」；点名称回到工作项列表并套用。 */
function ViewList({
  views,
  members,
  canDelete,
  onOpen,
}: {
  views: readonly SavedView[];
  members: PickerMember[];
  canDelete: (view: SavedView) => boolean;
  onOpen: (viewId: string) => void;
}) {
  const zero = useZero();
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [q, setQ] = useState("");
  const shown = views.filter(
    (v) => (scope === "all" || v.createdBy === zero.userID) && v.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface p-4 shadow-card">
      <div className="flex items-center gap-3">
        <Tabs
          label="视图范围"
          value={scope}
          onChange={setScope}
          items={[
            ["all", "全部视图"],
            ["mine", "我创建的"],
          ]}
        />
        <span className="flex-1" />
        <Input
          aria-label="搜索视图"
          placeholder="搜索视图名称"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56"
        />
      </div>
      {shown.length === 0 ? (
        <EmptyState title="没有视图" description="在工作项列表里筛选好之后，点「保存为视图」就会出现在这里。" />
      ) : (
        <table aria-label="视图" className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-subtle text-left text-xs text-fg-muted">
              <th className="py-2 font-normal">视图名称</th>
              <th className="py-2 font-normal">创建者</th>
              <th className="py-2 font-normal">创建时间</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => (
              <tr key={v.id} className="border-b border-line-subtle last:border-0 hover:bg-hover/50">
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => onOpen(v.id)}
                    className="cursor-pointer text-fg hover:text-brand-500"
                  >
                    {v.name}
                  </button>
                </td>
                <td className="py-2 text-fg-muted">{members.find((m) => m.userId === v.createdBy)?.name ?? "—"}</td>
                <td className="py-2 text-fg-muted">
                  {v.createdAt ? new Date(v.createdAt).toLocaleString("zh-CN", { hour12: false }) : "—"}
                </td>
                <td className="py-2 text-right">
                  {canDelete(v) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`删除视图 ${v.name}`}
                      onClick={() => zero.mutate(mutators.view.delete({ id: v.id }))}
                    >
                      删除
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function WorkItems({
  space,
  type,
  view: initialView,
  views,
  members,
  isAdmin,
}: {
  space: Space;
  type: ItemType;
  view: SavedView | undefined;
  views: readonly SavedView[];
  members: PickerMember[];
  isAdmin: boolean;
}) {
  const [filter, setFilter] = useState<WorkItemFilterArgs>({
    ...(initialView?.filter ?? {}),
    typeIds: [type.id],
  });
  const [view, setView] = useState<"table" | "tree" | "board" | "gantt">("table");
  // 列表的显示设置（列、排序、分组、着色）：没套用视图时记在本机，下次打开还是这样
  const displayKey = `flowen.list.${space.id}.${type.id}`;
  const [display, setDisplayState] = useState<ListDisplay>(() => {
    if (initialView?.display) return initialView.display as ListDisplay;
    try {
      const mine = localStorage.getItem(displayKey);
      if (mine) return JSON.parse(mine) as ListDisplay;
    } catch {
      // 本机读不了就用管理员配的默认
    }
    return (type.defaultDisplay as ListDisplay | null) ?? {};
  });
  const setDisplay = (next: ListDisplay) => {
    setDisplayState(next);
    try {
      localStorage.setItem(displayKey, JSON.stringify(next));
    } catch {
      // 本机存不了就只在这次会话里生效
    }
  };
  const types = [
    {
      id: type.id,
      name: type.name,
      definitions: type.flowTemplates.flatMap((f) => (f.currentVersion ? [f.currentVersion.definition] : [])),
      fields: type.fields,
    },
  ];
  const viewSwitch = (
    <Segmented
      label="显示方式"
      value={view}
      onChange={setView}
      items={[
        [
          "table",
          <>
            <List />
            列表
          </>,
        ],
        [
          "tree",
          <>
            <ListTree />
            树形
          </>,
        ],
        [
          "board",
          <>
            <Columns3 />
            看板
          </>,
        ],
        [
          "gantt",
          <>
            <GanttChartSquare />
            甘特图
          </>,
        ],
      ]}
    />
  );
  const filterBar = (
    <FilterBar
      spaceId={space.id}
      filter={filter}
      onChange={setFilter}
      types={types}
      members={members.map((m) => ({ id: m.userId, name: m.name }))}
      views={views.map((v) => ({ ...v, filter: v.filter ?? {} }))}
      isAdmin={isAdmin}
      fixedTypeId={type.id}
      display={view === "table" ? display : undefined}
      onView={(v) => view === "table" && v.display && setDisplay(v.display as ListDisplay)}
      actions={viewSwitch}
    />
  );

  return (
    <div className="flex min-h-0 flex-col">
      {view !== "table" && (
        <div className="mb-3 rounded-lg border border-line-subtle bg-surface px-4 py-3">{filterBar}</div>
      )}
      {view === "tree" ? (
        <TreeView
          spaceId={space.id}
          filter={filter}
          relationDefs={space.workItemTypes.flatMap((t) =>
            t.relationDefs.map((d) => ({
              id: d.id,
              name: d.name,
              fromType: t.name,
              toType: space.workItemTypes.find((x) => x.id === d.toTypeId)?.name ?? "?",
            })),
          )}
        />
      ) : view === "board" ? (
        <Board spaceId={space.id} filter={filter} types={types} />
      ) : view === "gantt" ? (
        <div className="p-4">
          <SpaceGantt
            spaceId={space.id}
            timeZone={space.timezone ?? "Asia/Shanghai"}
            calendar={space.calendar ?? NO_CALENDAR}
            filter={filter}
          />
        </div>
      ) : (
        <WorkItemList space={space} filter={filter} display={display} onDisplay={setDisplay} toolbar={filterBar} />
      )}
    </div>
  );
}

export function ImportOem({ spaceId }: { spaceId: string }) {
  const [error, setError] = useState<string | null>(null);
  async function run() {
    const res = await fetch(`${env.apiUrl}/api/spaces/${spaceId}/import-oem`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) setError(((await res.json()) as { error: string }).error);
  }
  return (
    <>
      <Button onClick={run}>导入 OEM 模板</Button>
      {error && <span className="text-sm text-danger-600">{error}</span>}
    </>
  );
}

/** 新建工作项：选类型（有已发布流程的才可选）、填名称和选项字段、按角色选人。 */
type Lines = Space["businessLines"];

function CreateWorkItem({
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
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const type = types.find((t) => t.id === typeId) ?? types[0];
  if (!type) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={title ?? label} className="max-w-2xl">
        <div className="flex flex-col gap-4">
          {types.length > 1 && (
            <Field label="类型">
              <Select value={type.id} onChange={(e) => setTypeId(e.target.value)}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <CreateWorkItemForm
            key={type.id}
            type={type}
            members={members}
            lines={lines}
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
  onCancel,
}: {
  type: ItemType;
  members: PickerMember[];
  lines: Lines;
  onCancel: () => void;
}) {
  const typeFields = withLineOptions(type.fields, lines);
  const zero = useZero();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  // 一个类型有多套已发布的流程（如 OEM、ODM、包装变更）时，新建时选用哪套
  const flows = type.flowTemplates.filter((t) => t.currentVersionId);
  const [templateId, setTemplateId] = useState(flows[0]?.id ?? "");
  // 用户动过的字段；没动过的字段按默认值规则补上（条件默认值随别的字段变化）
  const [touched, setTouched] = useState<Record<string, FieldInputValue>>({});
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
  const [touchedRoles, setTouchedRoles] = useState<Record<string, string[]>>({});
  const [overrides, setOverrides] = useState<{ added: string[]; removed: string[] }>({ added: [], removed: [] });
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
    if (!field || ["formula", "relation", "signal", "multiSignal"].includes(field.dataType)) return [];
    if (states[field.key]?.visible === false || (item.showWhen && !evaluate(item.showWhen, view))) return [];
    return [{ item, field }];
  });

  async function create(event: FormEvent) {
    event.preventDefault();
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
        <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
      </Field>
      {createItems.length > 0 && (
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {createItems.map(({ item, field: f }, i) =>
            !f ? (
              <p
                // biome-ignore lint/suspicious/noArrayIndexKey: 提示文字没有 id，按位置渲染
                key={i}
                role="note"
                className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-600 sm:col-span-2"
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
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit">创建</Button>
      </div>
    </form>
  );
}
