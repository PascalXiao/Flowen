import { describe, expect, it } from "vitest";
import { peopleSchedule, type ScheduleNode } from "../src/index.ts";

const node = (over: Partial<ScheduleNode>): ScheduleNode => ({
  workItemId: "w1",
  workItemName: "面霜",
  nodeKey: "n",
  nodeName: "开发",
  state: "inProgress",
  owners: ["a"],
  start: 10,
  end: 12,
  points: 2,
  ...over,
});

describe("peopleSchedule", () => {
  it("splits a node's points between its owners and sorts people by total points", () => {
    const people = peopleSchedule([
      node({ nodeKey: "x", owners: ["a", "b"], points: 3 }),
      node({ nodeKey: "y", owners: ["b"], start: 5, end: 6, points: 1 }),
    ]);
    expect(people.map((p) => [p.userId, p.points])).toEqual([
      ["b", 2.5],
      ["a", 1.5],
    ]);
    expect(people[0]?.scheduled.map((e) => e.nodeKey)).toEqual(["y", "x"]);
  });

  it("keeps undated nodes apart and skips skipped and (by default) completed nodes", () => {
    const nodes = [
      node({ nodeKey: "u", start: null, end: null }),
      node({ nodeKey: "s", state: "skipped" }),
      node({ nodeKey: "c", state: "completed" }),
    ];
    const [a] = peopleSchedule(nodes);
    expect(a?.scheduled).toEqual([]);
    expect(a?.unscheduled.map((e) => e.nodeKey)).toEqual(["u"]);
    expect(a?.points).toBe(0);
    expect(peopleSchedule(nodes, { includeCompleted: true })[0]?.scheduled.map((e) => e.nodeKey)).toEqual(["c"]);
  });
});
