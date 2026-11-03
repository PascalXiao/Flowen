import { type Day, dayFromDate, dayInTimeZone, dayToIso, nodeFlowOf } from "@fp/engine";
import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { Segmented } from "@/components/ui/tabs";
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
}

type Group = "overdue" | "today" | "week" | "later" | "none";

const GROUPS: [Group, string][] = [
  ["overdue", "已逾期"],
  ["today", "今天到期"],
  ["week", "7 天内"],
  ["later", "以后"],
  ["none", "没有截止日期"],
];

function groupOf({ due, today }: Entry): Group {
  if (due === null) return "none";
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= today + 7) return "week";
  return "later";
}

/** 我的工作：所有空间里轮到我的节点和分给我的子任务，按截止日期分组。节点按计划结束日期算。 */
export function MyWorkPage() {
  const zero = useZero();
  const me = String(zero.userID);
  const [items, itemsResult] = useQuery(queries.myWork.nodes());
  const [tasks, tasksResult] = useQuery(queries.myWork.tasks());
  const [filter, setFilter] = useState<"all" | "node" | "task">("all");
  useActiveSpace(null);

  const now = Date.now();
  const nodeName = (definition: unknown, key: string) =>
    nodeFlowOf(definition)?.nodes.find((n) => n.key === key)?.name ?? key;
  const entries: Entry[] = [
    ...items.flatMap((item) =>
      item.nodes
        .filter((n) => n.owners?.includes(me))
        .map((n) => ({
          key: n.id,
          kind: "node" as const,
          title: nodeName(item.flowVersion?.definition, n.nodeKey),
          itemId: item.id,
          itemName: item.name,
          spaceName: item.space?.name ?? "",
          due: n.plannedEnd == null ? null : dayFromDate(n.plannedEnd),
          today: dayInTimeZone(now, item.space?.timezone ?? "Asia/Shanghai"),
        })),
    ),
    ...tasks.flatMap((t) =>
      t.workItem
        ? [
            {
              key: t.id,
              kind: "task" as const,
              taskId: t.id,
              title: t.name,
              nodeName: nodeName(t.workItem.flowVersion?.definition, t.nodeKey),
              itemId: t.workItemId,
              itemName: t.workItem.name,
              spaceName: t.workItem.space?.name ?? "",
              due: t.dueDate == null ? null : dayFromDate(t.dueDate),
              today: dayInTimeZone(now, t.workItem.space?.timezone ?? "Asia/Shanghai"),
            },
          ]
        : [],
    ),
  ].sort((a, b) => (a.due ?? Number.POSITIVE_INFINITY) - (b.due ?? Number.POSITIVE_INFINITY));
  const shown = entries.filter((e) => filter === "all" || e.kind === filter);
  const loading = itemsResult.type !== "complete" || tasksResult.type !== "complete";
  const count = (kind: Entry["kind"]) => entries.filter((e) => e.kind === kind).length;

  return (
    <>
      <PageHeader title="我的工作">
        <span className="text-sm text-fg-subtle">
          {count("node")} 个节点 · {count("task")} 个子任务
        </span>
      </PageHeader>
      <PageBody className="max-w-4xl">
        <div>
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
        {shown.length === 0 && (
          <EmptyState
            title={loading ? "加载中…" : "没有待办"}
            {...(!loading && { description: "轮到你负责的节点、分给你的子任务会出现在这里。" })}
          />
        )}
        {GROUPS.map(([group, label]) => {
          const list = shown.filter((e) => groupOf(e) === group);
          if (list.length === 0) return null;
          return (
            <section key={group} className="flex flex-col gap-1.5">
              <h2 className={cn("text-sm font-semibold", group === "overdue" && "text-danger-600")}>
                {label} <span className="font-normal text-fg-subtle">{list.length}</span>
              </h2>
              <ul aria-label={label} className="overflow-hidden rounded-lg border border-line-subtle bg-surface">
                {list.map((e) => (
                  <li
                    key={e.key}
                    aria-label={e.title}
                    className="flex h-11 items-center gap-3 border-b border-line-subtle px-4 last:border-b-0 hover:bg-hover/50"
                  >
                    {e.taskId ? (
                      <Checkbox
                        aria-label={`完成子任务：${e.title}`}
                        className="size-3.5 accent-brand-500"
                        onChange={() => zero.mutate(mutators.task.setDone({ id: e.taskId as string, done: true }))}
                      />
                    ) : (
                      <span className="size-3.5" />
                    )}
                    <Tag tone={e.kind === "node" ? "brand" : "neutral"}>{e.kind === "node" ? "节点" : "子任务"}</Tag>
                    <span className="min-w-0 truncate font-medium">{e.title}</span>
                    <Link
                      to="/items/$itemId"
                      params={{ itemId: e.itemId }}
                      className="min-w-0 truncate text-fg-muted hover:text-brand-500"
                    >
                      {e.itemName}
                      {e.nodeName && ` · ${e.nodeName}`}
                    </Link>
                    <span className="ml-auto shrink-0 text-xs text-fg-subtle">{e.spaceName}</span>
                    <span
                      className={cn(
                        "w-20 shrink-0 text-right text-xs tabular-nums text-fg-muted",
                        group === "overdue" && "text-danger-600",
                      )}
                    >
                      {e.due === null ? "" : dayToIso(e.due)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </PageBody>
    </>
  );
}
