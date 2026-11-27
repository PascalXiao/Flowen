import { AUDIT_CATEGORIES, AUDIT_RETENTION_DAYS, type AuditEntry, auditActionLabel } from "@fp/sync";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, SearchInput, Select } from "@/components/ui/input";
import { EmptyState, ErrorBanner } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const time = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

/** 详情里值的显示：数组、对象压成一行。 */
const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/**
 * 审计日志表：按时间倒序，可按分类、操作人、时间范围筛选和搜索，点一行展开看参数。
 * 企业管理页看全部空间；空间配置的「操作记录」页签传 spaceId，只看这个空间。
 */
export function AuditLog({
  spaceId,
  teamId,
  people,
}: {
  spaceId?: string;
  /** 只看这个团队的操作记录。 */
  teamId?: string;
  /** 操作人筛选的候选。 */
  people: readonly { id: string; name: string }[];
}) {
  const [category, setCategory] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const scoped = !!(spaceId || teamId);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before?: number) => {
      setError(null);
      const params = new URLSearchParams();
      if (spaceId) params.set("spaceId", spaceId);
      if (teamId) params.set("teamId", teamId);
      if (category) params.set("category", category);
      if (actor) params.set("actor", actor);
      if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
      if (to) params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
      if (q.trim()) params.set("q", q.trim());
      if (before) params.set("before", String(before));
      const res = await api(`/api/audit?${params}`);
      const body = (await res.json()) as { entries: AuditEntry[]; next: number | null; error?: string };
      if (!res.ok) return setError(body.error ?? "加载失败。");
      setEntries((prev) => (before ? [...(prev ?? []), ...body.entries] : body.entries));
      setNext(body.next);
    },
    [spaceId, teamId, category, actor, from, to, q],
  );
  useEffect(() => {
    const timer = setTimeout(() => load(), q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  return (
    <div className="flex flex-col gap-3">
      <div className={cn("flex flex-wrap items-center gap-2", teamId && "hidden")}>
        <Select aria-label="分类" className="w-32" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">全部分类</option>
          {Object.entries(AUDIT_CATEGORIES)
            .filter(([key]) => !spaceId || !["team", "org", "account"].includes(key))
            .map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
        </Select>
        <Select aria-label="操作人" className="w-36" value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">全部操作人</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Input
          aria-label="开始日期"
          type="date"
          className="w-36"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <span className="text-fg-subtle">~</span>
        <Input aria-label="结束日期" type="date" className="w-36" value={to} onChange={(e) => setTo(e.target.value)} />
        <SearchInput
          aria-label="搜索操作或对象"
          placeholder="搜索操作或对象"
          className="w-52"
          value={q}
          onChange={setQ}
        />
        <span className="ml-auto text-fg-subtle text-xs">保留最近 {AUDIT_RETENTION_DAYS} 天</span>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {entries?.length === 0 ? (
        <EmptyState title="没有符合条件的记录" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line-subtle">
          <table aria-label="审计日志" className="w-full min-w-[720px] text-sm">
            <thead className="bg-raised text-fg-muted text-xs">
              <tr className="h-8 text-left">
                <th className="w-6" />
                <th className="w-40 px-2 font-medium">时间</th>
                <th className="w-32 px-2 font-medium">操作人</th>
                <th className="w-24 px-2 font-medium">分类</th>
                <th className="px-2 font-medium">操作</th>
                <th className="px-2 font-medium">对象</th>
                {!scoped && <th className="px-2 font-medium">空间</th>}
                <th className="w-28 px-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {entries?.map((e) => (
                <Fragment key={e.id}>
                  <tr
                    className="h-9 cursor-pointer border-line-subtle border-t hover:bg-hover"
                    onClick={() => setOpen(open === e.id ? null : e.id)}
                  >
                    <td className="pl-2 text-fg-subtle">
                      {e.detail ? (
                        open === e.id ? (
                          <ChevronDown className="size-3.5" />
                        ) : (
                          <ChevronRight className="size-3.5" />
                        )
                      ) : null}
                    </td>
                    <td className="px-2 text-fg-muted tabular-nums">{time(e.at)}</td>
                    <td className="px-2">
                      {e.actor ? (
                        <span className="flex items-center gap-1.5">
                          <Avatar id={e.actor} name={e.actorName ?? "?"} size={18} />
                          <span className="truncate">{e.actorName ?? "已删除的用户"}</span>
                        </span>
                      ) : (
                        <span className="text-fg-subtle">系统</span>
                      )}
                    </td>
                    <td className="px-2">
                      <Tag>{AUDIT_CATEGORIES[e.category as keyof typeof AUDIT_CATEGORIES] ?? e.category}</Tag>
                    </td>
                    <td className="px-2">{auditActionLabel(e.action)}</td>
                    <td className="max-w-64 truncate px-2 text-fg-muted">{e.targetName ?? "—"}</td>
                    {!scoped && <td className="max-w-40 truncate px-2 text-fg-muted">{e.spaceName ?? "—"}</td>}
                    <td className="px-2 text-fg-subtle text-xs tabular-nums">{e.ip ?? "—"}</td>
                  </tr>
                  {open === e.id && e.detail && (
                    <tr className="bg-canvas">
                      <td />
                      <td colSpan={scoped ? 6 : 7} className="px-2 py-2">
                        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs">
                          {Object.entries(e.detail).map(([k, v]) => (
                            <Fragment key={k}>
                              <dt className="text-fg-subtle">{k}</dt>
                              <dd className="break-all font-mono text-fg-muted">{show(v)}</dd>
                            </Fragment>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && (
        <Button variant="outline" className="self-center" onClick={() => load(next)}>
          加载更多
        </Button>
      )}
    </div>
  );
}
