import type { StatusCategory, StatusFlowDefinition } from "@fp/engine";
import { Background, type Edge, MarkerType, type Node, Position, ReactFlow } from "@xyflow/react";
import { cn } from "@/lib/utils";

export const CATEGORY_LABEL: Record<StatusCategory, string> = {
  todo: "未开始",
  doing: "进行中",
  done: "已完成",
  closed: "已关闭",
};

const CATEGORY_DOT: Record<StatusCategory, string> = {
  todo: "bg-fg-subtle",
  doing: "bg-brand-500",
  done: "bg-success-500",
  closed: "bg-fg-disabled",
};

/** 状态的列：从初始状态出发按流转走到它的最少步数；走不到的放最后一列。 */
function columns(definition: StatusFlowDefinition): Map<string, number> {
  const depth = new Map<string, number>();
  const first = definition.statuses[0]?.key;
  if (first === undefined) return depth;
  depth.set(first, 0);
  const queue = [first];
  while (queue.length > 0) {
    const key = queue.shift() as string;
    for (const t of definition.transitions)
      if (t.from === key && !depth.has(t.to)) {
        depth.set(t.to, (depth.get(key) ?? 0) + 1);
        queue.push(t.to);
      }
  }
  const last = Math.max(0, ...depth.values()) + 1;
  for (const s of definition.statuses) if (!depth.has(s.key)) depth.set(s.key, last);
  return depth;
}

/** 状态流图：状态从左到右排开，往回走的流转用虚线。current 是工作项的当前状态。 */
export function StatusDiagram({
  definition,
  current,
  className,
}: {
  definition: StatusFlowDefinition;
  current?: string | null;
  className?: string;
}) {
  const depth = columns(definition);
  const rows = new Map<number, number>();
  const nodes: Node[] = definition.statuses.map((s) => {
    const column = depth.get(s.key) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return {
      id: s.key,
      position: { x: column * 190, y: row * 70 },
      data: {
        label: (
          <span className="flex items-center gap-2">
            <span className={cn("size-2 shrink-0 rounded-full", CATEGORY_DOT[s.category])} />
            <span className="truncate">{s.name}</span>
          </span>
        ),
      },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      className: cn(
        "!w-[140px] !rounded-lg !border !border-line !bg-surface !px-3 !py-2 !text-left !text-[13px] !shadow-card",
        s.key === current && "!border-brand-500 !font-medium !ring-3 !ring-brand-100",
      ),
    };
  });
  const edges: Edge[] = definition.transitions.map((t) => {
    const back = (depth.get(t.to) ?? 0) <= (depth.get(t.from) ?? 0);
    const color = back ? "var(--color-fg-disabled)" : "var(--color-fg-subtle)";
    return {
      id: `${t.from}->${t.to}`,
      source: t.from,
      target: t.to,
      type: back ? "default" : "smoothstep",
      style: { stroke: color, strokeWidth: 1.5, ...(back && { strokeDasharray: "4 3" }) },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    };
  });
  return (
    <div className={cn("h-48", className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        className="readonly bg-canvas"
      >
        <Background color="var(--color-line)" gap={20} />
      </ReactFlow>
    </div>
  );
}
