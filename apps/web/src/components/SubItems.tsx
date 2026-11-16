import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { StatusTag } from "@/components/ui/tag";
import { newId } from "@/lib/utils";

const STATUS_LABEL = { inProgress: "进行中", completed: "已完成", terminated: "已终止" } as const;

interface Child {
  id: string;
  name: string;
  status: keyof typeof STATUS_LABEL | null;
}

/**
 * “子工作项驱动”节点下的子工作项：列表和新建表单。
 * 子工作项全部结束（至少一个完成）后，节点由服务端自动完成。
 */
export function SubItems({
  workItemId,
  nodeKey,
  nodeName,
  items,
  types,
  canCreate,
}: {
  workItemId: string;
  nodeKey: string;
  nodeName: string;
  items: Child[];
  types: { id: string; name: string }[];
  canCreate: boolean;
}) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    if (!name) return;
    setError(null);
    const { client, server } = zero.mutate(
      mutators.workItem.createSubItem({
        id: newId(),
        parentId: workItemId,
        nodeKey,
        typeId: String(data.get("typeId")),
        name,
      }),
    );
    for (const outcome of [await client, await server])
      if (outcome.type === "error") return setError(outcome.error.message);
    form.reset();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ul aria-label={`${nodeName}的子工作项`} className="flex flex-col gap-1">
        {items.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <Link to="/items/$itemId" params={{ itemId: c.id }} className="truncate text-accent hover:text-accent">
              {c.name}
            </Link>
            <StatusTag status={c.status} />
          </li>
        ))}
        {items.length === 0 && <li className="text-fg-subtle">还没有子工作项，全部完成后节点自动完成。</li>}
      </ul>
      {canCreate && (
        <form className="flex items-center gap-1.5 bg-surface" onSubmit={create}>
          <Select name="typeId" aria-label="子工作项类型" className="w-28">
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Input name="name" aria-label="子工作项名称" placeholder="子工作项名称" className="h-8 min-w-0 flex-1" />
          <Button type="submit" size="sm" variant="outline">
            新建
          </Button>
        </form>
      )}
      {error && <p className="text-danger-600">{error}</p>}
    </div>
  );
}
