import {
  type Actor,
  FlowEngine,
  FlowError,
  type FlowEvent,
  type NodeState,
  oemV289,
  type WorkItemState,
} from "@fp/engine";
import { Background, Controls, type Edge, MarkerType, type Node, ReactFlow } from "@xyflow/react";
import { useMemo, useState } from "react";
import { layoutByDepth } from "./layout.ts";

const engine = new FlowEngine(oemV289.oemFlow);
const positions = layoutByDepth(engine.graph);
const ADMIN: Actor = { userId: "admin", isSuperAdmin: true };
const F = oemV289.F;

const STATE_STYLE: Record<NodeState, string> = {
  notStarted: "bg-surface border-line text-fg-muted",
  inProgress: "bg-brand-50 border-brand-500 text-brand-600 ring-2 ring-brand-100 cursor-pointer",
  completed: "bg-success-50 border-success-500 text-success-600",
  skipped: "bg-canvas border-dashed border-line text-fg-subtle line-through",
};

const STATE_LABEL: Record<NodeState, string> = {
  notStarted: "未开始",
  inProgress: "进行中",
  completed: "已完成",
  skipped: "已跳过",
};

const MODE_LABEL = {
  singleConfirm: "单人确认",
  allConfirm: "会签",
  auto: "自动",
  subItemDriven: "子工作项驱动",
} as const;

const TOGGLES: { field: string; label: string; on: string; off: string }[] = [
  { field: F.needPhaseOut, label: "需要迭代老品下市物料风险评估", on: "是", off: "否" },
  { field: F.needLaunchPlan, label: "需要产品上市计划", on: "是", off: "否" },
  { field: F.needConceptTest, label: "需要概念测试", on: "是", off: "否" },
  { field: F.needVideo, label: "需要视频拍摄制作", on: "是", off: "否" },
  { field: F.needFiling, label: "需要备案", on: "是", off: "否" },
  { field: F.formulaLocked, label: "配方已锁定", on: "Y", off: "N" },
  { field: F.linkedSku, label: "已关联需求SKU", on: "SKU-001", off: "" },
];

const INITIAL_FIELDS: Record<string, unknown> = {
  [F.needPhaseOut]: "是",
  [F.needLaunchPlan]: "否",
  [F.needConceptTest]: "否",
  [F.needVideo]: "是",
  [F.needFiling]: "是",
  [F.formulaLocked]: "N",
  [F.linkedSku]: "SKU-001",
};

function describe(event: FlowEvent): string {
  const name = (key: string) => engine.graph.node(key).name;
  switch (event.type) {
    case "nodeStarted":
      return `${name(event.node)} 开始`;
    case "nodeCompleted":
      return `${name(event.node)} 完成${event.by ? `（${event.by}）` : "（自动）"}`;
    case "nodeSkipped":
      return `${name(event.node)} 被裁剪`;
    case "nodeRestored":
      return `${name(event.node)} 恢复`;
    case "nodeConfirmed":
      return `${event.by} 确认了 ${name(event.node)}`;
    case "nodeRolledBack":
      return `${name(event.node)} 被回滚`;
    case "stageChanged":
      return `阶段：${event.from ?? "—"} → ${event.to}`;
    case "workItemCompleted":
      return "工作项完成";
    case "workItemReopened":
      return "工作项重新打开";
    case "fieldAssigned":
      return `${name(event.node)} 改了字段 ${event.field}`;
  }
}

