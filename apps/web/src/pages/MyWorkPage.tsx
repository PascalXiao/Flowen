import { type Day, dayFromDate, dayInTimeZone, dayToIso, nodeFlowOf } from "@fp/engine";
import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { Segmented, Tabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

/** 一条待办：轮到我的节点，或分给我的子任务。 */
interface Entry {
  key: string;
  kind: "node" | "task";
  /** 子任务的 id；勾选完成时用。 */
  taskId?: string;
  title: string;
  /** 子任务所在的节点名。 */
  nodeName?: string;
  itemId: string;
  itemName: string;
  spaceName: string;
  due: Day | null;
  /** 工作项所在空间的今天。 */
  today: Day;
  /** 已办：完成时间。 */
  doneAt?: number;
}

type Group = "overdue" | "today" | "week" | "later" | "none";

const GROUPS: [Group, string][] = [
  ["overdue", "已逾期"],
  ["today", "今天到期"],
  ["week", "7 天内"],
  ["later", "以后"],
  ["none", "没有截止日期"],
];

/** 已办的时间范围：从哪一刻算起（本机时间）。 */
type Range = "week" | "month" | "30d";
const RANGES: [Range, string][] = [
  ["week", "本周"],
  ["month", "本月"],
  ["30d", "近 30 天"],
];
export function rangeStart(range: Range, now: Date): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  else if (range === "month") d.setDate(1);
  else d.setDate(d.getDate() - 29);
  return d.getTime();
}

function groupOf({ due, today }: Entry): Group {
  if (due === null) return "none";
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= today + 7) return "week";
  return "later";
}

/**
 * 我的工作（对照飞书项目的工作台）：顶部统计卡片（待办、已逾期、今天到期、7 天内到期、已完成），
 * 点卡片筛选列表；待办按截止日期分组，已办按时间范围（本周、本月、近 30 天）列出我完成的节点和子任务。
 */
