import { type FlowGraph, type NodeState, nodeFlowOf } from "@fp/engine";
import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Tag, type TagTone } from "@/components/ui/tag";
import { newId } from "@/lib/utils";

type Allow = "start" | "complete";

/** 工作项上加的一条依赖，连同对方节点现在的状态。 */
export interface DependencyRow {
  id: string;
  nodeKey: string;
  targetNodeId: string;
  targetNodeName: string;
  allow: Allow;
  target?: {
    workItemId: string;
    nodeKey: string;
    state: NodeState | null;
    /** 对方工作项；没权限看时没有。 */
    workItem?: { id: string; name: string; status: string | null; deletedAt: number | null } | null;
  } | null;
}

/** 空间关联规则要这个节点等的源节点。 */
export interface LinkedSource {
  key: string;
  item: { id: string; name: string };
  name: string;
  state: NodeState | null;
}

/** 在等这个节点的别的节点。 */
export interface DependentRow {
  id: string;
  workItemId: string;
  nodeKey: string;
  allow: Allow;
  workItem?: { id: string; name: string } | null;
}

const STATE: Record<string, [string, TagTone]> = {
  notStarted: ["未开始", "neutral"],
  inProgress: ["进行中", "brand"],
  completed: ["已完成", "success"],
  skipped: ["已跳过", "neutral"],
};
const ALLOW: Record<Allow, string> = { start: "完成后才能开始", complete: "完成后才能完成" };

/**
 * 节点的依赖：要等哪些节点完成才能开始、才能完成。
 * 流程模板里配的对所有工作项生效，这里只能看；工作项上加的可以等本工作项或同空间别的工作项里的节点，
 * 节点负责人、可操作角色和空间管理员可以加、删。对方节点完成（或它的工作项终止）后自动放行。
 */