export function FlowDemo() {
  const [fields, setFields] = useState(INITIAL_FIELDS);
  const [{ state, log }, setRun] = useState(() => {
    const started = engine.start(INITIAL_FIELDS, oemV289.ownersByRole);
    return { state: started.state, log: started.events.map(describe).reverse() };
  });
  const [error, setError] = useState<string | null>(null);

  /** 引擎原地修改状态：先深拷贝，保证 React 拿到新对象。 */
  function apply(run: (draft: WorkItemState) => FlowEvent[]) {
    const draft = structuredClone(state);
    try {
      const events = run(draft);
      setRun({ state: draft, log: [...events.map(describe).reverse(), ...log] });
      setError(null);
    } catch (e) {
      if (e instanceof FlowError) setError(e.message);
      else throw e;
    }
  }

  /** 点进行中的节点：按它的完成方式推进一步（会签每点一次确认一个人）。 */
  function advance(key: string) {
    const node = engine.graph.node(key);
    const runtime = state.nodes[key];
    if (runtime?.state !== "inProgress") return;
    apply((draft) => {
      switch (node.completion) {
        case "subItemDriven":
          return engine.completeBySubItem(draft, key, fields);
        case "auto":
          return engine.confirm(draft, key, ADMIN, fields);
        case "allConfirm": {
          const next = runtime.owners.find((o) => !runtime.confirmations.includes(o)) ?? "admin";
          return engine.confirm(draft, key, { userId: next }, fields);
        }
        case "singleConfirm":
          return engine.confirm(draft, key, { userId: runtime.owners[0] ?? "admin" }, fields);
      }
    });
  }

  function toggle(field: string, value: string) {
    const next = { ...fields, [field]: value };
    setFields(next);
    apply((draft) => engine.onFieldsChanged(draft, next));
  }

  function reset() {
    const started = engine.start(fields, oemV289.ownersByRole);
    setRun({ state: started.state, log: started.events.map(describe).reverse() });
    setError(null);
  }

  const nodes: Node[] = useMemo(
    () =>
      engine.graph.nodes.map((n) => {
        const runtime = state.nodes[n.key];
        const nodeState = runtime?.state ?? "notStarted";
        const signed =
          n.completion === "allConfirm" ? ` ${runtime?.confirmations.length ?? 0}/${runtime?.owners.length ?? 0}` : "";
        return {
          id: n.key,
          position: positions.get(n.key) ?? { x: 0, y: 0 },
          data: {
            label: (
              <div title={`${n.key} · ${MODE_LABEL[n.completion]}`}>
                <div className="truncate font-medium">{n.name}</div>
                <div className="mt-0.5 text-[11px] opacity-75">
                  {STATE_LABEL[nodeState]} · {MODE_LABEL[n.completion]}
                  {signed}
                </div>
              </div>
            ),
          },
          className: `!w-[200px] !rounded-lg !border !px-3 !py-2 !text-left !text-xs !shadow-none ${STATE_STYLE[nodeState]}`,
          draggable: false,
        };
      }),
    [state],
  );

  const edges: Edge[] = useMemo(
    () =>
      oemV289.oemFlow.edges.map((e) => ({
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        markerEnd: { type: MarkerType.ArrowClosed },
        animated: state.nodes[e.from]?.state === "completed" && state.nodes[e.to]?.state === "inProgress",
      })),
    [state],
  );

  const counts = Object.values(state.nodes).reduce<Record<NodeState, number>>(
    (acc, n) => ({ ...acc, [n.state]: acc[n.state] + 1 }),
    { notStarted: 0, inProgress: 0, completed: 0, skipped: 0 },
  );

  return (
    <div className="flex h-screen bg-canvas font-sans text-fg">
      <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line-subtle bg-surface p-5">
        <header>
          <h1 className="text-lg font-semibold">OEM v289 流程演示</h1>
          <p className="mt-1 text-sm text-fg-muted">
            点击蓝色的进行中节点推进一步。左侧开关就是流程裁剪和卡点用到的字段。
          </p>
        </header>

        <section className="grid grid-cols-2 gap-2 text-sm">
          <Stat label="阶段" value={state.stage ?? "—"} />
          <Stat label="工作项" value={state.status === "completed" ? "已完成" : "进行中"} />
          <Stat label="已完成节点" value={`${counts.completed} / ${engine.graph.nodes.length}`} />
          <Stat label="已跳过" value={String(counts.skipped)} />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium tracking-wide text-fg-muted">字段</h2>
          {TOGGLES.map((t) => (
            <label key={t.field} className="flex items-center justify-between gap-3 text-sm">
              <span>{t.label}</span>
              <input
                id={`toggle-${t.field}`}
                type="checkbox"
                className="size-4 accent-brand-500"
                checked={fields[t.field] === t.on}
                onChange={(e) => toggle(t.field, e.target.checked ? t.on : t.off)}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={reset}
            className="mt-1 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-hover"
          >
            用当前字段重新开始
          </button>
        </section>

        {error && <p className="rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-600">{error}</p>}

        <section className="flex min-h-0 flex-col gap-2">
          <h2 className="text-xs font-medium tracking-wide text-fg-muted">事件</h2>
          <ol className="flex flex-col gap-1 text-xs text-fg-muted">
            {log.slice(0, 80).map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 事件日志只追加，不会重排
              <li key={`${log.length - i}`}>{line}</li>
            ))}
          </ol>
        </section>
      </aside>

      <main className="min-w-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={(_, node) => advance(node.id)}
          nodesConnectable={false}
          defaultViewport={{ x: 40, y: 140, zoom: 0.8 }}
          minZoom={0.2}
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-canvas px-3 py-2">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}
