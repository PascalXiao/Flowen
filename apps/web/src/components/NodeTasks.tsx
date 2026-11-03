import { dayFromDate, dayToIso } from "@fp/engine";
import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { UserRound, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, newId } from "@/lib/utils";

export interface Task {
  id: string;
  name: string;
  assigneeId: string | null;
  dueDate: number | null;
  done: boolean | null;
}

/**
 * 节点上的子任务：勾选完成、指派负责人、设截止日期。节点有没完成的子任务时不能确认完成。
 * 节点完成或跳过后只读。
 */
export function NodeTasks({
  workItemId,
  nodeKey,
  nodeName,
  tasks,
  members,
  today,
  readOnly,
}: {
  workItemId: string;
  nodeKey: string;
  nodeName: string;
  tasks: Task[];
  members: { userId: string; name: string }[];
  /** 空间时区的今天（天号），用来标出逾期的子任务。 */
  today: number;
  readOnly: boolean;
}) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);
  const done = tasks.filter((t) => t.done).length;

  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") {
        setError(outcome.error.message);
        return false;
      }
    return true;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    form.reset();
    if (!(await run(mutators.task.create({ id: newId(), workItemId, nodeKey, name, assigneeId: null, due: null }))))
      (form.elements.namedItem("name") as HTMLInputElement).value = name;
  }

  if (readOnly && tasks.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-fg-muted">
        <span>子任务</span>
        {tasks.length > 0 && (
          <span className="text-xs tabular-nums text-fg-subtle">
            {done}/{tasks.length}
          </span>
        )}
      </div>
      <ul aria-label={`${nodeName}的子任务`} className="flex flex-col">
        {tasks.map((task) => {
          const due = task.dueDate === null ? null : dayFromDate(task.dueDate);
          const assignee = members.find((m) => m.userId === task.assigneeId);
          return (
            <li key={task.id} className="group flex h-8 items-center gap-2 rounded-md px-1 hover:bg-hover/60">
              <Checkbox
                aria-label={`完成子任务：${task.name}`}
                className="size-3.5 accent-brand-500"
                checked={task.done === true}
                disabled={readOnly}
                onChange={(e) => run(mutators.task.setDone({ id: task.id, done: e.target.checked }))}
              />
              <span className={cn("min-w-0 flex-1 truncate", task.done && "text-fg-subtle line-through")}>
                {task.name}
              </span>
              <input
                type="date"
                aria-label={`${task.name}的截止日期`}
                className={cn(
                  "w-[6.5rem] rounded bg-transparent text-xs tabular-nums text-fg-subtle outline-none",
                  due === null && "opacity-0 group-hover:opacity-100 focus:opacity-100",
                  !task.done && due !== null && due < today && "text-danger-600",
                )}
                value={due === null ? "" : dayToIso(due)}
                disabled={readOnly}
                onChange={(e) => run(mutators.task.update({ id: task.id, due: e.target.value || null }))}
              />
              <Popover>
                <PopoverTrigger
                  aria-label={`${task.name}的负责人`}
                  title={assignee?.name ?? "未指派"}
                  disabled={readOnly}
                  className="rounded-full disabled:cursor-default"
                >
                  {assignee ? (
                    <Avatar name={assignee.name} id={assignee.userId} size={20} />
                  ) : (
                    <span className="inline-flex size-5 items-center justify-center rounded-full border border-dashed border-line text-fg-subtle">
                      <UserRound className="size-3" />
                    </span>
                  )}
                </PopoverTrigger>
                <PopoverContent align="end" className="w-44 p-1">
                  {members.map((m) => (
                    <button
                      key={m.userId}
                      type="button"
                      aria-pressed={m.userId === task.assigneeId}
                      className="flex h-8 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover aria-pressed:text-brand-500"
                      onClick={() =>
                        run(
                          mutators.task.update({
                            id: task.id,
                            assigneeId: m.userId === task.assigneeId ? null : m.userId,
                          }),
                        )
                      }
                    >
                      <Avatar name={m.name} id={m.userId} size={18} />
                      <span className="truncate">{m.name}</span>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`删除子任务：${task.name}`}
                  className="text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-danger-600 focus:opacity-100"
                  onClick={() => run(mutators.task.delete({ id: task.id }))}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!readOnly && (
        <form onSubmit={create}>
          <Input
            name="name"
            aria-label={`给${nodeName}添加子任务`}
            placeholder="+ 添加子任务，回车保存"
            className="h-8"
          />
        </form>
      )}
      {error && <p className="text-danger-600">{error}</p>}
    </div>
  );
}
