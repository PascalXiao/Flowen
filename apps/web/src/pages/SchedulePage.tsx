import {
  type Day,
  dayFromDate,
  dayInTimeZone,
  dayToIso,
  FlowGraph,
  nodeFlowOf,
  type PersonSchedule,
  peopleSchedule,
  type ScheduleNode,
  WorkCalendar,
} from "@fp/engine";
import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { GanttChart, type GanttRow } from "@/components/GanttChart";
import { Avatar } from "@/components/ui/avatar";
import { Select } from "@/components/ui/input";
import { EmptyState, ErrorBanner, PageBody, PageHeader } from "@/components/ui/page";

const NO_CALENDAR = { holidays: [], extraWorkdays: [] };
const fmt = (n: number) => n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

/**
 * 人员排期（对照飞书项目的人员排期视图）：人 × 时间。每人一组，组里是他负责的节点排期条，
 * 左边一张表看每人的已排期项、总估分和未排期的节点。能改排期的人可以直接拖动横条。
 */
export function SchedulePage() {
  const { spaceId } = useParams({ from: "/app/spaces/$spaceId/schedule" });
  useActiveSpace(spaceId);
  const zero = useZero();
  const me = String(zero.userID);
  const [space] = useQuery(queries.spaces.byId({ id: spaceId }));
  const [typeId, setTypeId] = useState("");
  const [person, setPerson] = useState("");
  const [withCompleted, setWithCompleted] = useState("");
  const filter = useMemo(() => (typeId ? { typeIds: [typeId] } : {}), [typeId]);
  const [items] = useQuery(queries.workItems.plansBySpace({ spaceId, filter }));
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const timeZone = space?.timezone ?? "Asia/Shanghai";
  const calendar = useMemo(() => WorkCalendar.fromConfig(space?.calendar ?? NO_CALENDAR), [space?.calendar]);
  const role = space?.members.find((m) => m.userId === me)?.role;
  const nameOf = (id: string) => space?.members.find((m) => m.userId === id)?.user?.name ?? "—";

  const people = useMemo(() => {
    const graphs = new Map<string, FlowGraph>();
    const nodes: ScheduleNode[] = [];
    for (const item of items) {
      if (item.status === "terminated") continue;
      const definition = nodeFlowOf(item.flowVersion?.definition);
      if (!item.flowVersion || !definition) continue;
      let graph = graphs.get(item.flowVersion.id);
      if (!graph) {
        graph = new FlowGraph(definition);
        graphs.set(item.flowVersion.id, graph);
      }
      for (const n of item.nodes) {
        if (!graph.has(n.nodeKey)) continue;
        nodes.push({
          workItemId: item.id,
          workItemName: item.name,
          nodeKey: n.nodeKey,
          nodeName: graph.node(n.nodeKey).name,
          state: n.state ?? "notStarted",
          owners: n.owners ?? [],
          start: n.plannedStart == null ? null : dayFromDate(n.plannedStart),
          end: n.plannedEnd == null ? null : dayFromDate(n.plannedEnd),
          points: n.points ?? null,
        });
      }
    }
    return peopleSchedule(nodes, { includeCompleted: !!withCompleted });
  }, [items, withCompleted]);
  const shown = person ? people.filter((p) => p.userId === person) : people;

  const rows: GanttRow[] = [];
  for (const p of shown) {
    if (p.scheduled.length === 0) continue;
    const open = !collapsed.has(p.userId);
    rows.push({
      key: p.userId,
      label: `${nameOf(p.userId)} · ${p.scheduled.length} 项 · ${fmt(p.points)} 人天`,
      start: Math.min(...p.scheduled.map((e) => e.start ?? 0)),
      end: Math.max(...p.scheduled.map((e) => e.end ?? 0)),
      state: "inProgress",
      pinned: false,
      milestone: false,
      actualStart: null,
      actualEnd: null,
      editable: false,
      summary: true,
      expanded: open,
    });
    if (open)
      for (const e of p.scheduled)
        rows.push({
          key: `${p.userId}|${e.workItemId}/${e.nodeKey}`,
          label: `${e.workItemName} · ${e.nodeName}${e.share != null ? ` · ${fmt(e.share)}` : ""}`,
          start: e.start ?? 0,
          end: e.end ?? 0,
          state: e.state,
          pinned: false,
          milestone: false,
          actualStart: null,
          actualEnd: null,
          editable: role !== "guest" && e.state !== "completed" && (role === "admin" || e.owners.includes(me)),
          depth: 1,
        });
  }

  async function plan(key: string, start: Day, end: Day) {
    const [workItemId, nodeKey] = (key.split("|")[1] ?? "").split("/") as [string, string];
    setError(null);
    const { client, server } = zero.mutate(
      mutators.node.setPlan({ workItemId, nodeKey, start: dayToIso(start), end: dayToIso(end) }),
    );
    for (const outcome of [await client, await server])
      if (outcome.type === "error") return setError(outcome.error.message);
  }

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  if (!space) return null;
  return (
    <>
      <PageHeader
        title="人员排期"
        breadcrumb={space.name}
        actions={
          <div className="flex items-center gap-2">
            <Select aria-label="人员" value={person} onChange={(e) => setPerson(e.target.value)} className="w-32">
              <option value="">全部人员</option>
              {space.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === me ? `${m.user?.name ?? "我"}（我）` : (m.user?.name ?? "—")}
                </option>
              ))}
            </Select>
            <Select aria-label="数据来源" value={typeId} onChange={(e) => setTypeId(e.target.value)} className="w-32">
              <option value="">全部工作项</option>
              {space.workItemTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="节点范围"
              value={withCompleted}
              onChange={(e) => setWithCompleted(e.target.value)}
              className="w-32"
            >
              <option value="">未完成的节点</option>
              <option value="1">含已完成节点</option>
            </Select>
          </div>
        }
      />
      <PageBody className="flex flex-col gap-4">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {shown.length === 0 ? (
          <div className="rounded-lg border border-line-subtle bg-surface">
            <EmptyState title="还没有人负责节点" description="在工作项的节点上指定负责人、填写排期后，会出现在这里。" />
          </div>
        ) : (
          <>
            <PeopleTable people={shown} nameOf={nameOf} />
            {rows.length > 0 && (
              <div className="h-[520px] rounded-lg border border-line-subtle bg-surface">
                <GanttChart
                  rows={rows}
                  deps={[]}
                  calendar={calendar}
                  today={dayInTimeZone(Date.now(), timeZone)}
                  onChange={plan}
                  onToggle={toggle}
                  labelTitle="人员 / 排期项"
                />
              </div>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}

/** 每人一行：已排期项、总估分、未排期的节点（展开看是哪些，点名称去填）。 */
function PeopleTable({ people, nameOf }: { people: readonly PersonSchedule[]; nameOf: (id: string) => string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto rounded-lg border border-line-subtle bg-surface">
      <table aria-label="排期人员" className="w-full text-sm">
        <thead className="text-left text-xs text-fg-muted">
          <tr className="border-b border-line-subtle">
            <th className="h-9 px-4 font-normal">人员</th>
            <th className="text-right font-normal">已排期项</th>
            <th className="text-right font-normal">总估分（人天）</th>
            <th className="px-4 text-right font-normal">未排期</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <PersonRow
              key={p.userId}
              person={p}
              name={nameOf(p.userId)}
              open={open === p.userId}
              onToggle={() => setOpen(open === p.userId ? null : p.userId)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonRow({
  person: p,
  name,
  open,
  onToggle,
}: {
  person: PersonSchedule;
  name: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-line-subtle last:border-0">
        <td className="h-10 px-4">
          <span className="inline-flex items-center gap-2">
            <Avatar name={name} size={22} />
            {name}
          </span>
        </td>
        <td className="text-right tabular-nums">{p.scheduled.length}</td>
        <td className="text-right tabular-nums">{fmt(p.points)}</td>
        <td className="px-4 text-right tabular-nums">
          {p.unscheduled.length === 0 ? (
            <span className="text-fg-subtle">0</span>
          ) : (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${name} 未排期 ${p.unscheduled.length} 项`}
              className="cursor-pointer text-warning-600 hover:underline"
              onClick={onToggle}
            >
              {p.unscheduled.length} 项
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-line-subtle bg-canvas">
          <td colSpan={4} className="px-4 py-2">
            <ul aria-label={`${name}的未排期节点`} className="flex flex-col gap-1 text-sm">
              {p.unscheduled.map((e) => (
                <li key={`${e.workItemId}/${e.nodeKey}`} className="flex gap-2">
                  <Link
                    to="/items/$itemId"
                    params={{ itemId: e.workItemId }}
                    className="text-brand-500 hover:underline"
                  >
                    {e.workItemName}
                  </Link>
                  <span className="text-fg-muted">· {e.nodeName}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}
