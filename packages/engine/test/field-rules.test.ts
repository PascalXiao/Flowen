import { describe, expect, it } from "vitest";
import {
  applyDefaults,
  applyExclusive,
  availableOptions,
  checkFieldConfig,
  checkOptions,
  cond,
  exclusiveError,
  fieldIndex,
  fieldStates,
  formatFieldValue,
  formatNumber,
  missingRequired,
  normalizeFieldValue,
  type RuleField,
  TEMPLATE_CONDITION_KEY,
} from "../src/index.ts";

const regions = [
  { value: "east", label: "华东" },
  { value: "sh", label: "上海", parent: "east" },
  { value: "hz", label: "杭州", parent: "east" },
  { value: "north", label: "华北" },
];

describe("new field types", () => {
  it("normalizes text-like types", () => {
    expect(normalizeFieldValue({ name: "说明", dataType: "textarea" }, "\n  第一行\n第二行  \n")).toBe(
      "  第一行\n第二行",
    );
    expect(normalizeFieldValue({ name: "描述", dataType: "richText" }, "<p> </p>")).toBeNull();
    expect(normalizeFieldValue({ name: "描述", dataType: "richText" }, "<p>你好</p>")).toBe("<p>你好</p>");
    expect(normalizeFieldValue({ name: "电话", dataType: "phone" }, " +86 138-0000-0000 ")).toBe("+86 138-0000-0000");
    expect(() => normalizeFieldValue({ name: "电话", dataType: "phone" }, "abc")).toThrow("电话号码");
    expect(normalizeFieldValue({ name: "邮箱", dataType: "email" }, "A@B.cn")).toBe("a@b.cn");
    expect(() => normalizeFieldValue({ name: "邮箱", dataType: "email" }, "a@b")).toThrow("邮箱");
    expect(() => normalizeFieldValue({ name: "文档", dataType: "docLink" }, "x")).toThrow("http");
  });

  it("normalizes dates with time and ranges", () => {
    expect(normalizeFieldValue({ name: "评审", dataType: "datetime" }, "2026-10-22T09:05")).toBe("2026-10-22 09:05");
    expect(() => normalizeFieldValue({ name: "评审", dataType: "datetime" }, "2026-10-22 25:00")).toThrow("时间");
    const range = { name: "排期", dataType: "dateRange" as const };
    expect(normalizeFieldValue(range, ["2026-10-01", "2026-10-07"])).toEqual({
      start: "2026-10-01",
      end: "2026-10-07",
    });
    expect(normalizeFieldValue(range, { start: "", end: "" })).toBeNull();
    expect(() => normalizeFieldValue(range, { start: "2026-10-08", end: "2026-10-07" })).toThrow("不能晚于");
    expect(fieldIndex(range, { start: "1970-01-11", end: "1970-01-12" }).num).toBe(10);
  });

  it("handles single user, radio and signals", () => {
    expect(normalizeFieldValue({ name: "审批人", dataType: "singleUser" }, ["u1"])).toBe("u1");
    expect(() => normalizeFieldValue({ name: "审批人", dataType: "singleUser" }, ["u1", "u2"])).toThrow("一个人");
    const radio = { name: "优先级", dataType: "radio" as const, options: [{ value: "p0", label: "P0" }] };
    expect(normalizeFieldValue(radio, "p0")).toBe("p0");
    const signal = { name: "质检", dataType: "signal" as const };
    expect(normalizeFieldValue(signal, { state: "passed", text: " 合格 " })).toEqual({ state: "passed", text: "合格" });
    expect(() => normalizeFieldValue(signal, { state: "ok" })).toThrow("信号状态");
    expect(formatFieldValue(signal, { state: "failed", text: "缺报告" })).toBe("不通过：缺报告");
  });

  it("treats cascade values as paths", () => {
    const field = { name: "区域", dataType: "cascadeSelect" as const, options: regions };
    expect(normalizeFieldValue(field, "sh")).toBe("sh");
    expect(formatFieldValue(field, "sh")).toBe("华东 / 上海");
    expect(fieldIndex(field, "sh").items).toEqual(["east", "sh"]);
    expect(() => normalizeFieldValue({ ...field, config: { leafOnly: true } }, "east")).toThrow("最后一级");
    const multi = { name: "区域", dataType: "cascadeMulti" as const, options: regions };
    expect(normalizeFieldValue(multi, ["hz", "sh"])).toEqual(["sh", "hz"]);
  });

  it("formats numbers", () => {
    expect(formatNumber(1234567.891, { precision: 2, thousands: true })).toBe("1,234,567.89");
    expect(formatNumber(0.256, { scale: "percent", precision: 1 })).toBe("25.6%");
    expect(formatNumber(35000, { scale: "tenThousand", symbol: "¥" })).toBe("¥3.5万");
    expect(formatNumber(12, { symbol: "件", symbolPosition: "after" })).toBe("12件");
  });
});

