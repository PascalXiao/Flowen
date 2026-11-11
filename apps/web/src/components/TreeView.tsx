import { type HierarchyLayerArgs, queries, type WorkItemFilterArgs } from "@fp/sync";
import { useQuery } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
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
}: {
  spaceId: string;
  filter: WorkItemFilterArgs;
  relationDefs: readonly { id: string; name: string; fromType: string; toType: string }[];
  /** 层级管理里配的层级；默认选第一个以当前工作项类型为第一层的。 */
  hierarchies?: readonly LayeredHierarchy[];
  typeId?: string;
}) {
  const preferred = hierarchies.find((h) => h.rootTypeId === typeId);
  const [mode, setMode] = useState(preferred ? `h:${preferred.id}` : "");
  const layered = mode.startsWith("h:") ? hierarchies.find((h) => `h:${h.id}` === mode) : undefined;

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
      </div>
      {layered ? (
        <LayeredTree key={layered.id} spaceId={spaceId} filter={filter} hierarchy={layered} typeId={typeId} />
      ) : (
        <SingleTree key={mode} spaceId={spaceId} filter={filter} hierarchy={{ relationDefId: mode || null }} />
      )}
    </div>
  );
}

const header = (
  <thead>
    <tr className="border-b border-line-subtle bg-canvas/60 text-left text-xs text-fg-muted">
      <th className="h-9 px-4 font-normal">名称</th>
      <th className="h-9 px-4 font-normal">类型</th>
      <th className="h-9 px-4 font-normal">阶段</th>
      <th className="h-9 px-4 font-normal">状态</th>
    </tr>
  </thead>
);

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
  const [items, result] = useQuery(
    queries.workItems.layerRoots({
      spaceId,
      filter: rootFilter,
      rootTypeId: hierarchy.rootTypeId,
      next: childSteps(hierarchy, 0).map((s) => s.step),
    }),
  );
  return (
    <>
      <table className="w-full text-sm" aria-label="工作项树">
        {header}
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
  const [edges] = useQuery(queries.workItems.layerDown({ id, step, next }));
  return edges.map((e) => (e.to ? render(e.to) : null));
}

function LayerUp({ id, step, next, render }: Parameters<typeof LayerChildren>[0]) {
  const [edges] = useQuery(queries.workItems.layerUp({ id, step, next }));
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
  const [items, result] = useQuery(queries.workItems.treeBySpace({ spaceId, filter, hierarchy }));
  const ids = new Set(items.map((i) => i.id));
  const roots = items.filter((i) => !i.incoming.some((r) => ids.has(r.fromId)));

  return (
    <>
      <table className="w-full text-sm" aria-label="工作项树">
        {header}
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
  const [edges] = useQuery(queries.workItems.children({ id, hierarchy }));
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
  return (
    <tr className="border-b border-line-subtle hover:bg-hover/50">
      <td className="h-11 px-4">
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
      <td className="px-4">{item.type && <Tag>{item.type.name}</Tag>}</td>
      <td className="px-4">{item.stage && <StageTag stage={item.stage} />}</td>
      <td className="px-4">
        <StatusTag status={item.status ?? "inProgress"} />
      </td>
    </tr>
  );
}
