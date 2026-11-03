import { queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { CircleAlert, RefreshCw } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { EmptyState, ErrorBanner, PageBody, PageHeader } from "@/components/ui/page";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";
import { ImportOem } from "@/pages/SpacePage";

/** 和 apps/api/src/dashboard.ts 的返回值一致。 */
interface Dashboard {
  today: string;
  totals: {
    inProgress: number;
    completed: number;
    createdLast7Days: number;
    completedLast7Days: number;
    overdue: number;
  };
  byStage: { stage: string; count: number }[];
  byType: { typeId: string; name: string; count: number }[];
  weekly: { weekStart: string; created: number; completed: number }[];
  overdue: {
    workItemId: string;
    workItemName: string;
    nodeKey: string;
    nodeName: string;
    owners: { userId: string; name: string }[];
    plannedEnd: string;
    daysOverdue: number;
  }[];
  load: { userId: string; name: string; nodes: number; overdue: number }[];
}

/** 新建、完成两个系列的颜色（已用配色校验脚本检查过色盲区分度和对比度）。 */
const SERIES = { created: "var(--color-brand-500)", completed: "var(--color-teal-600)" } as const;

/**
 * 空间仪表盘：进行中和完成的数量、阶段和类型分布、每周新建和完成趋势、延期节点和每个人的负载。
 * 数据由服务端汇总，打开时和点刷新时取一次。
 */
export function DashboardPage() {
  const { spaceId } = useParams({ from: "/app/spaces/$spaceId/overview" });
  const [space] = useQuery(queries.spaces.byId({ id: spaceId }));
  const [typeId, setTypeId] = useState("");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const zero = useZero();
  const isAdmin = !!space?.members.some((m) => m.userId === zero.userID && m.role === "admin");
  useActiveSpace(spaceId);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = typeId ? `?type=${encodeURIComponent(typeId)}` : "";
      const res = await fetch(`${env.apiUrl}/api/spaces/${spaceId}/dashboard${query}`, { credentials: "include" });
      const body = await res.json();
      if (!res.ok) setError((body as { error: string }).error);
      else setData(body as Dashboard);
    } finally {
      setLoading(false);
    }
  }, [spaceId, typeId]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="仪表盘"
        breadcrumb={space?.name}
        actions={
          <div className="flex items-center gap-2">
            <Select aria-label="工作项类型" value={typeId} onChange={(e) => setTypeId(e.target.value)} className="w-36">
              <option value="">全部类型</option>
              {space?.workItemTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className={cn(loading && "animate-spin")} />
              刷新
            </Button>
          </div>
        }
      />
      <PageBody className="max-w-6xl">
        {space && space.workItemTypes.length === 0 && (
          <div className="rounded-lg border border-line-subtle bg-surface shadow-card">
            <EmptyState
              title="空间里还没有工作项"
              description={
                isAdmin
                  ? "可以导入 OEM v289 作为演示，也可以在空间配置里新建工作项，自己配置角色、字段和流程。"
                  : "请空间管理员先在空间配置里配置工作项。"
              }
              action={
                isAdmin && (
                  <div className="flex gap-2">
                    <ImportOem spaceId={spaceId} />
                    <Button variant="outline" asChild>
                      <Link to="/spaces/$spaceId/setting/$tab" params={{ spaceId, tab: "workObjectSetting" }}>
                        空间配置
                      </Link>
                    </Button>
                  </div>
                )
              }
            />
          </div>
        )}
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {!data && !error && <p className="text-sm text-fg-subtle">加载中…</p>}
        {data && <DashboardBody data={data} />}
      </PageBody>
    </>
  );
}

