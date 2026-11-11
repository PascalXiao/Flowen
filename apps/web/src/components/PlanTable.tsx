import { Popconfirm, Toast } from "@douyinfe/semi-ui";
import {
  baselineSlip,
  criticalPath,
  type Day,
  dayFromIso,
  dayInTimeZone,
  dayToIso,
  durationOf,
  type FlowGraph,
  type InstanceDependencies,
  type WorkCalendar,
} from "@fp/engine";
import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { useMemo, useState } from "react";
import { GanttChart, type GanttRow } from "@/components/GanttChart";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/input";
import { Tag } from "@/components/ui/tag";
import { nodeGanttRows, type PlannedNode } from "@/lib/gantt";
import { cn, newId } from "@/lib/utils";

export interface BaselineRow {
  id: string;
  name: string;
  nodes: Record<string, { start: string; end: string }>;
  createdBy: string | null;
  createdAt: number | null;
  creator?: { name: string } | null;
}

const fmt = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}-${d.getDate()}`;
};

/** 偏差：晚了标红，提前标绿，持平不标。 */
function Slip({ days }: { days: number | null }) {
  if (days === null) return <span className="text-fg-subtle">—</span>;
  if (days === 0) return <span className="text-fg-muted">持平</span>;
  return (
    <span className={cn("tabular-nums", days > 0 ? "text-danger-600" : "text-success-600")}>
      {days > 0 ? `晚 ${days} 天` : `早 ${-days} 天`}
    </span>
  );
}

/**
 * 工作项甘特图：甘特图加排期明细。
 * - 拖动横条或改日期会把节点设成「手动」，后续节点自动顺延；
 * - 关键路径：没完成、没有余量的节点标红，任何一个延期整个计划都会推迟；
 * - 基线：把当前计划存成快照，之后选一条基线对比每个节点和整体晚了几天。
 */
export function PlanTable({
  workItemId,
  graph,
  nodes,
  baselines,
  dependencies,
  timeZone,
  calendar,
  me,
  isAdmin,
  canWrite,
  canPlan,
  onPlan,
}: {
  workItemId: string;
  graph: FlowGraph;
  nodes: readonly PlannedNode[];
  baselines: readonly BaselineRow[];
  /** 工作项上加的、等本工作项节点的依赖。 */
  dependencies?: InstanceDependencies;
  timeZone: string;
  calendar: WorkCalendar;
  me: string;
  isAdmin: boolean;
  canWrite: boolean;
  canPlan: (nodeKey: string) => boolean;
  onPlan: (nodeKey: string, start?: Day, end?: Day) => void;
}) {
  const zero = useZero();
  const today = dayInTimeZone(Date.now(), timeZone);
  const [showCritical, setShowCritical] = useState(true);
  const [baselineId, setBaselineId] = useState<string>("");
  const [naming, setNaming] = useState<string | null>(null);
  const baseline = baselines.find((b) => b.id === baselineId) ?? null;

  const { rows, deps } = nodeGanttRows(graph, nodes, {
    timeZone,
    canPlan: (n) => canPlan(n.nodeKey),
    dependencies,
  });
  const plan = useMemo(() => {
    const spans = Object.fromEntries(rows.map((r) => [r.key, { start: r.start, end: r.end }]));
    const states = Object.fromEntries(nodes.map((n) => [n.nodeKey, n.state ?? undefined]));
    const milestones = new Set(rows.filter((r) => r.milestone).map((r) => r.key));
    return criticalPath(graph, calendar, { spans, states, milestones, dependencies });
  }, [rows, nodes, graph, calendar, dependencies]);

  const baseSpan = (key: string) => {
    const b = baseline?.nodes[key];
    return b ? { start: dayFromIso(b.start), end: dayFromIso(b.end) } : null;
  };
  const shown: GanttRow[] = rows.map((r) => ({
    ...r,
    critical: showCritical && plan.critical.has(r.key),
    baseline: baseSpan(r.key),
  }));
  const baselineEnd = baseline ? Math.max(...Object.values(baseline.nodes).map((s) => dayFromIso(s.end))) : null;
  const totalSlip =
    plan.end !== null && baselineEnd !== null
      ? baselineSlip(calendar, { start: 0, end: plan.end }, { start: 0, end: baselineEnd })
      : null;

  async function run(request: Parameters<typeof zero.mutate>[0], done: string) {
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") {
        Toast.error(outcome.error.message);
        return false;
      }
    Toast.success(done);
    return true;
  }

  async function save() {
    const name = naming?.trim();
    if (!name) return;
    const id = newId();
    if (await run(mutators.baseline.save({ id, workItemId, name }), `已存为基线「${name}」`)) {
      setNaming(null);
      setBaselineId(id);
    }
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <div
        role="toolbar"
        aria-label="甘特图工具栏"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-subtle px-4 py-2 text-sm"
      >
        <span className="text-fg-muted">
          计划完成 <b className="text-fg tabular-nums">{plan.end !== null ? dayToIso(plan.end) : "—"}</b>
        </span>
        <label className="flex items-center gap-1.5">
          <Checkbox
            aria-label="显示关键路径"
            checked={showCritical}
            onChange={(e) => setShowCritical(e.target.checked)}
          />
          关键路径
          {showCritical && plan.critical.size > 0 && (
            <span className="text-xs text-fg-subtle">（红色的 {plan.critical.size} 个节点，拖一天整体晚一天）</span>
          )}
        </label>
        <span className="flex items-center gap-1.5">
          <span className="text-fg-muted">对比基线</span>
          <Select
            aria-label="对比基线"
            className="h-7 w-48"
            value={baselineId}
            onChange={(e) => setBaselineId(e.target.value)}
          >
            <option value="">不对比</option>
            {baselines.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.createdAt ? `（${fmt(b.createdAt)}）` : ""}
              </option>
            ))}
          </Select>
        </span>
        {baseline && (
          <output aria-label="整体偏差" className="flex items-center gap-1">
            整体比基线 <Slip days={totalSlip} />
          </output>
        )}
        <span className="ml-auto flex items-center gap-2">
          {baseline && canWrite && (isAdmin || baseline.createdBy === me) && (
            <Popconfirm
              title={`删除基线「${baseline.name}」？`}
              content="只删这条快照，不影响现在的计划。"
              okText="删除"
              okType="danger"
              onConfirm={async () => {
                if (await run(mutators.baseline.delete({ id: baseline.id }), "已删除基线")) setBaselineId("");
              }}
            >
              <Button variant="ghost" size="sm">
                删除基线
              </Button>
            </Popconfirm>
          )}
          {canWrite &&
            (naming === null ? (
              <Button variant="outline" size="sm" onClick={() => setNaming(`基线 ${baselines.length + 1}`)}>
                存为基线
              </Button>
            ) : (
              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <Input
                  aria-label="基线名称"
                  autoFocus
                  className="h-7 w-40"
                  value={naming}
                  maxLength={60}
                  onChange={(e) => setNaming(e.target.value)}
                />
                <Button size="sm" type="submit">
                  保存
                </Button>
                <Button variant="ghost" size="sm" type="button" onClick={() => setNaming(null)}>
                  取消
                </Button>
              </form>
            ))}
        </span>
      </div>
      <div className="min-h-0 flex-[3]">
        <GanttChart rows={shown} deps={deps} calendar={calendar} today={today} onChange={onPlan} />
      </div>
      <details open className="min-h-0 flex-[2] overflow-auto border-t border-line-subtle">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold select-none">排期明细</summary>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-line-subtle bg-canvas/60 text-left text-xs text-fg-muted">
              <th className="h-8 px-4 font-normal">节点</th>
              <th className="font-normal">工期</th>
              <th className="font-normal">计划开始</th>
              <th className="font-normal">计划结束</th>
              <th className="font-normal" title="还能往后拖几个工作日而不推迟整个计划">
                余量
              </th>
              {baseline && <th className="font-normal">基线结束</th>}
              {baseline && <th className="font-normal">偏差</th>}
              <th className="font-normal">实际</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const float = plan.float[row.key];
              const base = row.baseline ?? null;
              return (
                <tr key={row.key} aria-label={row.label} className="border-b border-line-subtle hover:bg-hover/50">
                  <td className="h-10 px-4">
                    {row.label}
                    {row.critical && (
                      <Tag tone="danger" className="ml-2">
                        关键
                      </Tag>
                    )}
                    {row.pinned && (
                      <Tag tone="warning" className="ml-2">
                        手动
                      </Tag>
                    )}
                  </td>
                  <td className="text-fg-muted tabular-nums">
                    {row.milestone
                      ? "里程碑"
                      : `${calendar.workdaysBetween(row.start, row.end) || durationOf(graph.node(row.key))} 天`}
                  </td>
                  {(["start", "end"] as const).map((side) => (
                    <td key={side}>
                      <Input
                        type="date"
                        aria-label={side === "start" ? "计划开始" : "计划结束"}
                        className="h-7 w-36 disabled:border-transparent disabled:bg-transparent disabled:text-fg"
                        value={dayToIso(row[side])}
                        disabled={!row.editable}
                        onChange={(e) => {
                          if (!e.target.value) return;
                          const day = dayFromIso(e.target.value);
                          // 改开始日期时整体平移、工期不变；改结束日期时只改结束
                          if (side === "start") onPlan(row.key, day, day + (row.end - row.start));
                          else onPlan(row.key, row.start, Math.max(row.start, day));
                        }}
                      />
                    </td>
                  ))}
                  <td aria-label="余量" className="tabular-nums">
                    {float == null ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <span className={cn(float <= 0 ? "text-danger-600" : "text-fg-muted")}>{float} 天</span>
                    )}
                  </td>
                  {baseline && <td className="text-fg-muted tabular-nums">{base ? dayToIso(base.end) : "—"}</td>}
                  {baseline && (
                    <td aria-label="偏差">
                      <Slip days={baselineSlip(calendar, row, base)} />
                    </td>
                  )}
                  <td className="text-fg-muted tabular-nums">
                    {row.actualStart !== null ? dayToIso(row.actualStart) : ""}
                    {row.actualEnd !== null ? ` → ${dayToIso(row.actualEnd)}` : ""}
                  </td>
                  <td className="pr-4 text-right">
                    {row.pinned && row.editable && (
                      <Button variant="ghost" size="sm" onClick={() => onPlan(row.key)}>
                        恢复自动
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </div>
  );
}
