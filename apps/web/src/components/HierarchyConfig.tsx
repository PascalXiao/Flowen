import { Popconfirm } from "@douyinfe/semi-ui";
import { type HierarchyLayerArgs, MAX_HIERARCHIES, MAX_HIERARCHY_DEPTH, mutators, nextSteps } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { ChevronRight } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { newId } from "@/lib/utils";

interface RelationDef {
  id: string;
  name: string;
  reverseName: string | null;
  fromTypeId: string;
  toTypeId: string;
}

export interface HierarchyRow {
  id: string;
  name: string;
  rootTypeId: string;
  layers: readonly HierarchyLayerArgs[];
}

/** 一层在界面上怎么称呼它和上一层之间的关系。 */
export function layerVia(layer: HierarchyLayerArgs, defs: readonly RelationDef[]): string {
  if (layer.relationDefId === null) return "子工作项";
  const def = defs.find((d) => d.id === layer.relationDefId);
  if (!def) return "关系已删除";
  return layer.reverse ? (def.reverseName ?? `${def.name}（反向）`) : def.name;
}

const stepKey = (s: { relationDefId: string | null; reverse?: boolean; typeId: string }) =>
  `${s.relationDefId ?? ""}|${s.reverse ? 1 : 0}|${s.typeId}`;

/**
 * 层级管理：按关系把工作项类型排成一棵多层的树（第一层是树根），树形视图按它展开。
 * 每一层沿一条关系从上一层找到，可以是自定义关系（两个方向都行）或子工作项关系；
 * 同类型的关系可以「层级循环」，一层套一层。只有空间管理员可以改。
 */
export function HierarchyConfig({
  spaceId,
  types,
  defs,
  hierarchies,
  isAdmin,
}: {
  spaceId: string;
  types: readonly { id: string; name: string }[];
  defs: readonly RelationDef[];
  hierarchies: readonly HierarchyRow[];
  isAdmin: boolean;
}) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);

  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const outcome = await zero.mutate(request).client;
    if (outcome.type === "error") {
      setError(outcome.error.message);
      return false;
    }
    return true;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <h2 className="text-lg font-semibold">层级管理</h2>
          <p className="text-sm text-fg-muted">
            {`按关系把工作项排成多层的树，比如「项目 → 需求 → 任务」。树形视图里选一个层级，就按它一层层展开。最多 ${MAX_HIERARCHIES} 个层级，每个最多 ${MAX_HIERARCHY_DEPTH} 层。`}
          </p>
        </div>
        {isAdmin && hierarchies.length < MAX_HIERARCHIES && (
          <CreateHierarchy spaceId={spaceId} types={types} onCreate={run} />
        )}
      </div>
      <ul aria-label="层级列表" className="flex flex-col gap-3">
        {hierarchies.map((h) => (
          <HierarchyCard key={h.id} hierarchy={h} types={types} defs={defs} isAdmin={isAdmin} run={run} />
        ))}
        {hierarchies.length === 0 && (
          <li className="rounded-lg border border-line-subtle bg-surface px-4 py-8 text-center text-sm text-fg-muted">
            还没有层级。
          </li>
        )}
      </ul>
      <p className="text-xs text-fg-subtle">自定义关系在「关系管理」里建；层级里用到的关系不能删除。</p>
    </div>
  );
}