function DashboardBody({ data }: { data: Dashboard }) {
  const { totals } = data;
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="概览" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="进行中" value={totals.inProgress} note={`已完成 ${totals.completed}`} />
        <StatTile label="近 7 天新建" value={totals.createdLast7Days} />
        <StatTile label="近 7 天完成" value={totals.completedLast7Days} />
        <StatTile label="已延期" value={totals.overdue} note="有节点过了计划结束日期" alert={totals.overdue > 0} />
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ChartCard title="每周新建和完成" subtitle={`最近 ${data.weekly.length} 周，按周一开始`}>
          <WeeklyColumns weeks={data.weekly} />
        </ChartCard>
        <ChartCard title="进行中的工作项按阶段" subtitle="状态流工作项按当前状态">
          <BarList
            label="阶段分布"
            rows={data.byStage.map((r) => ({ key: r.stage, label: r.stage, value: r.count }))}
          />
        </ChartCard>
        <ChartCard title="进行中的工作项按类型">
          <BarList label="类型分布" rows={data.byType.map((r) => ({ key: r.typeId, label: r.name, value: r.count }))} />
        </ChartCard>
        <ChartCard title="负责人负载" subtitle="每人负责的进行中节点数">
          <BarList
            label="负责人负载"
            rows={data.load.map((r) => ({
              key: r.userId,
              label: r.name,
              value: r.nodes,
              note: r.overdue > 0 ? `${r.overdue} 个延期` : undefined,
            }))}
          />
        </ChartCard>
      </div>

      <ChartCard title={`延期节点 ${data.overdue.length}`} subtitle={`今天是 ${data.today}`}>
        {data.overdue.length === 0 ? (
          <p className="text-sm text-fg-subtle">没有延期的节点。</p>
        ) : (
          <table aria-label="延期节点" className="w-full text-sm">
            <thead className="text-left text-xs text-fg-muted">
              <tr className="border-b border-line-subtle">
                <th className="py-2 pr-4 font-normal">工作项</th>
                <th className="py-2 pr-4 font-normal">节点</th>
                <th className="py-2 pr-4 font-normal">负责人</th>
                <th className="py-2 pr-4 font-normal">计划结束</th>
                <th className="py-2 text-right font-normal">延期</th>
              </tr>
            </thead>
            <tbody>
              {data.overdue.map((row) => (
                <tr key={`${row.workItemId}/${row.nodeKey}`} className="border-b border-line-subtle last:border-b-0">
                  <td className="py-2 pr-4">
                    <Link to="/items/$itemId" params={{ itemId: row.workItemId }} className="hover:text-brand-500">
                      {row.workItemName}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{row.nodeName}</td>
                  <td className="py-2 pr-4 text-fg-muted">{row.owners.map((o) => o.name).join("、") || "—"}</td>
                  <td className="py-2 pr-4 tabular-nums text-fg-muted">{row.plannedEnd}</td>
                  <td className="py-2 text-right tabular-nums text-danger-600">{row.daysOverdue} 天</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ChartCard>
    </div>
  );
}

function StatTile({ label, value, note, alert }: { label: string; value: number; note?: string; alert?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line-subtle bg-surface p-4">
      <span className="flex items-center gap-1.5 text-sm text-fg-muted">
        {alert && <CircleAlert aria-hidden className="size-4 text-danger-600" />}
        {label}
      </span>
      <span className={cn("text-3xl font-semibold", alert && "text-danger-600")}>{value.toLocaleString("zh-CN")}</span>
      {note && <span className="text-xs text-fg-subtle">{note}</span>}
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface p-4">
      <div className="flex flex-col">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <span className="text-xs text-fg-subtle">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

/** 单系列横向条形图：标签、条、条尾的数值。悬停高亮当前行。 */
function BarList({
  label,
  rows,
}: {
  label: string;
  rows: { key: string; label: string; value: number; note?: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-fg-subtle">暂无数据。</p>;
  return (
    <ul aria-label={label} className="flex flex-col">
      {rows.map((r) => (
        <li
          key={r.key}
          className="group grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 rounded px-1 py-1 hover:bg-hover/50"
          title={`${r.label}：${r.value}${r.note ? `（${r.note}）` : ""}`}
        >
          <span className="truncate text-sm text-fg-muted">{r.label}</span>
          <span className="flex items-center gap-2">
            <span
              className="h-4 rounded-r-[4px] bg-brand-500 group-hover:bg-brand-600"
              style={{ width: `${(r.value / max) * 75}%`, minWidth: 2 }}
            />
            <span className="text-sm tabular-nums">{r.value}</span>
            {r.note && <span className="whitespace-nowrap text-xs text-danger-600">{r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 刻度取整：0、中间、上限。 */
function niceMax(value: number) {
  if (value <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= value) return m * step;
  return 10 * step;
}

/** 每周新建、完成的分组柱状图，悬停显示这一周的两个数，下面可以展开数据表。 */
function WeeklyColumns({ weeks }: { weeks: Dashboard["weekly"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = niceMax(Math.max(...weeks.flatMap((w) => [w.created, w.completed])));
  const ticks = [top, top / 2, 0];
  const bar = (value: number, color: string): CSSProperties => ({
    height: `${(value / top) * 100}%`,
    minHeight: value > 0 ? 2 : 0,
    background: color,
  });
  const shortDate = (iso: string) => iso.slice(5).replace("-", "/");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4 text-xs text-fg-muted">
        {(["created", "completed"] as const).map((key) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: SERIES[key] }} />
            {key === "created" ? "新建" : "完成"}
          </span>
        ))}
      </div>
      <div className="relative flex h-44 gap-2 pl-8">
        {ticks.map((t) => (
          <div
            key={t}
            className="absolute right-0 left-8 border-t border-line-subtle"
            style={{ top: `${(1 - t / top) * 100}%` }}
          >
            <span className="absolute -top-2 -left-8 w-6 text-right text-[11px] tabular-nums text-fg-subtle">{t}</span>
          </div>
        ))}
        {weeks.map((w, i) => (
          <button
            type="button"
            key={w.weekStart}
            aria-label={`${w.weekStart} 这周：新建 ${w.created}，完成 ${w.completed}`}
            className={cn(
              "relative z-10 flex flex-1 items-end justify-center gap-[2px] rounded-t",
              hover === i && "bg-hover/40",
            )}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          >
            <span className="w-full max-w-3 rounded-t-[4px]" style={bar(w.created, SERIES.created)} />
            <span className="w-full max-w-3 rounded-t-[4px]" style={bar(w.completed, SERIES.completed)} />
            {hover === i && (
              <span
                role="tooltip"
                className="absolute bottom-full z-20 mb-1 whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-popover"
              >
                <span className="block font-medium">{w.weekStart} 这周</span>
                <span className="block text-fg-muted">
                  新建 {w.created} · 完成 {w.completed}
                </span>
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="flex gap-2 pl-8 text-[11px] text-fg-subtle">
        {weeks.map((w) => (
          <span key={w.weekStart} className="flex-1 text-center tabular-nums">
            {shortDate(w.weekStart)}
          </span>
        ))}
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer select-none text-fg-muted hover:text-fg">查看数据表</summary>
        <table aria-label="每周新建和完成" className="mt-1 w-full">
          <thead className="text-left text-fg-muted">
            <tr>
              <th className="py-1 font-normal">周</th>
              <th className="py-1 text-right font-normal">新建</th>
              <th className="py-1 text-right font-normal">完成</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {weeks.map((w) => (
              <tr key={w.weekStart}>
                <td className="py-0.5">{w.weekStart}</td>
                <td className="py-0.5 text-right">{w.created}</td>
                <td className="py-0.5 text-right">{w.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
