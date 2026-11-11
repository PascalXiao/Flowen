import { describe, expect, it } from "vitest";
import { cond, guessTargets, type ImportContext, importHeaders, planImport } from "../src/index.ts";

const ctx: ImportContext = {
  typeName: "项目",
  fields: [
    {
      key: "brand",
      name: "品牌",
      dataType: "select",
      options: [
        { value: "kim", label: "星河" },
        { value: "oc", label: "远山" },
      ],
    },
    { key: "launch", name: "上市日期", dataType: "date", required: true },
    { key: "budget", name: "预算", dataType: "number" },
    { key: "pm", name: "对接人", dataType: "user" },
    {
      key: "level",
      name: "级别",
      dataType: "select",
      options: [{ value: "L1" }, { value: "L2" }],
      config: { defaultValue: { mode: "fixed", value: "L1" } },
    },
    { key: "risk", name: "风险说明", dataType: "text", config: { showWhen: cond.equal("brand", "oc") } },
    { key: "score", name: "评分", dataType: "formula" },
  ],
  roles: [
    { key: "owner", name: "负责人" },
    { key: "dev", name: "开发", config: { assign: { mode: "manual" } } },
    { key: "audit", name: "审核", config: { appear: { mode: "hidden" } } },
  ],
  flows: [
    { id: "t1", name: "标准" },
    { id: "t2", name: "快速" },
  ],
  members: [
    { userId: "u1", name: "Pascal" },
    { userId: "u2", name: "Lin" },
  ],
  me: "u1",
};

describe("import from a sheet", () => {
  it("template headers: name, flow type, importable fields, roles", () => {
    expect(importHeaders(ctx)).toEqual([
      "名称",
      "流程类型",
      "品牌",
      "上市日期",
      "预算",
      "对接人",
      "级别",
      "风险说明",
      "负责人",
      "开发",
      "审核",
    ]);
  });

  it("guesses columns by header, each target once, formulas never", () => {
    const targets = guessTargets(["项目名称", "品牌", "评分", "开发", "品牌", "备注"], ctx);
    expect(targets).toEqual([
      { kind: "name" },
      { kind: "field", key: "brand" },
      null,
      { kind: "role", key: "dev" },
      null,
      null,
    ]);
  });

  it("parses rows like pasted cells, fills defaults and default roles", () => {
    const headers = ["名称", "流程类型", "品牌", "上市日期", "预算", "对接人", "开发"];
    const rows = planImport(
      [
        ["面霜立项", "快速", "星河", "2027-03-01", "1,200", "Lin", "Lin、Pascal"],
        ["", "", "", "", "", "", ""],
        ["精华立项", "", "远山", "2027-04-01", "", "", ""],
      ],
      guessTargets(headers, ctx),
      ctx,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      line: 2,
      name: "面霜立项",
      flowTemplateId: "t2",
      fields: { brand: "kim", launch: "2027-03-01", budget: 1200, pm: ["u2"], level: "L1" },
      roles: { owner: ["u1"], dev: ["u2", "u1"] },
      addedRoles: [],
      errors: [],
    });
    // 空白行跳过，行号仍按 Excel 算
    expect(rows[1]?.line).toBe(4);
    expect(rows[1]?.flowTemplateId).toBeUndefined();
    expect(rows[1]?.roles).toEqual({ owner: ["u1"], dev: [] });
  });

  it("reports missing name, required fields, unknown options and people", () => {
    const headers = ["名称", "品牌", "流程类型", "审核", "上市日期"];
    const [row] = planImport([["", "Other", "Agile", "Nobody", ""]], guessTargets(headers, ctx), ctx);
    expect(row?.errors).toEqual([
      "名称没填。",
      "「品牌」没有选项「Other」。",
      "没有流程类型「Agile」。",
      "「审核」里的「Nobody」不是空间成员。",
      "必填没填：上市日期。",
    ]);
  });

  it("a hidden role filled in the sheet is added; hidden fields are dropped", () => {
    const headers = ["名称", "上市日期", "审核", "风险说明"];
    const [row] = planImport([["A", "2027-01-01", "Lin", "注意"]], guessTargets(headers, ctx), ctx);
    expect(row?.roles.audit).toEqual(["u2"]);
    expect(row?.addedRoles).toEqual(["audit"]);
    expect(row?.fields.risk).toBeUndefined();
  });
});