function HierarchyCard({
  hierarchy,
  types,
  defs,
  isAdmin,
  run,
}: {
  hierarchy: HierarchyRow;
  types: readonly { id: string; name: string }[];
  defs: readonly RelationDef[];
  isAdmin: boolean;
  run: (request: Parameters<ReturnType<typeof useZero>["mutate"]>[0]) => Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? "?";
  const layers = hierarchy.layers;
  const lastType = layers[layers.length - 1]?.typeId ?? hierarchy.rootTypeId;
  const full = layers.length + 1 >= MAX_HIERARCHY_DEPTH;
  const setLayers = (next: HierarchyLayerArgs[]) => run(mutators.hierarchy.update({ id: hierarchy.id, layers: next }));

  return (
    <li
      aria-label={hierarchy.name}
      className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface px-4 py-3 shadow-card"
    >
      <div className="flex items-center gap-2">
        {renaming === null ? (
          <span className="font-medium">{hierarchy.name}</span>
        ) : (
          <form
            className="flex items-center gap-1.5"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(mutators.hierarchy.update({ id: hierarchy.id, name: renaming }))) setRenaming(null);
            }}
          >
            <Input
              aria-label="层级名称"
              className="h-7 w-48"
              autoFocus
              value={renaming}
              maxLength={50}
              onChange={(e) => setRenaming(e.target.value)}
            />
            <Button size="sm" type="submit">
              保存
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(null)}>
              取消
            </Button>
          </form>
        )}
        <span className="text-xs text-fg-subtle">{layers.length + 1} 层</span>
        {isAdmin && renaming === null && (
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setRenaming(hierarchy.name)}>
              重命名
            </Button>
            <Popconfirm
              title={`删除层级「${hierarchy.name}」？`}
              content="只删这个层级的配置，不影响工作项和关系。"
              okText="删除"
              okType="danger"
              onConfirm={() => run(mutators.hierarchy.delete({ id: hierarchy.id }))}
            >
              <Button size="sm" variant="ghost">
                删除
              </Button>
            </Popconfirm>
          </span>
        )}
      </div>
      <ol aria-label={`${hierarchy.name}的层级`} className="flex flex-wrap items-center gap-y-2">
        <li className="flex items-center gap-1.5 rounded-md border border-line-subtle px-2 py-1 text-sm">
          <span className="text-xs text-fg-subtle">第 1 层</span>
          {typeName(hierarchy.rootTypeId)}
        </li>
        {layers.map((layer, i) => (
          <li key={`${i}-${stepKey(layer)}`} className="flex items-center gap-1.5">
            <span className="flex items-center px-1 text-xs text-fg-subtle">
              <ChevronRight className="size-3.5" />
              {layerVia(layer, [...defs])}
              <ChevronRight className="size-3.5" />
            </span>
            <span className="flex items-center gap-1.5 rounded-md border border-line-subtle px-2 py-1 text-sm">
              <span className="text-xs text-fg-subtle">第 {i + 2} 层</span>
              {typeName(layer.typeId)}
              {layer.repeat && <Tag tone="violet">循环</Tag>}
              {isAdmin && i === layers.length - 1 && (
                <button
                  type="button"
                  aria-label={`删除第 ${i + 2} 层`}
                  className="cursor-pointer rounded px-1 text-xs text-fg-subtle hover:bg-hover hover:text-danger-600"
                  onClick={() => setLayers(layers.slice(0, -1))}
                >
                  ×
                </button>
              )}
            </span>
          </li>
        ))}
        {isAdmin && !full && !adding && (
          <li className="ml-2">
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              新增下一层级
            </Button>
          </li>
        )}
      </ol>
      {adding && (
        <AddLayer
          parentTypeId={lastType}
          types={types}
          defs={defs}
          onAdd={async (layer) => {
            if (await setLayers([...layers, layer])) setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </li>
  );
}

function AddLayer({
  parentTypeId,
  types,
  defs,
  onAdd,
  onCancel,
}: {
  parentTypeId: string;
  types: readonly { id: string; name: string }[];
  defs: readonly RelationDef[];
  onAdd: (layer: HierarchyLayerArgs) => void;
  onCancel: () => void;
}) {
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? "?";
  const steps = nextSteps(
    parentTypeId,
    defs,
    types.map((t) => t.id),
  );
  const [key, setKey] = useState(steps[0] ? stepKey(steps[0]) : "");
  const [repeat, setRepeat] = useState(false);
  const step = steps.find((s) => stepKey(s) === key);
  // 同类型才能循环：同类型的自定义关系，或者同类型的子工作项
  const canRepeat = step?.typeId === parentTypeId;

  return (
    <form
      aria-label="新增下一层级"
      className="flex flex-wrap items-center gap-2 rounded-md bg-canvas/60 p-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (step)
          onAdd({
            typeId: step.typeId,
            relationDefId: step.relationDefId,
            reverse: step.reverse,
            repeat: canRepeat && repeat,
          });
      }}
    >
      <span className="text-fg-muted">从「{typeName(parentTypeId)}」通过</span>
      <Select aria-label="下一层级" className="h-7 w-72" value={key} onChange={(e) => setKey(e.target.value)}>
        {steps.map((s) => (
          <option key={stepKey(s)} value={stepKey(s)}>
            {layerVia({ ...s }, defs)} → {typeName(s.typeId)}
          </option>
        ))}
      </Select>
      {canRepeat && (
        <label className="flex items-center gap-1.5">
          <Checkbox aria-label="层级循环" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
          层级循环
          <span className="text-xs text-fg-subtle">（同类型可以一层套一层）</span>
        </label>
      )}
      <Button size="sm" type="submit" disabled={!step}>
        添加
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
        取消
      </Button>
    </form>
  );
}

function CreateHierarchy({
  spaceId,
  types,
  onCreate,
}: {
  spaceId: string;
  types: readonly { id: string; name: string }[];
  onCreate: (request: Parameters<ReturnType<typeof useZero>["mutate"]>[0]) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [rootTypeId, setRootTypeId] = useState(types[0]?.id ?? "");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (await onCreate(mutators.hierarchy.create({ id: newId(), spaceId, name, rootTypeId, layers: [] })))
      setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>新建层级</Button>
      </DialogTrigger>
      <DialogContent title="新建层级">
        <form className="flex flex-col gap-3" onSubmit={create}>
          <Field label="层级名称">
            <Input name="name" required maxLength={50} />
          </Field>
          <Field label="第一层工作项" hint="树根是哪种工作项，建好后再一层层往下加">
            <Select value={rootTypeId} onChange={(e) => setRootTypeId(e.target.value)}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit">确定</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
