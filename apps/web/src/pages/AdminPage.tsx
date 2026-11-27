import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { AuditLog } from "@/components/AuditLog";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { EmptyState, ErrorBanner, PageBody, PageHeader } from "@/components/ui/page";
import { Tabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { useIsOrgAdmin } from "@/lib/org";

const ADMIN_TABS = [
  ["members", "成员"],
  ["audit", "审计日志"],
] as const;
type AdminTab = (typeof ADMIN_TABS)[number][0];

/**
 * 企业管理：成员（所有注册的人，设置企业管理员）和审计日志（所有空间的配置、成员、权限、
 * 模板、团队、登录等操作）。只有企业管理员能进。
 */
export function AdminPage() {
  useActiveSpace(null);
  const { tab: raw } = useParams({ from: "/app/admin/$tab" });
  const tab: AdminTab = ADMIN_TABS.some(([k]) => k === raw) ? (raw as AdminTab) : "members";
  const navigate = useNavigate();
  const orgAdmin = useIsOrgAdmin();
  const [users, result] = useQuery(queries.org.users());

  return (
    <>
      <PageHeader
        title="企业管理"
        tabs={
          <Tabs
            label="企业管理"
            value={tab}
            onChange={(next) => navigate({ to: "/admin/$tab", params: { tab: next } })}
            items={ADMIN_TABS}
          />
        }
      />
      <PageBody className="max-w-6xl">
        {!orgAdmin ? (
          result.type === "complete" && <EmptyState title="只有企业管理员可以进入企业管理" />
        ) : tab === "members" ? (
          <Members users={users} />
        ) : (
          <AuditLog people={users.map((u) => ({ id: u.id, name: u.name }))} />
        )}
      </PageBody>
    </>
  );
}

function Members({ users }: { users: readonly { id: string; name: string; email: string }[] }) {
  const zero = useZero();
  const [admins] = useQuery(queries.org.admins());
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const adminIds = new Set(admins.map((a) => a.userId));
  const query = q.trim().toLowerCase();
  const shown = users.filter(
    (u) => !query || u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query),
  );

  async function toggle(userId: string, admin: boolean) {
    setError(null);
    const r = await zero.mutate(mutators.org.setAdmin({ userId, admin })).server;
    if (r.type === "error") setError(r.error.message);
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <SearchInput aria-label="搜索成员" placeholder="搜索姓名或邮箱" value={q} onChange={setQ} />
        <span className="text-fg-subtle text-sm">
          共 {users.length} 人，企业管理员 {adminIds.size} 人
        </span>
      </div>
      <p className="text-fg-muted text-sm">
        企业管理员可以管理所有团队、发布企业模板、查看所有空间的审计日志，并指定其他企业管理员。
      </p>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <ul
        aria-label="企业成员"
        className="flex flex-col divide-y divide-line-subtle rounded-lg border border-line-subtle"
      >
        {shown.map((u) => {
          const isAdmin = adminIds.has(u.id);
          return (
            <li key={u.id} className="flex h-12 items-center gap-3 px-3">
              <Avatar id={u.id} name={u.name} size={28} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm">{u.name}</span>
                <span className="truncate text-fg-subtle text-xs">{u.email}</span>
              </span>
              {isAdmin && <Tag tone="violet">企业管理员</Tag>}
              <Button
                variant={isAdmin ? "ghost" : "outline"}
                size="sm"
                className="ml-auto"
                aria-label={isAdmin ? `取消 ${u.name} 的企业管理员` : `设 ${u.name} 为企业管理员`}
                disabled={isAdmin && u.id === zero.userID && adminIds.size === 1}
                onClick={() => toggle(u.id, !isAdmin)}
              >
                {isAdmin ? "取消管理员" : "设为管理员"}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