export function MyWorkPage() {
  const zero = useZero();
  const me = String(zero.userID);
  const [view, setView] = useState<"todo" | "done">("todo");
  const [range, setRange] = useState<Range>("week");
  const [focus, setFocus] = useState<Group | "all">("all");
  const [filter, setFilter] = useState<"all" | "node" | "task">("all");
  // 按天取整，避免每次渲染都换查询
  const since = useMemo(() => rangeStart(range, new Date()), [range]);
  const [items, itemsResult] = useQuery(queries.myWork.nodes());
  const [tasks, tasksResult] = useQuery(queries.myWork.tasks());
  const [doneItems] = useQuery(queries.myWork.doneNodes({ since }));
  const [doneTasks] = useQuery(queries.myWork.doneTasks({ since }));
  useActiveSpace(null);

  const now = Date.now();
  const nodeName = (definition: unknown, key: string) =>
    nodeFlowOf(definition)?.nodes.find((n) => n.key === key)?.name ?? key;
  const autoNode = (definition: unknown, key: string) =>
    nodeFlowOf(definition)?.nodes.find((n) => n.key === key)?.completion === "auto";
  const byDue = (a: Entry, b: Entry) => (a.due ?? Number.POSITIVE_INFINITY) - (b.due ?? Number.POSITIVE_INFINITY);
  const nodeEntries = (
    list: typeof items,
    doneAt: (n: (typeof items)[number]["nodes"][number]) => number | undefined,
  ) =>
    list.flatMap((item) =>
      item.nodes
        // 自动完成的节点（如「开始」）不算谁的工作
        .filter((n) => n.owners?.includes(me) && !autoNode(item.flowVersion?.definition, n.nodeKey))
        .map(
          (n): Entry => ({
            key: n.id,
            kind: "node",
            title: nodeName(item.flowVersion?.definition, n.nodeKey),
            itemId: item.id,
            itemName: item.name,
            spaceName: item.space?.name ?? "",
            due: n.plannedEnd == null ? null : dayFromDate(n.plannedEnd),
            today: dayInTimeZone(now, item.space?.timezone ?? "Asia/Shanghai"),
            doneAt: doneAt(n),
          }),
        ),
    );
  const taskEntries = (list: typeof doneTasks) =>
    list.flatMap((t): Entry[] =>
      t.workItem
        ? [
            {
              key: t.id,
              kind: "task",
              taskId: t.id,
              title: t.name,
              nodeName: nodeName(t.workItem.flowVersion?.definition, t.nodeKey),
              itemId: t.workItemId,
              itemName: t.workItem.name,
              spaceName: t.workItem.space?.name ?? "",
              due: t.dueDate == null ? null : dayFromDate(t.dueDate),
              today: dayInTimeZone(now, t.workItem.space?.timezone ?? "Asia/Shanghai"),
              doneAt: t.doneAt ?? undefined,
            },
          ]
        : [],
    );
  const todo = [...nodeEntries(items, () => undefined), ...taskEntries(tasks)].sort(byDue);
  const done = [...nodeEntries(doneItems, (n) => n.actualEnd ?? undefined), ...taskEntries(doneTasks)].sort(
    (a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0),
  );
  const loading = itemsResult.type !== "complete" || tasksResult.type !== "complete";
  const ofKind = (list: Entry[]) => list.filter((e) => filter === "all" || e.kind === filter);
  const inGroup = (g: Group) => todo.filter((e) => groupOf(e) === g).length;

  /** 统计卡片：前四个筛选待办，最后一个切到已办。 */
  const stats: { key: Group | "all" | "done"; label: string; value: number; tone?: "danger" | "warning" }[] = [
    { key: "all", label: "待办", value: todo.length },
    { key: "overdue", label: "已逾期", value: inGroup("overdue"), tone: "danger" },
    { key: "today", label: "今天到期", value: inGroup("today"), tone: "warning" },
    { key: "week", label: "7 天内到期", value: inGroup("week") },
    { key: "done", label: `已完成（${RANGES.find(([r]) => r === range)?.[1]}）`, value: done.length },
  ];
  const isActive = (key: Group | "all" | "done") =>
    key === "done" ? view === "done" : view === "todo" && focus === key;
  function pick(key: Group | "all" | "done") {
    if (key === "done") return setView("done");
    setView("todo");
    setFocus(key);
  }

  const row = (e: Entry, overdue: boolean) => (
    <li
      key={e.key}
      aria-label={e.title}
      className="flex h-11 items-center gap-3 border-b border-line-subtle px-4 last:border-b-0 hover:bg-hover/50"
    >
      {e.taskId && view === "todo" ? (
        <Checkbox
          aria-label={`完成子任务：${e.title}`}
          className="size-3.5 accent-brand-500"
          onChange={() => zero.mutate(mutators.task.setDone({ id: e.taskId as string, done: true }))}
        />
      ) : (
        <span className="size-3.5" />
      )}
      <Tag tone={e.kind === "node" ? "brand" : "neutral"}>{e.kind === "node" ? "节点" : "子任务"}</Tag>
      <span className={cn("min-w-0 truncate font-medium", view === "done" && "text-fg-muted line-through")}>
        {e.title}
      </span>
      <Link
        to="/items/$itemId"
        params={{ itemId: e.itemId }}
        className="min-w-0 truncate text-fg-muted hover:text-brand-500"
      >
        {e.itemName}
        {e.nodeName && ` · ${e.nodeName}`}
      </Link>
      <span className="ml-auto shrink-0 text-xs text-fg-subtle">{e.spaceName}</span>
      <span className={cn("w-28 shrink-0 text-right text-xs tabular-nums text-fg-muted", overdue && "text-danger-600")}>
        {view === "done"
          ? e.doneAt == null
            ? ""
            : `${new Date(e.doneAt).toLocaleDateString("zh-CN")} 完成`
          : e.due === null
            ? ""
            : dayToIso(e.due)}
      </span>
    </li>
  );

  const shownTodo = ofKind(todo).filter((e) => focus === "all" || groupOf(e) === focus);
  const shownDone = ofKind(done);

  return (
    <>
      <PageHeader title="我的工作">
        <Segmented label="时间范围" value={range} onChange={setRange} items={RANGES} />
      </PageHeader>
      <PageBody className="max-w-4xl">
        {/* biome-ignore lint/a11y/useSemanticElements: 只是给一组卡片起名，fieldset 会带上表单的默认样式 */}
        <div role="group" aria-label="统计" className="grid grid-cols-5 gap-3">
          {stats.map((s) => (
            <button
              key={s.key}
              type="button"
              aria-pressed={isActive(s.key)}
              aria-label={`${s.label} ${s.value}`}
              onClick={() => pick(s.key)}
              className={cn(
                "flex cursor-pointer flex-col items-start gap-1 rounded-lg border bg-surface px-4 py-3 text-left transition-colors hover:border-brand-300",
                isActive(s.key) ? "border-brand-500 ring-2 ring-brand-50" : "border-line-subtle",
              )}
            >
              <span className="text-xs text-fg-muted">{s.label}</span>
              <span
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  s.value > 0 && s.tone === "danger" && "text-danger-600",
                  s.value > 0 && s.tone === "warning" && "text-warning-600",
                )}
              >
                {s.value}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Tabs
            label="待办和已办"
            value={view}
            onChange={setView}
            items={[
              ["todo", `待办 ${todo.length}`],
              ["done", `已办 ${done.length}`],
            ]}
          />
          <Segmented
            label="待办类型"
            value={filter}
            onChange={setFilter}
            items={[
              ["all", "全部"],
              ["node", "节点"],
              ["task", "子任务"],
            ]}
          />
        </div>
        {view === "todo" && shownTodo.length === 0 && (
          <EmptyState
            title={loading ? "加载中…" : "没有待办"}
            {...(!loading && { description: "轮到你负责的节点、分给你的子任务会出现在这里。" })}
          />
        )}
        {view === "todo" &&
          GROUPS.map(([group, label]) => {
            const list = shownTodo.filter((e) => groupOf(e) === group);
            if (list.length === 0) return null;
            return (
              <section key={group} className="flex flex-col gap-1.5">
                <h2 className={cn("text-sm font-semibold", group === "overdue" && "text-danger-600")}>
                  {label} <span className="font-normal text-fg-subtle">{list.length}</span>
                </h2>
                <ul aria-label={label} className="overflow-hidden rounded-lg border border-line-subtle bg-surface">
                  {list.map((e) => row(e, group === "overdue"))}
                </ul>
              </section>
            );
          })}
        {view === "done" &&
          (shownDone.length === 0 ? (
            <EmptyState title="这段时间还没有已办" description="你完成的节点和子任务会出现在这里。" />
          ) : (
            <ul aria-label="已办" className="overflow-hidden rounded-lg border border-line-subtle bg-surface">
              {shownDone.map((e) => row(e, false))}
            </ul>
          ))}
      </PageBody>
    </>
  );
}
