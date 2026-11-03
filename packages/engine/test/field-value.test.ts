import { describe, expect, it } from "vitest";
import { cond, evaluate, fieldIndex, formatFieldValue, normalizeFieldValue } from "../src/index.ts";

const options = [
  { value: "red", label: "红" },
  { value: "blue", label: "蓝" },
  { value: "green", label: "绿" },
];

describe("normalizeFieldValue", () => {
  it("turns empty input into null", () => {
    for (const empty of [null, undefined, "", "  ", []])
      expect(normalizeFieldValue({ name: "备注", dataType: "text" }, empty)).toBeNull();
  });

  it("parses numbers and rejects junk", () => {
    expect(normalizeFieldValue({ name: "数量", dataType: "number" }, "12.5")).toBe(12.5);
    expect(normalizeFieldValue({ name: "数量", dataType: "number" }, 3)).toBe(3);
    expect(() => normalizeFieldValue({ name: "数量", dataType: "number" }, "abc")).toThrow("「数量」要填数字。");
  });

  it("accepts real calendar dates only", () => {
    expect(normalizeFieldValue({ name: "上市日期", dataType: "date" }, "2026-02-28")).toBe("2026-02-28");
    expect(() => normalizeFieldValue({ name: "上市日期", dataType: "date" }, "2026-02-30")).toThrow("要填日期");
    expect(() => normalizeFieldValue({ name: "上市日期", dataType: "date" }, "明天")).toThrow("要填日期");
  });

  it("keeps multi-select values in option order without duplicates", () => {
    const field = { name: "颜色", dataType: "multiSelect" as const, options };
    expect(normalizeFieldValue(field, ["green", "red", "green"])).toEqual(["red", "green"]);
    expect(() => normalizeFieldValue(field, ["purple"])).toThrow("没有选项「purple」");
    expect(() => normalizeFieldValue({ name: "颜色", dataType: "select", options }, "purple")).toThrow("没有选项");
  });

  it("checks links, booleans and users", () => {
    expect(normalizeFieldValue({ name: "文档", dataType: "link" }, " https://x.cn/a ")).toBe("https://x.cn/a");
    expect(() => normalizeFieldValue({ name: "文档", dataType: "link" }, "x.cn")).toThrow("http");
    expect(normalizeFieldValue({ name: "加急", dataType: "bool" }, "true")).toBe(true);
    expect(normalizeFieldValue({ name: "负责人", dataType: "user" }, ["u1", "u1", "u2"])).toEqual(["u1", "u2"]);
    expect(normalizeFieldValue({ name: "负责人", dataType: "user" }, "u1")).toEqual(["u1"]);
    expect(() => normalizeFieldValue({ name: "毛利", dataType: "formula" }, 1)).toThrow("不能手动修改");
  });
});

describe("field index and display", () => {
  it("indexes values for filtering", () => {
    expect(fieldIndex({ name: "n", dataType: "number" }, 5)).toEqual({ num: 5, str: null, items: [] });
    expect(fieldIndex({ name: "d", dataType: "date" }, "1970-01-11")).toEqual({
      num: 10,
      str: "1970-01-11",
      items: [],
    });
    expect(fieldIndex({ name: "m", dataType: "multiSelect", options }, ["red", "blue"]).items).toEqual(["red", "blue"]);
    expect(fieldIndex({ name: "b", dataType: "bool" }, false).items).toEqual(["false"]);
  });

  it("formats values for people", () => {
    expect(formatFieldValue({ name: "m", dataType: "multiSelect", options }, ["red", "blue"])).toBe("红、蓝");
    expect(formatFieldValue({ name: "u", dataType: "user" }, ["u1"], () => "Pascal")).toBe("Pascal");
    expect(formatFieldValue({ name: "b", dataType: "bool" }, true)).toBe("是");
  });
});

describe("conditions on typed values", () => {
  it("treats equal on a multi-value field as contains", () => {
    expect(evaluate(cond.equal("颜色", "red"), { 颜色: ["red", "blue"] })).toBe(true);
    expect(evaluate(cond.equal("颜色", "green"), { 颜色: ["red", "blue"] })).toBe(false);
  });

  it("treats notEqual as the opposite of equal, empty included", () => {
    expect(evaluate(cond.notEqual("审核", "不通过"), { 审核: "通过" })).toBe(true);
    expect(evaluate(cond.notEqual("审核", "不通过"), { 审核: "不通过" })).toBe(false);
    expect(evaluate(cond.notEqual("审核", "不通过"), {})).toBe(true);
    expect(evaluate(cond.notEqual("颜色", "red"), { 颜色: ["red", "blue"] })).toBe(false);
  });

  it("compares numbers and dates", () => {
    expect(evaluate(cond.compare("数量", "gte", 10), { 数量: 10 })).toBe(true);
    expect(evaluate(cond.compare("数量", "gt", 10), { 数量: 10 })).toBe(false);
    expect(evaluate(cond.compare("数量", "lt", 10), { 数量: null })).toBe(false);
    expect(evaluate(cond.compare("上市", "lt", "2026-03-01"), { 上市: "2026-02-28" })).toBe(true);
    expect(evaluate(cond.compare("上市", "gt", "2026-03-01"), { 上市: "2026-02-28" })).toBe(false);
  });
});

describe("field groups", () => {
  const group = {
    name: "成本率维护",
    dataType: "fieldGroup" as const,
    config: {
      columns: [
        { key: "品牌", name: "品牌", dataType: "select" as const, options },
        { key: "成本率", name: "成本率", dataType: "number" as const },
      ],
    },
  };

  it("normalizes each row by its columns and drops empty rows", () => {
    expect(
      normalizeFieldValue(group, [
        { 品牌: "red", 成本率: "0.3", 多余: 1 },
        { 品牌: "", 成本率: null },
        { 成本率: 0.4 },
      ]),
    ).toEqual([{ 品牌: "red", 成本率: 0.3 }, { 成本率: 0.4 }]);
    expect(normalizeFieldValue(group, [{ 品牌: "" }])).toBeNull();
    expect(() => normalizeFieldValue(group, [{ 品牌: "red" }, { 品牌: "pink" }])).toThrow("第 2 行");
  });

  it("shows the row count and indexes every cell", () => {
    const rows = [{ 品牌: "red", 成本率: 0.3 }, { 品牌: "blue" }];
    expect(formatFieldValue(group, rows)).toBe("2 行");
    expect(fieldIndex(group, rows).str).toBe("红 0.3 蓝");
  });
});
