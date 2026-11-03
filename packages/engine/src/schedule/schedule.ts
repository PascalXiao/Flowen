import type { FlowGraph, NodeDefinition } from "../flow/definition.ts";
import type { NodeState } from "../flow/state.ts";
import type { Day, WorkCalendar } from "./calendar.ts";

export interface Span {
  start: Day;
  end: Day;
}

export interface ScheduleNodeInput {
  state: NodeState;
  /** 负责人手动定过的日期，重排时不动。 */
  pinned?: Span | null;
  /** 节点实际完成的日期。已完成的节点按它推后续节点。 */
  actualEnd?: Day | null;
  /** 相对排期算出的计划结束日（如上市日往前推 N 个工作日）。手动定过的日期优先。 */
  anchorEnd?: Day | null;
}

export interface ScheduleInput {
  /** 第一个节点最早的开始日期，通常是工作项创建那天。 */
  start: Day;
  nodes: Readonly<Record<string, ScheduleNodeInput>>;
}

/** 节点的预估工期（工作日）。没有配置时，需要人处理的节点按 1 天，自动节点是 0 天的里程碑。 */
export function durationOf(node: NodeDefinition): number {
  if (node.milestone) return 0;
  if (node.duration !== undefined) return Math.max(0, Math.floor(node.duration));
  return node.completion === "auto" ? 0 : 1;
}

/**
 * 按依赖关系推算每个节点的计划日期：节点在所有前序结束后的下一个工作日开始，持续它的工期。
 * - 跳过的节点没有日期，只把前序的结束时间传给后续节点；
 * - 手动定过日期的节点保留原日期，后续节点从它的结束日期往后排；
 * - 已完成的节点用实际完成日期往后推（完成当天后续节点就可以开始），延误会自动顺延到后面。
 * 0 天的节点是里程碑，落在前序结束的那天，不占后续节点的时间。
 */
export function schedule(graph: FlowGraph, calendar: WorkCalendar, input: ScheduleInput): Record<string, Span | null> {
  const result: Record<string, Span | null> = {};
  /** 节点对后续节点而言的结束日；没有前序的节点以 start 的前一天作为“前序结束”。 */
  const finish = new Map<string, Day>();

  for (const key of graph.topologicalOrder()) {
    const node = graph.node(key);
    const info = input.nodes[key];
    const preds = graph.predecessors(key);
    const ready =
      preds.length === 0 ? input.start - 1 : Math.max(...preds.map((p) => finish.get(p) ?? input.start - 1));

    if (info?.state === "skipped") {
      result[key] = null;
      finish.set(key, ready);
      continue;
    }

    const duration = durationOf(node);
    let span: Span;
    // 里程碑不占工期：后续节点照常从前序结束后的下一个工作日开始
    let end = ready;
    if (info?.pinned) {
      span = info.pinned;
      end = span.end;
    } else if (info?.anchorEnd != null) {
      // 相对排期：结束日由基准日期推出，开始日往前数工期
      const anchor = calendar.onOrBefore(info.anchorEnd);
      span = { start: duration === 0 ? anchor : calendar.offsetWorkdays(anchor, -(duration - 1)), end: anchor };
      end = anchor;
    } else if (duration === 0) {
      const day = Math.max(ready, input.start);
      span = { start: day, end: day };
    } else {
      const start = calendar.onOrAfter(ready + 1);
      span = { start, end: calendar.addWorkdays(start, duration - 1) };
      end = span.end;
    }
    result[key] = span;
    // 已完成的节点：完成当天后续节点就可以开始，所以“结束”记为完成日的前一天
    finish.set(key, info?.state === "completed" && info.actualEnd != null ? Math.max(info.actualEnd - 1, ready) : end);
  }
  return result;
}
