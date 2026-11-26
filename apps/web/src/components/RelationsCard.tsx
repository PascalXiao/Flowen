import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
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
  /** 候选工作项所在的空间（跨空间关联是另一个空间）。 */
  otherSpaceId?: string;
  cardinality: "one" | "many";
}
/** 互相关联在本工作项这一端的字段：别的工作项（fromTypeId 类型）关联到本工作项。 */
interface ReverseDef {
  id: string;
  name: string;
  fromTypeId: string;
  otherSpaceId?: string;
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
  itemName = "",
  spaceId,
  defs,
  reverseDefs = [],
  outgoing,
  incoming,
  title = "关联",
}: {
  title?: string;
  workItemId: string;
  /** 同步创建时新工作项的默认名称。 */
  itemName?: string;
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
            onCreate={(name, copyFields) =>
              run(
                mutators.relation.createItem({
                  id: newId(),
                  relationId: newId(),
                  relationDefId: def.id,
                  itemId: workItemId,
                  side: "to",
                  name,
                  copyFields,
                }),
              )
            }
            itemName={itemName}
          />
        ))}
        {reverseDefs.map((def) => (
          <RelationGroup
            key={def.id}
            def={{
              id: def.id,
              name: def.name,
              toTypeId: def.fromTypeId,
              cardinality: def.cardinality,
              ...(def.otherSpaceId && { otherSpaceId: def.otherSpaceId }),
            }}
            spaceId={spaceId}
            workItemId={workItemId}
            linked={incoming.filter((r) => r.relationDefId === def.id)}
            onAdd={(otherId) =>
              run(mutators.relation.add({ id: newId(), relationDefId: def.id, fromId: otherId, toId: workItemId }))
            }
            onRemove={(id) => run(mutators.relation.remove({ id }))}
            onCreate={(name, copyFields) =>
              run(
                mutators.relation.createItem({
                  id: newId(),
                  relationId: newId(),
                  relationDefId: def.id,
                  itemId: workItemId,
                  side: "from",
                  name,
                  copyFields,
                }),
              )
            }
            itemName={itemName}
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
  onCreate,
  itemName,
}: {
  def: Def;
  spaceId: string;
  workItemId: string;
  linked: Linked[];
  onAdd: (toId: string) => void;
  onRemove: (relationId: string) => void;
  onCreate: (name: string, copyFields: boolean) => Promise<void>;
  itemName: string;
}) {
  const [creating, setCreating] = useState(false);
  // 候选：目标类型所在空间（跨空间关联是另一个空间）里的工作项，去掉自己和已经关联的
  const [candidates] = useQuery(
    queries.workItems.bySpace({ spaceId: def.otherSpaceId ?? spaceId, filter: { typeIds: [def.toTypeId] } }),
  );
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
      <div className="flex items-center gap-1.5">
        <Select
          aria-label={`添加${def.name}`}
          className="min-w-0 flex-1"
          value=""
          onChange={(e) => e.target.value && onAdd(e.target.value)}
        >
          <option value="">{def.cardinality === "one" && linked.length > 0 ? "更换为…" : "添加…"}</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button variant="outline" aria-label={`新建${def.name}`} onClick={() => setCreating(true)}>
          <Plus />
          新建
        </Button>
      </div>
      {creating && (
        <CreateLinked
          title={`新建${def.name}`}
          crossSpace={!!def.otherSpaceId && def.otherSpaceId !== spaceId}
          defaultName={itemName}
          onClose={() => setCreating(false)}
          onCreate={async (name, copyFields) => {
            // 不等服务端确认：浏览器里乐观建好就关掉，出错时提示在卡片下面
            setCreating(false);
            await onCreate(name, copyFields);
          }}
        />
      )}
    </section>
  );
}

function ItemLink({ item }: { item: ItemRef }) {
  return (
    <Link to="/items/$itemId" params={{ itemId: item.id }} className="truncate text-accent hover:text-accent">
      {item.name}
    </Link>
  );
}

/**
 * 同步创建：在关联的另一端新建一个工作项并直接关联上（跨空间关联就建在对方空间里）。
 * 默认带上同键、同类型的字段值；这条关联上的字段同步规则也会照常同步。
 */
function CreateLinked({
  title,
  crossSpace,
  defaultName,
  onClose,
  onCreate,
}: {
  title: string;
  crossSpace: boolean;
  defaultName: string;
  onClose: () => void;
  onCreate: (name: string, copyFields: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  const [copyFields, setCopyFields] = useState(true);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await onCreate(name.trim(), copyFields);
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={title}>
        <form className="flex flex-col gap-3" onSubmit={submit}>
          {crossSpace && (
            <p className="text-sm text-fg-muted">
              这条关联的另一端在别的空间，新工作项会建在那个空间里，并和当前工作项关联。
            </p>
          )}
          <Field label="名称">
            <Input
              aria-label="新工作项名称"
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              aria-label="带上同名字段"
              checked={copyFields}
              onChange={(e) => setCopyFields(e.target.checked)}
            />
            带上同名字段的值
            <span className="text-xs text-fg-subtle">（字段键和类型都相同的才带）</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              创建并关联
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