describe("field rules", () => {
  const fields: RuleField[] = [
    { key: "line", name: "业务线", dataType: "cascadeSelect", options: regions },
    { key: "needFiling", name: "是否需要备案", dataType: "bool" },
    {
      key: "filingNo",
      name: "备案号",
      dataType: "text",
      config: { validWhen: cond.equal("needFiling", true), requiredWhen: cond.equal("line", "east") },
    },
    { key: "note", name: "备注", dataType: "text", required: true, config: { showWhen: cond.notEmpty("line") } },
  ];

  it("works out valid, visible and required from other fields", () => {
    expect(fieldStates(fields, {}).filingNo).toEqual({ valid: false, visible: false, required: false });
    expect(fieldStates(fields, {}).note).toEqual({ valid: true, visible: false, required: false });
    const states = fieldStates(fields, { needFiling: true, line: "sh" });
    expect(states.filingNo).toEqual({ valid: true, visible: true, required: true });
    expect(states.note?.required).toBe(true);
    expect(missingRequired(fields, { needFiling: true, line: "sh" }).map((f) => f.key)).toEqual(["filingNo", "note"]);
    expect(missingRequired(fields, { needFiling: false, line: "north", note: "x" })).toEqual([]);
  });

  it("fills defaults on create, first match or union", () => {
    const withDefaults: RuleField[] = [
      { key: "line", name: "业务线", dataType: "select", options: [{ value: "a" }, { value: "b" }] },
      {
        key: "owner",
        name: "对接人",
        dataType: "user",
        config: {
          defaultValue: {
            mode: "conditional",
            combine: "union",
            rules: [
              { when: cond.equal("line", "a"), value: ["u1"] },
              { when: cond.notEmpty("line"), value: ["u2"] },
            ],
          },
        },
      },
      { key: "level", name: "级别", dataType: "select", config: { defaultValue: { mode: "fixed", value: "L1" } } },
    ];
    expect(applyDefaults(withDefaults, { line: "a" })).toEqual({ line: "a", owner: ["u1", "u2"], level: "L1" });
    expect(applyDefaults(withDefaults, { line: "b", level: "L2" })).toEqual({ line: "b", owner: ["u2"], level: "L2" });
  });

  it("defaults can depend on the flow type chosen at creation", () => {
    const fields: RuleField[] = [
      {
        key: "needTrial",
        name: "是否需要试用",
        dataType: "bool",
        config: {
          defaultValue: {
            mode: "conditional",
            rules: [{ when: cond.equal(TEMPLATE_CONDITION_KEY, "GWP礼赠品"), value: true }],
          },
        },
      },
    ];
    expect(applyDefaults(fields, { [TEMPLATE_CONDITION_KEY]: "GWP礼赠品" }).needTrial).toBe(true);
    expect(applyDefaults(fields, { [TEMPLATE_CONDITION_KEY]: "OEM" }).needTrial).toBeUndefined();
  });

  it("fills defaults that depend on other defaults, whatever the field order", () => {
    const fields: RuleField[] = [
      {
        key: "division",
        name: "事业部",
        dataType: "select",
        config: { defaultValue: { mode: "conditional", rules: [{ when: cond.equal("brand", "B1"), value: "D1" }] } },
      },
      {
        key: "brand",
        name: "品牌",
        dataType: "select",
        config: { defaultValue: { mode: "conditional", rules: [{ when: cond.equal("line", "L1"), value: "B1" }] } },
      },
      { key: "line", name: "业务线", dataType: "select" },
    ];
    expect(applyDefaults(fields, { line: "L1" })).toEqual({ line: "L1", brand: "B1", division: "D1" });
  });

  it("filters options and keeps chosen ones", () => {
    const field: RuleField = {
      key: "pack",
      name: "包材",
      dataType: "multiSelect",
      options: [{ value: "box" }, { value: "bag", disabled: true }, { value: "none" }],
      config: { optionWhen: { box: cond.equal("gift", true) }, exclusiveOptions: ["none"] },
    };
    expect(availableOptions(field, {}).map((o) => o.value)).toEqual(["none"]);
    expect(availableOptions(field, { gift: true }, ["bag"]).map((o) => o.value)).toEqual(["box", "bag", "none"]);
    expect(applyExclusive(field, ["box"], ["box", "none"])).toEqual(["none"]);
    expect(applyExclusive(field, ["none"], ["none", "box"])).toEqual(["box"]);
    expect(exclusiveError(field, ["box", "none"])).toContain("就不能再选别的");
  });

  it("checks configs and options", () => {
    const field = { key: "x", name: "X", dataType: "text" as const };
    expect(checkFieldConfig(field, { showWhen: cond.notEmpty("x") }, ["x"])).toContain("引用它自己");
    expect(checkFieldConfig(field, { showWhen: cond.notEmpty("y") }, ["x"])).toContain("不存在");
    expect(checkFieldConfig(field, { alias: "1abc" }, ["x"])).toContain("对接标识");
    expect(checkFieldConfig(field, { unique: true, alias: "filing_no" }, ["x"])).toBeNull();
    expect(checkOptions("cascadeSelect", [...regions, { value: "x", parent: "y" }])).toContain("上级不存在");
    expect(checkOptions("select", [{ value: "a", parent: "b" }])).toContain("只有级联");
    expect(
      checkOptions("cascadeSelect", [
        { value: "a", parent: "b" },
        { value: "b", parent: "a" },
      ]),
    ).toContain("成环");
  });
});
