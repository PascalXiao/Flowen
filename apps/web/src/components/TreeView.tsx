import { type Day, dayInTimeZone, dayToIso } from "@fp/engine";
import { type HierarchyLayerArgs, queries, type WorkItemFilterArgs } from "@fp/sync";
import { useQuery } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";
import { createContext, useContext, useState } from "react";
import { Select } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page";
import { StageTag, StatusTag, Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

/** 层级：null 按子工作项，否则按这个自定义关联。 */
type Hierarchy = { relationDefId: string | null };

/** 层级管理里配的一棵树。 */
interface LayeredHierarchy {
  id: string;
  name: string;
  rootTypeId: string;
  layers: readonly HierarchyLayerArgs[];
}
type Step = { typeId: string; relationDefId: string | null; reverse: boolean };
const toStep = (l: HierarchyLayerArgs): Step => ({
  typeId: l.typeId,
  relationDefId: l.relationDefId,
  reverse: l.reverse ?? false,
});

/** 第 level 层（0 是树根）的工作项往下能走的步：本层循环，以及下一层。 */
function childSteps(h: LayeredHierarchy, level: number): { step: Step; level: number }[] {
  const out: { step: Step; level: number }[] = [];
  const own = level > 0 ? h.layers[level - 1] : undefined;
  if (own?.repeat) out.push({ step: toStep(own), level });
  const next = h.layers[level];
  if (next) out.push({ step: toStep(next), level: level + 1 });
  return out;
}

interface TreeItem {
  id: string;
  name: string;
  stage: string | null;
  status: string | null;
  type?: { name: string } | null;
  /** 排期管理模式下才有：没跳过的节点的计划排期。 */
  nodes?: readonly { nodeKey: string; plannedStart: number | null; plannedEnd: number | null }[];
  outgoing: readonly unknown[];
  incoming?: readonly unknown[];
}

/**
 * 空间的树形视图：符合筛选条件的工作项按层级展开。默认按子工作项分层，也可以选一个自定义关联
 * （比如「需求 → 任务」）。上级也在结果里的工作项不重复放在第一层。
 */
export function TreeView({
  spaceId,
  filter,
  relationDefs,
  hierarchies = [],
  typeId,
  timeZone = "Asia/Shanghai",
}: {
  spaceId: string;
  filter: WorkItemFilterArgs;
  relationDefs: readonly { id: string; name: string; fromType: string; toType: string }[];
  /** 层级管理里配的层级；默认选第一个以当前工作项类型为第一层的。 */
  hierarchies?: readonly LayeredHierarchy[];
  typeId?: string;
  /** 空间时区，排期管理模式里算「今天」。 */
  timeZone?: string;
}) {
  const preferred = hierarchies.find((h) => h.rootTypeId === typeId);
  const [mode, setMode] = useState(preferred ? `h:${preferred.id}` : "");
  const layered = mode.startsWith("h:") ? hierarchies.find((h) => `h:${h.id}` === mode) : undefined;
  const today = dayInTimeZone(Date.now(), timeZone);
  const [schedule, setSchedule] = useState(false);
  const [scale, setScale] = useState<Scale>("week");
  const [from, setFrom] = useState<Day>(() => windowStart(today, "week"));
  const timeline: Timeline | null = schedule ? { from, ...SCALES[scale], today } : null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line-subtle px-4 py-2 text-sm">
        <span className="text-fg-muted">层级</span>
        <Select aria-label="层级" className="w-auto" value={mode} onChange={(e) => setMode(e.target.value)}>
          {hierarchies.length > 0 && (
            <optgroup label="层级管理">
              {hierarchies.map((h) => (
                <option key={h.id} value={`h:${h.id}`}>
                  {h.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="单个关系">
            <option value="">子工作项</option>
            {relationDefs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fromType} → {d.toType}（{d.name}）
              </option>
            ))}
          </optgroup>
        </Select>
        <fieldset aria-label="显示模式" className="m-0 ml-auto flex min-w-0 rounded-md border-0 bg-canvas p-0.5">
          {(
            [
              [false, "表格"],
              [true, "排期管理"],
            ] as const
          ).map(([on, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={schedule === on}
              onClick={() => setSchedule(on)}
              className={cn(
                "h-7 rounded px-3 text-sm",
                schedule === on ? "bg-surface text-brand-500 shadow-card" : "text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </fieldset>
        {schedule && (
          <div className="flex items-center gap-1">
            <Select
              aria-label="时间刻度"
              className="w-auto"
              value={scale}
              onChange={(e) => {
                const next = e.target.value as Scale;
                setScale(next);
                setFrom(windowStart(today, next));
              }}
            >
              {Object.entries(SCALES).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </Select>
            <button
              type="button"
              aria-label="往前"
              className="inline-flex size-7 items-center justify-center rounded hover:bg-hover"
              onClick={() => setFrom(from - SCALES[scale].step)}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              className="h-7 rounded px-2 text-sm hover:bg-hover"
              onClick={() => setFrom(windowStart(today, scale))}
            >
              今天
            </button>
            <button
              type="button"
              aria-label="往后"
              className="inline-flex size-7 items-center justify-center rounded hover:bg-hover"
              onClick={() => setFrom(from + SCALES[scale].step)}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
      <TimelineContext.Provider value={timeline}>
        <div className={cn(schedule && "overflow-x-auto")}>
          {layered ? (
            <LayeredTree key={layered.id} spaceId={spaceId} filter={filter} hierarchy={layered} typeId={typeId} />
          ) : (
            <SingleTree key={mode} spaceId={spaceId} filter={filter} hierarchy={{ relationDefId: mode || null }} />
          )}
        </div>
      </TimelineContext.Provider>
    </div>
  );
}

/** 排期管理模式的时间轴：从哪天开始、显示几天、每天多宽。 */
interface Timeline {
  from: Day;
  days: number;
  dayWidth: number;
  /** 往前、往后翻一次挪几天。 */
  step: number;
  today: Day;
}
type Scale = "day" | "week" | "month";
const SCALES: Record<Scale, { label: string; days: number; dayWidth: number; step: number }> = {
  day: { label: "按天", days: 42, dayWidth: 28, step: 14 },
  week: { label: "按周", days: 126, dayWidth: 8, step: 28 },
  month: { label: "按月", days: 365, dayWidth: 3, step: 91 },
};
const TimelineContext = createContext<Timeline | null>(null);

/** 时间轴从哪天开始：今天往前留一段，按天、按周从周一开始，按月从月初开始。 */
function windowStart(today: Day, scale: Scale): Day {
  const back = scale === "day" ? 7 : scale === "week" ? 14 : 31;
  const day = today - back;
  if (scale === "month") {
    const iso = dayToIso(day);
    return day - (Number(iso.slice(8, 10)) - 1);
  }
  // Day 0（1970-01-01）是星期四，周一是 (day + 3) % 7 == 0
  return day - ((((day + 3) % 7) + 7) % 7);
}

/** 计划日期（存的是 UTC 零点）换成 Day。 */
const toDay = (ms: number) => Math.round(ms / 86_400_000);

/** 工作项的排期：没跳过的节点里最早的计划开始到最晚的计划结束。 */
function planSpan(item: TreeItem): { start: Day; end: Day } | null {
  const starts = (item.nodes ?? []).flatMap((n) => (n.plannedStart == null ? [] : [toDay(n.plannedStart)]));
  const ends = (item.nodes ?? []).flatMap((n) => (n.plannedEnd == null ? [] : [toDay(n.plannedEnd)]));
  if (!starts.length || !ends.length) return null;
  return { start: Math.min(...starts), end: Math.max(...ends) };
}

/** 时间轴表头：按天显示日期，按周显示每周一，按月显示月份。 */
function TimelineHeader({ t }: { t: Timeline }) {
  const marks: { left: number; label: string }[] = [];
  for (let d = t.from; d < t.from + t.days; d++) {
    const iso = dayToIso(d);
    const monday = (((d + 3) % 7) + 7) % 7 === 0;
    const first = iso.endsWith("-01");
    const show = t.dayWidth >= 20 ? true : t.dayWidth >= 8 ? monday : first;
    if (show)
      marks.push({
        left: (d - t.from) * t.dayWidth,
        label: t.dayWidth >= 20 ? iso.slice(8) : t.dayWidth >= 8 ? iso.slice(5) : `${Number(iso.slice(5, 7))}月`,
      });
  }
  return (
    <div className="relative h-9" style={{ width: t.days * t.dayWidth }}>
      {marks.map((m) => (
        <span
          key={m.left}
          className="absolute top-0 flex h-9 items-center border-l border-line-subtle pl-1 text-[11px] text-fg-subtle"
          style={{ left: m.left }}
        >
          {m.label}
        </span>
      ))}
      <TodayLine t={t} />
    </div>
  );
}

function TodayLine({ t }: { t: Timeline }) {
  if (t.today < t.from || t.today >= t.from + t.days) return null;
  return (
    <span
      aria-hidden
      className="absolute inset-y-0 w-px bg-danger-500/60"
      style={{ left: (t.today - t.from) * t.dayWidth + t.dayWidth / 2 }}
    />
  );
}

/** 一行的排期条：已完成绿色，延期（计划结束早于今天还没完成）红色，其余蓝色。 */
function PlanCell({ item, t }: { item: TreeItem; t: Timeline }) {
  const span = planSpan(item);
  const width = t.days * t.dayWidth;
  let bar: React.ReactNode = null;
  if (span) {
    const left = Math.max(span.start, t.from);
    const right = Math.min(span.end, t.from + t.days - 1);
    const done = item.status === "completed";
    const late = !done && item.status !== "terminated" && span.end < t.today;
    const text = `${dayToIso(span.start)} ~ ${dayToIso(span.end)}`;
    bar =
      right < left ? (
        <span className="absolute inset-y-0 flex items-center text-[11px] text-fg-subtle" style={{ left: 4 }}>
          {span.end < t.from ? `← ${text}` : ""}
        </span>
      ) : (
        <span
          role="img"
          aria-label={`${item.name}排期 ${text}${late ? "，已延期" : ""}`}
          title={text}
          className={cn(
            "absolute top-1/2 h-4 -translate-y-1/2 rounded",
            done ? "bg-success-500/70" : late ? "bg-danger-500/70" : "bg-brand-500/70",
          )}
          style={{ left: (left - t.from) * t.dayWidth, width: Math.max((right - left + 1) * t.dayWidth, 4) }}
        />
      );
  }
  return (
    <td className="relative p-0">
      <div className="relative h-11" style={{ width }}>
        <TodayLine t={t} />
        {bar}
        {!span && (
          <span className="absolute inset-y-0 left-2 flex items-center text-[11px] text-fg-disabled">未排期</span>
        )}
      </div>
    </td>
  );
}

function Header() {
  const t = useContext(TimelineContext);
  return (
    <thead>
      <tr className="border-b border-line-subtle bg-canvas/60 text-left text-xs text-fg-muted">
        <th className={cn("h-9 px-4 font-normal", t && "sticky left-0 z-10 min-w-72 bg-canvas")}>名称</th>
        {!t && <th className="h-9 px-4 font-normal">类型</th>}
        <th className="h-9 px-4 font-normal">阶段</th>
        <th className="h-9 px-4 font-normal">状态</th>
        {t && (
          <th className="p-0 font-normal">
            <TimelineHeader t={t} />
          </th>
        )}
      </tr>
    </thead>
  );
}

/**
 * 按层级管理的配置展开：第一层是树根类型的工作项（筛选条件只在树根是当前类型时整套生效，
 * 否则只按状态和成员筛），每一层沿配置的关系找下级。
 */
function LayeredTree({
  spaceId,
  filter,
  hierarchy,
  typeId,
}: {
  spaceId: string;
  filter: WorkItemFilterArgs;
  hierarchy: LayeredHierarchy;
  typeId?: string;
}) {
  const rootFilter =
    hierarchy.rootTypeId === typeId ? filter : { statuses: filter.statuses, memberIds: filter.memberIds };
  const plans = useContext(TimelineContext) !== null;
  const [items, result] = useQuery(
    queries.workItems.layerRoots({
      spaceId,
      filter: rootFilter,
      rootTypeId: hierarchy.rootTypeId,
      next: childSteps(hierarchy, 0).map((s) => s.step),
      plans,
    }),
  );
  return (
    <>
      <table className="w-full text-sm" aria-label="工作项树">
        <Header />
        <tbody>
          {items.map((item) => (
            <LayerRow key={item.id} item={item} hierarchy={hierarchy} level={0} depth={0} ancestors={[]} />
          ))}
        </tbody>
      </table>
      {items.length === 0 && result.type === "complete" && (
        <EmptyState title="没有符合条件的工作项" description="第一层的工作项按筛选条件找不到，换个条件试试。" />
      )}
    </>
  );
}

function LayerRow({
  item,
  hierarchy,
  level,
  depth,
  ancestors,
}: {
  item: TreeItem;
  hierarchy: LayeredHierarchy;
  level: number;
  depth: number;
  ancestors: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const count = item.outgoing.length + (item.incoming?.length ?? 0);
  const expandable = count > 0 && !ancestors.includes(item.id);
  return (
    <>
      <Row
        item={item}
        depth={depth}
        count={count}
        expandable={expandable}
        open={open}
        onToggle={() => setOpen(!open)}
      />
      {open &&
        childSteps(hierarchy, level).map(({ step, level: childLevel }) => (
          <LayerChildren
            key={`${step.relationDefId}-${step.reverse}-${step.typeId}-${childLevel}`}
            id={item.id}
            step={step}
            next={childSteps(hierarchy, childLevel).map((s) => s.step)}
            render={(child) => (
              <LayerRow
                key={child.id}
                item={child}
                hierarchy={hierarchy}
                level={childLevel}
                depth={depth + 1}
                ancestors={[...ancestors, item.id]}
              />
            )}
          />
        ))}
    </>
  );
}

function LayerChildren({
  id,
  step,
  next,
  render,
}: {
  id: string;
  step: Step;
  next: Step[];
  render: (item: TreeItem) => React.ReactNode;
}) {
  return step.reverse ? (
    <LayerUp id={id} step={step} next={next} render={render} />
  ) : (
    <LayerDown id={id} step={step} next={next} render={render} />
  );
}

function LayerDown({ id, step, next, render }: Parameters<typeof LayerChildren>[0]) {
  const plans = useContext(TimelineContext) !== null;
  const [edges] = useQuery(queries.workItems.layerDown({ id, step, next, plans }));
  return edges.map((e) => (e.to ? render(e.to) : null));
}

function LayerUp({ id, step, next, render }: Parameters<typeof LayerChildren>[0]) {
  const plans = useContext(TimelineContext) !== null;
  const [edges] = useQuery(queries.workItems.layerUp({ id, step, next, plans }));
  return edges.map((e) => (e.from ? render(e.from) : null));
}

/** 只按一种关系（子工作项或一个自定义关联）分层。上级也在结果里的工作项不重复放在第一层。 */
function SingleTree({
  spaceId,
  filter,
  hierarchy,
}: {
  spaceId: string;
  filter: WorkItemFilterArgs;
  hierarchy: Hierarchy;
}) {
  const plans = useContext(TimelineContext) !== null;
  const [items, result] = useQuery(queries.workItems.treeBySpace({ spaceId, filter, hierarchy, plans }));
  const ids = new Set(items.map((i) => i.id));
  const roots = items.filter((i) => !i.incoming.some((r) => ids.has(r.fromId)));

  return (
    <>
      <table className="w-full text-sm" aria-label="工作项树">
        <Header />
        <tbody>
          {roots.map((item) => (
            <TreeRow key={item.id} item={item} hierarchy={hierarchy} depth={0} ancestors={[]} />
          ))}
        </tbody>
      </table>
      {roots.length === 0 && result.type === "complete" && (
        <EmptyState title="没有符合条件的工作项" description="换个筛选条件试试。" />
      )}
    </>
  );
}

/** 一行，展开后按需加载下级。沿途的上级记在 ancestors 里，自定义关联成环时不再往下展开。 */
function TreeRow({
  item,
  hierarchy,
  depth,
  ancestors,
}: {
  item: TreeItem;
  hierarchy: Hierarchy;
  depth: number;
  ancestors: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const cycle = ancestors.includes(item.id);
  const expandable = item.outgoing.length > 0 && !cycle;
  return (
    <>
      <Row
        item={item}
        depth={depth}
        count={item.outgoing.length}
        expandable={expandable}
        open={open}
        onToggle={() => setOpen(!open)}
      />
      {open && (
        <TreeChildren id={item.id} hierarchy={hierarchy} depth={depth + 1} ancestors={[...ancestors, item.id]} />
      )}
    </>
  );
}

function TreeChildren({
  id,
  hierarchy,
  depth,
  ancestors,
}: {
  id: string;
  hierarchy: Hierarchy;
  depth: number;
  ancestors: readonly string[];
}) {
  const plans = useContext(TimelineContext) !== null;
  const [edges] = useQuery(queries.workItems.children({ id, hierarchy, plans }));
  return edges.map((e) =>
    e.to ? <TreeRow key={e.id} item={e.to} hierarchy={hierarchy} depth={depth} ancestors={ancestors} /> : null,
  );
}

/** 一行：展开按钮、名称（链到详情）、下级数量、类型、阶段、状态。 */
function Row({
  item,
  depth,
  count,
  expandable,
  open,
  onToggle,
}: {
  item: TreeItem;
  depth: number;
  count: number;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useContext(TimelineContext);
  return (
    <tr className="border-b border-line-subtle hover:bg-hover/50">
      <td className={cn("h-11 px-4", t && "sticky left-0 z-10 min-w-72 bg-surface")}>
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 20 }}>
          {expandable ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? "收起" : "展开"}${item.name}`}
              className="inline-flex size-5 items-center justify-center rounded text-fg-subtle hover:bg-hover"
              onClick={onToggle}
            >
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </button>
          ) : (
            <span className="size-5" />
          )}
          <Link to="/items/$itemId" params={{ itemId: item.id }} className="font-medium hover:text-brand-500">
            {item.name}
          </Link>
          {count > 0 && <span className="text-xs text-fg-subtle">{count}</span>}
        </div>
      </td>
      {!t && <td className="px-4">{item.type && <Tag>{item.type.name}</Tag>}</td>}
      <td className="whitespace-nowrap px-4">{item.stage && <StageTag stage={item.stage} />}</td>
      <td className="whitespace-nowrap px-4">
        <StatusTag status={item.status ?? "inProgress"} />
      </td>
      {t && <PlanCell item={item} t={t} />}
    </tr>
  );
}
