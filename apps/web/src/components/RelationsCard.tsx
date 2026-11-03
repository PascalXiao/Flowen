import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useState } from "react";
import { Select } from "@/components/ui/input";
import { Panel } from "@/components/ui/page";
import { newId } from "@/lib/utils";

interface ItemRef {
  id: string;
  name: string;
}
interface Def {
  id: string;
  name: string;
  toTypeId: string;
  cardinality: "one" | "many";
}
/** 互相关联在本工作项这一端的字段：别的工作项（fromTypeId 类型）关联到本工作项。 */
interface ReverseDef {
  id: string;
  name: string;
  fromTypeId: string;
  cardinality: "one" | "many";
}
interface Linked {
  id: string;
  relationDefId: string | null;
  item?: ItemRef | undefined;
  def?: { name: string } | undefined;
}

/**
 * 工作项的自定义关联：类型上定义的每种关联一组，可以添加和取消；
 * 下面列出别的工作项关联到它的反向关联（只读）。
 */
export function RelationsCard({
  workItemId,
  spaceId,
  defs,
  reverseDefs = [],
  outgoing,
  incoming,
  title = "关联",
}: {
  title?: string;
  workItemId: string;
  spaceId: string;
  defs: readonly Def[];
  reverseDefs?: readonly ReverseDef[];
  outgoing: readonly Linked[];
  incoming: readonly Linked[];
}) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);
  // 有字段名的反向关联单独成组，没有的才列在「被关联」里
  const reverseIds = new Set(reverseDefs.map((d) => d.id));
  const backlinks = incoming.filter((r) => r.relationDefId && r.item && !reverseIds.has(r.relationDefId));
  if (defs.length === 0 && reverseDefs.length === 0 && backlinks.length === 0) return null;

  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") return setError(outcome.error.message);
  }

  return (
    <Panel title={title}>
      <div className="flex flex-col gap-4">
        {defs.map((def) => (
          <RelationGroup
            key={def.id}
            def={def}
            spaceId={spaceId}
            workItemId={workItemId}
            linked={outgoing.filter((r) => r.relationDefId === def.id)}
            onAdd={(toId) =>
              run(mutators.relation.add({ id: newId(), relationDefId: def.id, fromId: workItemId, toId }))
            }
            onRemove={(id) => run(mutators.relation.remove({ id }))}
          />
        ))}
        {reverseDefs.map((def) => (
          <RelationGroup
            key={def.id}
            def={{ id: def.id, name: def.name, toTypeId: def.fromTypeId, cardinality: def.cardinality }}
            spaceId={spaceId}
            workItemId={workItemId}
            linked={incoming.filter((r) => r.relationDefId === def.id)}
            onAdd={(otherId) =>
              run(mutators.relation.add({ id: newId(), relationDefId: def.id, fromId: otherId, toId: workItemId }))
            }
            onRemove={(id) => run(mutators.relation.remove({ id }))}
          />
        ))}
        {backlinks.length > 0 && (
          <section aria-label="被关联" className="flex flex-col gap-1">
            <div className="text-fg-muted">被关联</div>
            <ul className="flex flex-col gap-1">
              {backlinks.map((r) => (
                <li key={r.id}>
                  <ItemLink item={r.item as ItemRef} />
                  <span className="text-fg-subtle">（{r.def?.name}）</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {error && <p className="text-danger-600">{error}</p>}
      </div>
    </Panel>
  );
}

function RelationGroup({
  def,
  spaceId,
  workItemId,
  linked,
  onAdd,
  onRemove,
}: {
  def: Def;
  spaceId: string;
  workItemId: string;
  linked: Linked[];
  onAdd: (toId: string) => void;
  onRemove: (relationId: string) => void;
}) {
  // 候选：同一空间里关联目标类型的工作项，去掉自己和已经关联的
  const [candidates] = useQuery(queries.workItems.bySpace({ spaceId, filter: { typeIds: [def.toTypeId] } }));
  const taken = new Set(linked.map((r) => r.item?.id));
  const options = candidates.filter((c) => c.id !== workItemId && !taken.has(c.id));

  return (
    <section aria-label={def.name} className="flex flex-col gap-1">
      <div className="text-fg-muted">
        {def.name}
        <span className="ml-1 text-xs text-fg-subtle">{def.cardinality === "one" ? "单个" : "多个"}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {linked.map(
          (r) =>
            r.item && (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <ItemLink item={r.item} />
                <button
                  type="button"
                  aria-label={`取消关联 ${r.item.name}`}
                  className="cursor-pointer rounded p-0.5 text-fg-subtle hover:bg-hover hover:text-danger-600"
                  onClick={() => onRemove(r.id)}
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ),
        )}
      </ul>
      <Select aria-label={`添加${def.name}`} value="" onChange={(e) => e.target.value && onAdd(e.target.value)}>
        <option value="">{def.cardinality === "one" && linked.length > 0 ? "更换为…" : "添加…"}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </section>
  );
}

function ItemLink({ item }: { item: ItemRef }) {
  return (
    <Link to="/items/$itemId" params={{ itemId: item.id }} className="truncate text-brand-500 hover:text-brand-600">
      {item.name}
    </Link>
  );
}