export function NodeDependencies({
  workItemId,
  spaceId,
  nodeKey,
  graph,
  stateOf,
  dependencies,
  dependents,
  linked = [],
  canEdit,
}: {
  workItemId: string;
  spaceId: string;
  nodeKey: string;
  graph: FlowGraph;
  stateOf: (nodeKey: string) => NodeState;
  dependencies: readonly DependencyRow[];
  dependents: readonly DependentRow[];
  /** 空间关联里「才允许完成」的源节点（源工作项没有这个节点时 state 为 null，不用等）。 */
  linked?: readonly LinkedSource[];
  canEdit: boolean;
}) {
  const zero = useZero();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const node = graph.node(nodeKey);
  const state = stateOf(nodeKey);
  const finished = state === "completed" || state === "skipped";

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

  // 流程模板里配的
  const fromTemplate = (node.dependsOn ?? [])
    .filter((d) => graph.has(d.node) && d.node !== nodeKey)
    .map((d) => ({
      key: `t-${d.node}-${d.allow}`,
      name: graph.node(d.node).name,
      allow: d.allow,
      state: stateOf(d.node),
    }));
  // 工作项上加的
  type Added = {
    row: DependencyRow;
    item: { id: string | null; name: string } | null;
    name: string;
    state: NodeState;
    released: boolean;
  };
  const added = dependencies.flatMap((d): Added[] => {
    const own = d.target ? d.target.workItemId === workItemId : d.targetNodeId.startsWith(`${workItemId}/`);
    if (own) {
      const key = d.target?.nodeKey ?? d.targetNodeId.slice(workItemId.length + 1);
      // 流程改版后不在了的节点不用等
      if (!graph.has(key)) return [];
      return [{ row: d, item: null, name: graph.node(key).name, state: stateOf(key), released: false }];
    }
    const other = d.target?.workItem;
    return [
      {
        row: d,
        item: other ? { id: other.id, name: other.name } : { id: null, name: "没有权限查看的工作项" },
        name: d.targetNodeName,
        state: d.target?.state ?? "notStarted",
        // 对方工作项终止或删除后不用再等
        released: other?.status === "terminated" || other?.deletedAt != null,
      },
    ];
  });

  const allow: Allow | null = state === "notStarted" ? "start" : state === "inProgress" ? "complete" : null;
  const open = (s: NodeState) => s !== "completed" && s !== "skipped";
  const waiting = allow
    ? [
        ...fromTemplate.filter((d) => d.allow === allow && open(d.state)).map((d) => d.name),
        ...added
          .filter((d) => d.row.allow === allow && open(d.state) && !d.released)
          .map((d) => (d.item ? `${d.item.name} · ${d.name}` : d.name)),
        ...(allow === "complete"
          ? linked.filter((l) => l.state !== null && open(l.state)).map((l) => `${l.item.name} · ${l.name}`)
          : []),
      ]
    : [];

  if (
    fromTemplate.length === 0 &&
    added.length === 0 &&
    linked.length === 0 &&
    dependents.length === 0 &&
    (!canEdit || finished)
  )
    return null;
  return (
    <fieldset aria-label={`${node.name}的依赖`} className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-2 text-fg-muted">
        <span>依赖</span>
        {canEdit && !finished && !adding && (
          <button
            type="button"
            className="flex cursor-pointer items-center gap-0.5 rounded px-1 text-xs text-brand-500 hover:bg-hover"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-3" />
            添加依赖
          </button>
        )}
      </div>
      {waiting.length > 0 && allow && (
        <p role="note" className="rounded bg-warning-50 px-2 py-1 text-xs text-warning-600">
          要等{waiting.map((w) => `「${w}」`).join("、")}完成才能{allow === "start" ? "开始" : "完成"}
        </p>
      )}
      {(fromTemplate.length > 0 || added.length > 0 || linked.length > 0) && (
        <ul className="flex flex-col">
          {fromTemplate.map((d) => (
            <li key={d.key} className="flex h-8 items-center gap-2 px-1">
              <span className="min-w-0 truncate">{d.name}</span>
              <span className="shrink-0 text-xs text-fg-subtle">{ALLOW[d.allow]}</span>
              <Tag tone={STATE[d.state]?.[1]}>{STATE[d.state]?.[0]}</Tag>
              <span className="ml-auto shrink-0 text-xs text-fg-subtle" title="在流程模板里配置，对所有工作项生效">
                流程模板
              </span>
            </li>
          ))}
          {linked.map((l) => (
            <li key={l.key} className="flex h-8 items-center gap-2 px-1">
              <span className="min-w-0 truncate">
                <Link
                  to="/items/$itemId"
                  params={{ itemId: l.item.id }}
                  className="text-brand-500 hover:text-brand-600"
                >
                  {l.item.name}
                </Link>
                {` · ${l.name}`}
              </span>
              <span className="shrink-0 text-xs text-fg-subtle">{ALLOW.complete}</span>
              {l.state ? <Tag tone={STATE[l.state]?.[1]}>{STATE[l.state]?.[0]}</Tag> : <Tag>没有这个节点</Tag>}
              <span className="ml-auto shrink-0 text-xs text-fg-subtle" title="在空间配置的「空间关联」里配置">
                空间关联
              </span>
            </li>
          ))}
          {added.map((d) => (
            <li key={d.row.id} className="group flex h-8 items-center gap-2 rounded-md px-1 hover:bg-hover/60">
              <span className="min-w-0 truncate">
                {d.item &&
                  (d.item.id ? (
                    <Link
                      to="/items/$itemId"
                      params={{ itemId: d.item.id }}
                      className="text-brand-500 hover:text-brand-600"
                    >
                      {d.item.name}
                    </Link>
                  ) : (
                    <span className="text-fg-subtle">{d.item.name}</span>
                  ))}
                {d.item && " · "}
                {d.name}
              </span>
              <span className="shrink-0 text-xs text-fg-subtle">{ALLOW[d.row.allow]}</span>
              {d.released ? <Tag>已终止，不用等</Tag> : <Tag tone={STATE[d.state]?.[1]}>{STATE[d.state]?.[0]}</Tag>}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`删除依赖 ${d.item ? `${d.item.name} · ` : ""}${d.name}`}
                  className="ml-auto cursor-pointer rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-danger-600 focus:opacity-100"
                  onClick={() => run(mutators.dependency.remove({ id: d.row.id }))}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <AddForm
          workItemId={workItemId}
          spaceId={spaceId}
          nodeKey={nodeKey}
          graph={graph}
          stateOf={stateOf}
          onAdd={async (target) => {
            if (await run(mutators.dependency.add({ id: newId(), workItemId, nodeKey, ...target }))) setAdding(false);
          }}
          onCancel={() => {
            setAdding(false);
            setError(null);
          }}
        />
      )}
      {error && <p className="text-xs text-danger-600">{error}</p>}
      {dependents.length > 0 && (
        <p className="text-xs text-fg-subtle">
          在等这个节点的：
          {dependents.map((d, i) => (
            <span key={d.id}>
              {i > 0 && "、"}
              {d.workItemId === workItemId ? (
                graph.has(d.nodeKey) ? (
                  graph.node(d.nodeKey).name
                ) : (
                  d.nodeKey
                )
              ) : d.workItem ? (
                <Link to="/items/$itemId" params={{ itemId: d.workItem.id }} className="text-brand-500">
                  {d.workItem.name}
                </Link>
              ) : (
                "别的工作项"
              )}
            </span>
          ))}
        </p>
      )}
    </fieldset>
  );
}

/** 选要等的节点：本工作项里的，或同空间别的工作项里的。 */
function AddForm({
  workItemId,
  spaceId,
  nodeKey,
  graph,
  stateOf,
  onAdd,
  onCancel,
}: {
  workItemId: string;
  spaceId: string;
  nodeKey: string;
  graph: FlowGraph;
  stateOf: (nodeKey: string) => NodeState;
  onAdd: (target: { targetItemId: string; targetNodeKey: string; allow: Allow }) => void;
  onCancel: () => void;
}) {
  const started = stateOf(nodeKey) === "inProgress";
  const [itemId, setItemId] = useState(workItemId);
  const [targetNode, setTargetNode] = useState("");
  const [allow, setAllow] = useState<Allow>(started ? "complete" : "start");
  const [items] = useQuery(queries.workItems.bySpace({ spaceId }));
  const [other] = useQuery(queries.workItems.flowById({ id: itemId }), { enabled: itemId !== workItemId });

  // 本工作项里：去掉自己、自己后面的节点和跳过的节点
  const after = graph.descendants(nodeKey);
  const nodes =
    itemId === workItemId
      ? graph.nodes
          .filter((n) => n.key !== nodeKey && !after.has(n.key) && stateOf(n.key) !== "skipped")
          .map((n) => ({ key: n.key, name: n.name, state: stateOf(n.key) }))
      : (nodeFlowOf(other?.flowVersion?.definition)?.nodes ?? []).flatMap((n) => {
          const state = other?.nodes.find((i) => i.nodeKey === n.key)?.state ?? "notStarted";
          return state === "skipped" ? [] : [{ key: n.key, name: n.name, state }];
        });

  return (
    <form
      aria-label="添加依赖"
      className="flex flex-wrap items-center gap-1.5 rounded-md bg-canvas/60 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (targetNode) onAdd({ targetItemId: itemId, targetNodeKey: targetNode, allow });
      }}
    >
      <span className="text-xs text-fg-muted">等</span>
      <Select
        aria-label="依赖的工作项"
        className="h-7 w-44"
        value={itemId}
        onChange={(e) => {
          setItemId(e.target.value);
          setTargetNode("");
        }}
      >
        <option value={workItemId}>本工作项</option>
        {items
          .filter((i) => i.id !== workItemId)
          .map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
      </Select>
      <Select
        aria-label="依赖的节点"
        className="h-7 w-40"
        value={targetNode}
        onChange={(e) => setTargetNode(e.target.value)}
      >
        <option value="">选择节点…</option>
        {nodes.map((n) => (
          <option key={n.key} value={n.key}>
            {n.name}
            {n.state === "completed" ? "（已完成）" : ""}
          </option>
        ))}
      </Select>
      <Select
        aria-label="依赖类型"
        className="h-7 w-36"
        value={allow}
        onChange={(e) => setAllow(e.target.value as Allow)}
      >
        <option value="start" disabled={started}>
          完成后才能开始
        </option>
        <option value="complete">完成后才能完成</option>
      </Select>
      <Button size="sm" type="submit" disabled={!targetNode}>
        添加
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
        取消
      </Button>
    </form>
  );
}
