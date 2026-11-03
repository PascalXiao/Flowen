import { describe, expect, it } from "vitest";
import {
  businessLineOptions,
  canEditRoleMembers,
  checkBusinessLines,
  cond,
  conditionView,
  defaultRoleMembers,
  initialRoleMembers,
  normalizeFieldValue,
  type RuleRole,
  roleAppears,
  roleRemovable,
} from "../src/index.ts";

const lines = [
  { id: "kim", name: "KIMTRUE" },
  { id: "qc", name: "且初", parentId: "kim" },
  { id: "oncur", name: "ONCUR" },
];
const lineField = {
  key: "line",
  name: "业务线",
  dataType: "businessLine" as const,
  options: businessLineOptions(lines),
};
const view = (line: string | null) => conditionView([lineField], { line });

describe("roles", () => {
  const roles: RuleRole[] = [
    { key: "owner", name: "负责人", config: { single: true, isOwner: true } },
    {
      key: "risk",
      name: "风控审核",
      config: {
        appear: { mode: "conditional", when: cond.equal("line", "kim") },
        assign: { mode: "fixed", members: ["r1"] },
      },
    },
    { key: "extra", name: "外协", config: { appear: { mode: "hidden" } } },
    {
      key: "npd",
      name: "NPD",
      config: {
        assign: {
          mode: "conditional",
          rules: [
            { when: cond.equal("line", "qc"), members: ["n1"] },
            { when: cond.equal("line", "kim"), members: ["n2"] },
          ],
          fallback: ["n0"],
        },
      },
    },
  ];

  it("appears by mode, condition and manual overrides", () => {
    expect(roles.map((r) => roleAppears(r, view("qc")))).toEqual([true, true, false, true]);
    expect(roleAppears(roles[1] as RuleRole, view("oncur"))).toBe(false);
    expect(roleAppears(roles[2] as RuleRole, view(null), { added: ["extra"] })).toBe(true);
    expect(roleAppears(roles[0] as RuleRole, view(null), { removed: ["owner"] })).toBe(false);
    expect(roleRemovable({ key: "x", name: "x", config: { appear: { mode: "default", allowRemove: false } } })).toBe(
      false,
    );
  });

  it("assigns default members; business line children match parent conditions", () => {
    expect(defaultRoleMembers(roles[3] as RuleRole, view("qc"), "me")).toEqual(["n1"]);
    const union: RuleRole = {
      key: "u",
      name: "u",
      config: {
        assign: {
          mode: "conditional",
          combine: "union",
          rules: [
            { when: cond.equal("line", "qc"), members: ["n1"] },
            { when: cond.equal("line", "kim"), members: ["n2"] },
          ],
        },
      },
    };
    expect(defaultRoleMembers(union, view("qc"), "me")).toEqual(["n1", "n2"]);
    expect(defaultRoleMembers(roles[3] as RuleRole, view("oncur"), "me")).toEqual(["n0"]);
    expect(initialRoleMembers(roles, view("oncur"), "me")).toEqual({ owner: ["me"], npd: ["n0"] });
  });

  it("limits single roles and checks who may edit members", () => {
    const single: RuleRole = {
      key: "s",
      name: "s",
      config: { single: true, assign: { mode: "fixed", members: ["a", "b"] } },
    };
    expect(defaultRoleMembers(single, {}, "me")).toEqual(["a"]);
    const who = { isAdmin: false, isCreator: false, roles: ["pm"] };
    expect(canEditRoleMembers({ key: "x", name: "x" }, who)).toBe(true);
    expect(canEditRoleMembers({ key: "x", name: "x", config: { editors: { mode: "admin" } } }, who)).toBe(false);
    expect(
      canEditRoleMembers({ key: "x", name: "x", config: { editors: { mode: "roles", roles: ["pm"] } } }, who),
    ).toBe(true);
  });
});

describe("business lines", () => {
  it("validates the tree and works as a cascade field", () => {
    expect(checkBusinessLines(lines)).toBeNull();
    expect(checkBusinessLines([...lines, { id: "x", name: "且初", parentId: "kim" }])).toContain("重名");
    expect(
      checkBusinessLines([
        { id: "a", name: "A", parentId: "b" },
        { id: "b", name: "B", parentId: "a" },
      ]),
    ).toContain("成环");
    expect(normalizeFieldValue(lineField, "qc")).toBe("qc");
    expect(() => normalizeFieldValue(lineField, "nope")).toThrow("没有选项");
  });
});
