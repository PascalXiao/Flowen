import { queries } from "@fp/sync";
import { useQuery } from "@rocicorp/zero/react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChartColumn, ChevronsUpDown, House, Inbox, KeyRound, LogOut, Settings } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { NotificationsBell } from "@/components/NotificationsBell";
import { SearchDialog } from "@/components/SearchDialog";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth";
import { cn } from "@/lib/utils";

/** 当前所在的空间。工作项、类型这些页面没有空间参数，加载后把自己的空间报上来，左侧导航跟着切换。 */
const ActiveSpace = createContext<(spaceId: string | undefined) => void>(() => {});

/** 报告当前页面所在的空间：null 表示不在任何空间里（如“我的空间”），undefined 表示还没加载出来、先不变。 */
export function useActiveSpace(spaceId: string | null | undefined) {
  const set = useContext(ActiveSpace);
  useEffect(() => {
    if (spaceId !== undefined) set(spaceId ?? undefined);
  }, [spaceId, set]);
}

/** 应用外框：左侧导航（空间切换、空间内的功能入口、通知和账号），右侧是页面。 */
export function AppShell({ user, children }: { user: { id: string; name: string }; children: ReactNode }) {
  const [spaceId, setSpaceId] = useState<string | undefined>();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const fullScreen = /\/setting\/(workObject\/[^/]+|advanced)/.test(pathname);
  return (
    <ActiveSpace.Provider value={setSpaceId}>
      <div className="flex h-full">
        {!fullScreen && <Sidebar spaceId={spaceId} user={user} pathname={pathname} />}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-auto">{children}</main>
      </div>
    </ActiveSpace.Provider>
  );
}

/** 导航项；当前页由 Link 标上 data-status="active"。 */
const navItem =
  "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-fg hover:bg-hover [&_svg]:size-4 [&_svg]:text-fg-muted data-[status=active]:bg-brand-50 data-[status=active]:font-medium data-[status=active]:text-brand-500 data-[status=active]:[&_svg]:text-brand-500";

function Sidebar({
  spaceId,
  user,
  pathname,
}: {
  spaceId: string | undefined;
  user: { id: string; name: string };
  pathname: string;
}) {
  const [spaces] = useQuery(queries.spaces.mine());
  const [space] = useQuery(spaceId ? queries.spaces.byId({ id: spaceId }) : undefined);
  const navigate = useNavigate();

  return (
    <nav aria-label="主导航" className="flex w-56 shrink-0 flex-col border-r border-line-subtle bg-surface">
      <div className="flex h-14 items-center gap-2 px-4">
        <span className="flex size-6 items-center justify-center rounded-md bg-brand-500 text-xs font-bold text-white">
          F
        </span>
        <span className="font-semibold">Flowen</span>
      </div>

      <div className="flex flex-col gap-0.5 px-3 pb-2">
        <SearchDialog className={cn(navItem, "w-full cursor-pointer")} />
        <Link to="/my-work" className={navItem}>
          <Inbox />
          我的工作
        </Link>
      </div>

      <div className="px-3 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="切换空间"
            className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-line-subtle px-2 text-left hover:bg-hover"
          >
            {space ? (
              <>
                <span className="flex size-5 shrink-0 items-center justify-center rounded bg-violet-50 text-xs text-violet-600">
                  {space.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{space.name}</span>
              </>
            ) : (
              <span className="flex-1 text-fg-muted">选择空间</span>
            )}
            <ChevronsUpDown className="size-3.5 shrink-0 text-fg-subtle" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-52">
            <DropdownMenuLabel>我的空间</DropdownMenuLabel>
            {spaces.map((s) => (
              <DropdownMenuItem key={s.id} asChild>
                <Link to="/spaces/$spaceId" params={{ spaceId: s.id }}>
                  <span className="truncate">{s.name}</span>
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/">
                <House />
                全部空间
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {space ? (
          <>
            <Link to="/spaces/$spaceId/overview" params={{ spaceId: space.id }} className={navItem}>
              <ChartColumn />
              仪表盘
            </Link>
            <Link
              to="/spaces/$spaceId/setting/$tab"
              params={{ spaceId: space.id, tab: "basicInfo" }}
              className={cn(
                navItem,
                pathname.startsWith(`/spaces/${space.id}/setting`) &&
                  "bg-brand-50 font-medium text-brand-500 [&_svg]:text-brand-500",
              )}
            >
              <Settings />
              空间配置
            </Link>
            {/* 每个工作项一个入口，点进去是它的主页（工作项列表 / 视图列表） */}
            <section aria-label="工作项" className="flex flex-col gap-0.5">
              {space.workItemTypes.map((t) => (
                <Link
                  key={t.id}
                  to="/spaces/$spaceId/$typeKey"
                  params={{ spaceId: space.id, typeKey: t.key }}
                  activeOptions={{ includeSearch: false }}
                  className={navItem}
                >
                  <span
                    aria-hidden
                    className="flex size-4 shrink-0 items-center justify-center rounded bg-brand-500 text-[10px] font-medium text-white"
                  >
                    {t.name.slice(0, 1)}
                  </span>
                  <span className="truncate">{t.name}</span>
                </Link>
              ))}
            </section>
          </>
        ) : (
          <Link to="/" className={navItem}>
            <House />
            我的空间
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-0.5 border-t border-line-subtle p-3">
        <NotificationsBell />
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="账号" className={cn(navItem, "w-full cursor-pointer")}>
            <Avatar name={user.name} id={user.id} size={20} />
            <span className="truncate">{user.name}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end">
            <DropdownMenuItem onSelect={() => navigate({ to: "/settings/api" })}>
              <KeyRound />
              开放接口
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => authClient.signOut()}>
              <LogOut />
              退出
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
