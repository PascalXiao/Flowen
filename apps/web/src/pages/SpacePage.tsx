import { clockFor, mutators, queries, usesClock, type WorkItemFilterArgs } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, Columns3, GanttChartSquare, List, ListTree } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { Board } from "@/components/Board";
import { CreateWorkItem } from "@/components/CreateWorkItem";
import { FilterBar } from "@/components/FilterBar";
import { ImportDialog } from "@/components/ImportDialog";
import type { PickerMember } from "@/components/RolePicker";
import { SpaceGantt } from "@/components/SpaceGantt";
import { TreeView } from "@/components/TreeView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { Sheet } from "@/components/ui/sheet";
import { Segmented, Tabs } from "@/components/ui/tabs";
import { type ListDisplay, WorkItemList } from "@/components/WorkItemList";
import { env } from "@/lib/env";
import { withLineOptions } from "@/lib/fields";
import { useWithTeams } from "@/lib/org";
import { foreignTypes, spaceRelationDefs } from "@/lib/relations";
import { WorkItemView } from "@/pages/WorkItemPage";

const NO_CALENDAR = { holidays: [], extraWorkdays: [] };
const contentArea = () => document.querySelector("main");

type Space = NonNullable<QueryResultType<ReturnType<typeof queries.spaces.byId>>>;
type ItemType = Space["workItemTypes"][number];

/**
 * 工作项主页（左侧导航里的一个工作项，如「项目」「缺陷」）：
 * 「工作项列表」页签是这种类型的列表和统计，「视图列表」页签是这种类型保存过的视图。
 */
