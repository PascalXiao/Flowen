import type { FlowGraph } from "../flow/definition.ts";
import type { NodeState } from "../flow/state.ts";
import type { Day, WorkCalendar } from "./calendar.ts";
import type { Span } from "./schedule.ts";

/** 从 a 到 b 差几个工作日：b 在 a 之后为正，之前为负，同一天或中间没有工作日为 0。 */
export function workdayDelta(calendar: WorkCalendar, a: Day, b: Day): number {
  if (b > a) return calendar.workdaysBetween(a + 1, b);
  if (b < a) return -calendar.workdaysBetween(b + 1, a);
  return 0;
}

export interface FloatInput {
  /** 当前计划（排期结果）；跳过的、没排期的节点是 null。 */
  spans: Readonly<Record<string, Span | null | undefined>>;
  states: Readonly<Record<string, NodeState | undefined>>;
  /** 0 天的里程碑节点：落在前序结束的那天，不占后续节点的时间。 */
  milestones?: ReadonlySet<string>;
  /** 整个计划要守住的结束日（如上市日）。不传时取计划里最晚的结束日。 */
  deadline?: Day | null;
}

export interface FloatResult {
  /** 计划里最晚的结束日。 */
  end: Day | null;
  /**
   * 每个节点还能往后拖几个工作日而不推迟整个计划（总浮动）。
   * 已完成、跳过、没排期的节点是 null；负数表示已经压线，要拖 deadline。
   */
  float: Record<string, number | null>;
  /** 关键路径：没完成、浮动 ≤ 0 的节点，任何一个延期都会推迟整个计划。 */
  critical: Set<string>;
}

/**
 * 关键路径：从计划终点往回推每个节点最晚什么时候必须完成（后续节点最晚开始的前一个工作日），
 * 和当前计划的结束日比，差出来的工作日就是浮动。
 * 和排期一样的口径：有工期的后续节点在前序结束后的下一个工作日开始；里程碑落在前序结束那天。
 * 已完成、跳过的节点不占时间，只把约束往前传。
 */
export function criticalPath(graph: FlowGraph, calendar: WorkCalendar, input: FloatInput): FloatResult {
  const live = (key: string) => {
    const state = input.states[key];
    return state !== "completed" && state !== "skipped" && input.spans[key] != null;
  };
  const ends = Object.entries(input.spans)
    .filter(([key, span]) => span && graph.has(key) && input.states[key] !== "skipped")
    .map(([, span]) => (span as Span).end);
  const end = ends.length > 0 ? Math.max(...ends) : null;
  const float: Record<string, number | null> = {};
  const critical = new Set<string>();
  if (end == null) return { end, float, critical };
  const finish = input.deadline ?? end;

  /** 节点的前序最晚什么时候必须结束。 */
  const latestReady = new Map<string, Day>();
  for (const key of graph.topologicalOrder().reverse()) {
    const succ = graph.successors(key).filter((s) => latestReady.has(s));
    const lf = succ.length > 0 ? Math.min(...succ.map((s) => latestReady.get(s) as Day)) : finish;
    const span = input.spans[key];
    if (!live(key) || !span) {
      float[key] = null;
      latestReady.set(key, lf);
      continue;
    }
    const slack = workdayDelta(calendar, span.end, calendar.onOrBefore(lf));
    float[key] = slack;
    if (slack <= 0) critical.add(key);
    const ls = slack === 0 ? span.start : calendar.offsetWorkdays(span.start, slack);
    latestReady.set(key, input.milestones?.has(key) ? ls : calendar.onOrBefore(ls - 1));
  }
  return { end, float, critical };
}

/** 基线对比：结束日比基线晚（正）或早（负）几个工作日；任一边没有日期时为 null。 */
export function baselineSlip(
  calendar: WorkCalendar,
  current: Span | null | undefined,
  baseline: Span | null | undefined,
): number | null {
  if (!current || !baseline) return null;
  return workdayDelta(calendar, baseline.end, current.end);
}
