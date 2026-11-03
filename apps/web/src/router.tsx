import { createRootRoute, createRoute, createRouter, Navigate, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { FlowDemo } from "@/flow-demo/FlowDemo";
import { authClient } from "@/lib/auth";
import { ZeroRoot } from "@/lib/zero";
import { AdvancedConfigPage } from "@/pages/AdvancedConfigPage";
import { ApiTokensPage } from "@/pages/ApiTokensPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { LoginPage } from "@/pages/LoginPage";
import { MyWorkPage } from "@/pages/MyWorkPage";
import { WorkItemHomePage } from "@/pages/SpacePage";
import { SpaceSettingsPage } from "@/pages/SpaceSettingsPage";
import { SpacesPage } from "@/pages/SpacesPage";
import { TemplateEditorPage } from "@/pages/TemplateEditorPage";
import { TYPE_MENU_TABS, type TypeMenuTab, TypePage } from "@/pages/TypePage";
import { ItemRedirect, WorkItemPage } from "@/pages/WorkItemPage";

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage });

/** 不需要登录的引擎演示页：纯前端点着走 OEM 流程。 */
const demoRoute = createRoute({ getParentRoute: () => rootRoute, path: "/demo", component: FlowDemo });

/** 需要登录的部分：没登录跳到登录页；登录后挂上 Zero。 */
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppLayout });

function AppLayout() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <p className="p-6 text-sm text-fg-subtle">加载中…</p>;
  if (!session) return <Navigate to="/login" />;
  return (
    <ZeroRoot userID={session.user.id}>
      <AppShell user={session.user}>
        <Outlet />
      </AppShell>
    </ZeroRoot>
  );
}

const spacesRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: SpacesPage });

/*
 * 空间里的页面按飞书项目的结构：
 *   /spaces/:space/overview                         仪表盘（空间首页）
 *   /spaces/:space/:type                            工作项主页（工作项列表 / 视图列表），?item= 在抽屉里打开一条
 *   /spaces/:space/:type/detail/:item               一条工作项的完整详情页
 *   /spaces/:space/setting/:tab                     空间配置（空间信息、工作项、权限、关联、自动化）
 *   /spaces/:space/setting/workObject/:type         某个工作项的配置（基本信息、字段、页面布局、流程、角色）
 *   /spaces/:space/setting/workObject/:type/workflow/:template  流程编辑器
 */
const spaceIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceId",
  component: SpaceIndex,
});
function SpaceIndex() {
  const { spaceId } = spaceIndexRoute.useParams();
  return <Navigate to="/spaces/$spaceId/overview" params={{ spaceId }} replace />;
}
const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceId/overview",
  component: DashboardPage,
});
const typeHomeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceId/$typeKey",
  component: WorkItemHomePage,
  // ?tab=views 看视图列表；?view= 套用一个视图；?item= 在右侧抽屉里打开一个工作项
  validateSearch: (search: Record<string, unknown>): { tab?: "views"; view?: string; item?: string } => ({
    ...(search.tab === "views" && { tab: "views" as const }),
    ...(typeof search.view === "string" && { view: search.view }),
    ...(typeof search.item === "string" && { item: search.item }),
  }),
});
const itemRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceId/$typeKey/detail/$itemId",
  component: WorkItemPage,
});
const settingIndexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceId/setting",
  component: SettingIndex,
});
function SettingIndex() {
  const { spaceId } = settingIndexRoute.useParams();
  return <Navigate to="/spaces/$spaceId/setting/$tab" params={{ spaceId, tab: "basicInfo" }} replace />;
}
const settingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceId/setting/$tab",
  component: SpaceSettingsPage,
});
const advancedRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceId/setting/advanced",
  component: AdvancedConfigPage,
});
const typeSettingRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceId/setting/workObject/$typeKey",
  component: TypePage,
  validateSearch: (search: Record<string, unknown>): { menuTab?: TypeMenuTab } => ({
    ...(typeof search.menuTab === "string" &&
      (TYPE_MENU_TABS as readonly string[]).includes(search.menuTab) && { menuTab: search.menuTab as TypeMenuTab }),
  }),
});
const templateRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/spaces/$spaceId/setting/workObject/$typeKey/workflow/$templateId",
  component: TemplateEditorPage,
});
const myWorkRoute = createRoute({ getParentRoute: () => appRoute, path: "/my-work", component: MyWorkPage });
const apiTokensRoute = createRoute({ getParentRoute: () => appRoute, path: "/settings/api", component: ApiTokensPage });
/** 只知道工作项 id 的链接（通知、搜索、旧地址）：查到所属空间和类型后跳到详情页。 */
const itemByIdRoute = createRoute({ getParentRoute: () => appRoute, path: "/items/$itemId", component: ItemRedirect });

const routeTree = rootRoute.addChildren([
  loginRoute,
  demoRoute,
  appRoute.addChildren([
    spacesRoute,
    myWorkRoute,
    apiTokensRoute,
    spaceIndexRoute,
    dashboardRoute,
    settingIndexRoute,
    advancedRoute,
    settingRoute,
    typeSettingRoute,
    templateRoute,
    typeHomeRoute,
    itemRoute,
    itemByIdRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
