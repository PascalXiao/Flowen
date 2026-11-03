import {
  type Day,
  dayFromIso,
  type FlowGraph,
  type Span,
  schedule,
  validDate,
  type WorkCalendar,
  type WorkItemState,
} from "@fp/engine";

/** 节点在库里的排期信息，用天号表示。 */
export interface NodePlan {
  start: Day | null;
  end: Day | null;
  pinned: boolean;
  actualEnd: Day | null;
}

/**
 * 按当前节点状态和手动日期重新排期。配了相对排期的节点（如从上市日倒推），
 * 基准日期字段有值时按它推算结束日；手动定过的日期优先。
 */
export function planNodes(
  graph: FlowGraph,
  calendar: WorkCalendar,
  state: WorkItemState,
  start: Day,
  plans: Readonly<Record<string, Pick<NodePlan, "start" | "end" | "pinned" | "actualEnd">>>,
  fields: Readonly<Record<string, unknown>> = {},
): Record<string, Span | null> {
  const anchorEnd = (key: string): Day | null => {
    const rule = graph.has(key) ? graph.node(key).schedule : undefined;
    const base = rule ? fields[rule.field] : undefined;
    // 日期区间字段取结束日
    const day =
      typeof base === "string"
        ? base
        : base && typeof base === "object" && "end" in base
          ? String((base as { end: unknown }).end)
          : null;
    if (!rule || !day || !validDate(day)) return null;
    return calendar.offsetWorkdays(dayFromIso(day), rule.offset);
  };
  return schedule(graph, calendar, {
    start,
    nodes: Object.fromEntries(
      Object.entries(state.nodes).map(([key, runtime]) => {
        const plan = plans[key];
        const pinned =
          plan?.pinned && plan.start != null && plan.end != null ? { start: plan.start, end: plan.end } : null;
        return [key, { state: runtime.state, pinned, actualEnd: plan?.actualEnd ?? null, anchorEnd: anchorEnd(key) }];
      }),
    ),
  });
}
