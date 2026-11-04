import type { NodeState } from "../flow/state.ts";
import type { Day } from "./calendar.ts";

/** 人员排期要用的节点：所属工作项、负责人、计划起止（天号）、估分。 */
export interface ScheduleNode {
  workItemId: string;
  workItemName: string;
  nodeKey: string;
  nodeName: string;
  state: NodeState;
  owners: readonly string[];
  start: Day | null;
  end: Day | null;
  points: number | null;
}

/** 一个人名下的一条排期项：估分按负责人平分（对照飞书「动态计算」：节点估分在负责人间平均分配）。 */
export interface PersonScheduleEntry extends ScheduleNode {
  share: number | null;
}

export interface PersonSchedule {
  userId: string;
  /** 有起止日期的排期项，按开始日期排。 */
  scheduled: PersonScheduleEntry[];
  /** 负责但还没填排期的节点。 */
  unscheduled: PersonScheduleEntry[];
  /** 已排期项的估分合计。 */
  points: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * 人员排期（对照飞书项目的人员排期视图）：把节点按负责人摊开，每人一组。
 * 跳过的节点不算；完成的节点按 includeCompleted 决定；按总估分从高到低排，同分按已排期项数。
 */
export function peopleSchedule(
  nodes: readonly ScheduleNode[],
  options: { includeCompleted?: boolean } = {},
): PersonSchedule[] {
  const people = new Map<string, PersonSchedule>();
  for (const node of nodes) {
    if (node.state === "skipped") continue;
    if (node.state === "completed" && !options.includeCompleted) continue;
    const owners = [...new Set(node.owners)];
    for (const userId of owners) {
      const person = people.get(userId) ?? { userId, scheduled: [], unscheduled: [], points: 0 };
      const share = node.points == null ? null : round(node.points / owners.length);
      const entry = { ...node, share };
      if (node.start != null && node.end != null) {
        person.scheduled.push(entry);
        person.points = round(person.points + (share ?? 0));
      } else person.unscheduled.push(entry);
      people.set(userId, person);
    }
  }
  for (const p of people.values())
    p.scheduled.sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.end ?? 0) - (b.end ?? 0));
  return [...people.values()].sort((a, b) => b.points - a.points || b.scheduled.length - a.scheduled.length);
}