export function WorkItemHomePage() {
  const { spaceId, typeKey } = useParams({ from: "/app/spaces/$spaceId/$typeKey" });
  const { tab, view: viewId, item: openItem, itemTab } = useSearch({ from: "/app/spaces/$spaceId/$typeKey" });
  const navigate = useNavigate();
  const zero = useZero();
  const [space, spaceResult] = useQuery(queries.spaces.byId({ id: spaceId }));
  // 列表当前显示的工作项顺序：抽屉里「上一条 / 下一条」按它走
  const [rowIds, setRowIds] = useState<readonly string[]>([]);
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
        title={type.settings?.disabled ? `${type.name}（已停用）` : type.name}
        actions={
          published &&
          myRole !== "guest" &&
          !type.settings?.disabled && (
            <div className="flex items-center gap-2">
              <ImportDialog type={type} lines={space.businessLines} members={members} spaceName={space.name} />
              <CreateWorkItem
                types={[type]}
                members={members.filter((m) => space.members.find((x) => x.userId === m.userId)?.role !== "guest")}
                lines={space.businessLines}
                label="新建"
                title={`新建${type.name}`}
              />
            </div>
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
        <Sheet
          open
          width="72%"
          label="工作项详情"
          // 只盖住内容区，左侧导航还能看见、能点
          within={contentArea}
          title={
            <span className="flex items-center gap-3 text-sm font-normal">
              <DrawerStepper
                ids={rowIds}
                current={openItem}
                onGo={(id) => navigate({ to: ".", search: (prev) => ({ ...prev, item: id, itemTab: undefined }) })}
              />
              <Link
                to="/spaces/$spaceId/$typeKey/detail/$itemId"
                params={{ spaceId, typeKey, itemId: openItem }}
                className="text-accent"
              >
                全屏打开
              </Link>
            </span>
          }
          onClose={() => navigate({ to: ".", search: (prev) => ({ ...prev, item: undefined, itemTab: undefined }) })}
        >
          <WorkItemView
            key={`${openItem}-${itemTab ?? ""}`}
            itemId={openItem}
            {...(itemTab && { initialTab: itemTab })}
          />
        </Sheet>
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
          <div className="rounded-xl border border-dashed border-line">
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
            onRows={setRowIds}
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
  const [scope, setScope] = useState<"all" | "public" | "personal" | "mine">("all");
  const [q, setQ] = useState("");
  const shown = views.filter(
    (v) =>
      (scope === "all" || (scope === "mine" ? v.createdBy === zero.userID : (v.visibility ?? "public") === scope)) &&
      v.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Tabs
          label="视图范围"
          value={scope}
          onChange={setScope}
          items={[
            ["all", "全部视图"],
            ["public", "公共视图"],
            ["personal", "个人视图"],
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
              <th className="py-2 font-normal">说明</th>
              <th className="py-2 font-normal">类型</th>
              <th className="py-2 font-normal">可见范围</th>
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
                    className="cursor-pointer text-fg hover:text-accent"
                  >
                    {v.name}
                  </button>
                </td>
                <td className="max-w-80 truncate py-2 text-fg-muted" title={v.description ?? undefined}>
                  {v.description || "—"}
                </td>
                <td className="py-2 text-fg-muted">{v.kind === "fixed" ? "固定视图" : "条件视图"}</td>
                <td className="py-2 text-fg-muted">
                  {v.visibility === "personal"
                    ? `个人${v.members.length ? `（${v.members.length} 位协作者）` : ""}`
                    : "公共"}
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
  onRows,
}: {
  space: Space;
  type: ItemType;
  view: SavedView | undefined;
  views: readonly SavedView[];
  members: PickerMember[];
  isAdmin: boolean;
  onRows?: (ids: readonly string[]) => void;
}) {
  const [filter, setFilter] = useState<WorkItemFilterArgs>({
    ...(initialView?.filter ?? {}),
    typeIds: [type.id],
  });
  const zero = useZero();
  const withTeams = useWithTeams();
  const [rows, setRows] = useState<readonly string[]>([]);
  const reportRows = useCallback(
    (ids: readonly string[]) => {
      setRows(ids);
      onRows?.(ids);
    },
    [onRows],
  );
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
      roles: type.roles,
    },
  ];
  // 动态时间（本周、过去 N 天…）按空间时区的今天算，查询时带上
  // 条件里选了团队时，带上团队成员名单
  const queryFilter = withTeams(
    usesClock(filter) ? { ...filter, clock: clockFor(space.timezone ?? "Asia/Shanghai") } : filter,
  );
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
  const filterBar = (slots?: { tools: ReactNode; search: ReactNode }) => (
    <FilterBar
      spaceId={space.id}
      filter={filter}
      onChange={setFilter}
      types={types}
      members={members.map((m) => ({ id: m.userId, name: m.name }))}
      views={views.map((v) => ({ ...v, filter: v.filter ?? {} }))}
      isAdmin={isAdmin}
      isGuest={space.members.find((m) => m.userId === zero.userID)?.role === "guest"}
      fixedTypeId={type.id}
      quick={display.quick ?? []}
      onQuick={(quick) => setDisplay({ ...display, quick })}
      rowIds={rows}
      display={display}
      onView={(v) => v.display && setDisplay(v.display as ListDisplay)}
      actions={viewSwitch}
      tools={slots?.tools}
      search={slots?.search}
    />
  );

  return (
    <div className="flex min-h-0 flex-col">
      {view !== "table" && <div className="mb-3">{filterBar()}</div>}
      {view === "tree" ? (
        <TreeView
          spaceId={space.id}
          filter={queryFilter}
          relationDefs={spaceRelationDefs(space).map((d) => {
            const name = (id: string) =>
              [...space.workItemTypes, ...foreignTypes(space)].find((x) => x.id === id)?.name ?? "?";
            return { id: d.id, name: d.name, fromType: name(d.fromTypeId), toType: name(d.toTypeId) };
          })}
          hierarchies={space.hierarchies}
          typeId={type.id}
          timeZone={space.timezone ?? "Asia/Shanghai"}
          types={space.workItemTypes.map((t) => ({
            id: t.id,
            name: t.name,
            definitions: t.flowTemplates.flatMap((f) => (f.currentVersion ? [f.currentVersion.definition] : [])),
            fields: t.fields,
            roles: t.roles,
          }))}
          members={members.map((m) => ({ id: m.userId, name: m.name }))}
        />
      ) : view === "board" ? (
        <Board
          spaceId={space.id}
          filter={queryFilter}
          types={types}
          fields={withLineOptions(type.fields, space.businessLines)}
          roles={type.roles}
          userName={(id) => members.find((m) => m.userId === id)?.name ?? id}
          display={display.board}
          onDisplay={(board) => setDisplay({ ...display, board })}
          guest={space.members.find((m) => m.userId === zero.userID)?.role === "guest"}
        />
      ) : view === "gantt" ? (
        <div className="p-4">
          <SpaceGantt
            spaceId={space.id}
            timeZone={space.timezone ?? "Asia/Shanghai"}
            calendar={space.calendar ?? NO_CALENDAR}
            filter={queryFilter}
          />
        </div>
      ) : (
        <WorkItemList
          space={space}
          filter={queryFilter}
          display={display}
          onDisplay={setDisplay}
          toolbar={filterBar}
          fixedViews={views.filter(
            (v) =>
              v.kind === "fixed" &&
              (isAdmin ||
                v.createdBy === zero.userID ||
                v.members.some((m) => m.userId === zero.userID && m.role === "edit")),
          )}
          onRows={reportRows}
        />
      )}
    </div>
  );
}

/** 抽屉标题里的「上一条 / 下一条」：按列表当前的顺序切换抽屉里的工作项。 */
function DrawerStepper({
  ids,
  current,
  onGo,
}: {
  ids: readonly string[];
  current: string;
  onGo: (id: string) => void;
}) {
  const index = ids.indexOf(current);
  const prev = index > 0 ? ids[index - 1] : undefined;
  const next = index >= 0 && index < ids.length - 1 ? ids[index + 1] : undefined;
  if (index < 0) return null;
  return (
    <span className="flex items-center gap-1">
      <Button size="icon-sm" variant="ghost" aria-label="上一条" disabled={!prev} onClick={() => prev && onGo(prev)}>
        <ChevronUp />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="下一条" disabled={!next} onClick={() => next && onGo(next)}>
        <ChevronDown />
      </Button>
      <span className="text-xs tabular-nums text-fg-subtle">
        {index + 1} / {ids.length}
      </span>
    </span>
  );
}

export function ImportDemo({ spaceId }: { spaceId: string }) {
  const [error, setError] = useState<string | null>(null);
  async function run() {
    const res = await fetch(`${env.apiUrl}/api/spaces/${spaceId}/import-demo`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) setError(((await res.json()) as { error: string }).error);
  }
  return (
    <>
      <Button onClick={run}>导入示例模板</Button>
      {error && <span className="text-sm text-danger-600">{error}</span>}
    </>
  );
}
