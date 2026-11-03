import { describe, expect, it } from "vitest";
import { type FieldSpec, formatFieldValue, parseFieldText } from "../src/index.ts";

const users: Record<string, string> = { 张三: "u1", 李四: "u2" };
const findUser = (name: string) => users[name];
const parse = (field: FieldSpec, text: string) => parseFieldText(field, text, findUser);

describe("parseFieldText", () => {
  it("reads numbers back through their number format", () => {
    const percent: FieldSpec = { name: "完成率", dataType: "number", config: { number: { scale: "percent" } } };
    expect(parse(percent, "50%")).toEqual({ value: 0.5 });
    expect(parse(percent, "0.5")).toEqual({ value: 0.5 });
    const money: FieldSpec = {
      name: "预算",
      dataType: "number",
      config: { number: { thousands: true, symbol: "¥", scale: "tenThousand" } },
    };
    expect(parse(money, formatFieldValue(money, 1_234_000))).toEqual({ value: 1_234_000 });
    expect(parse(money, "abc")).toEqual({ error: "「预算」要填数字。" });
  });

  it("finds options by label, cascade options by path, and people by name", () => {
    const priority: FieldSpec = {
      name: "优先级",
      dataType: "select",
      options: [
        { value: "p0", label: "P0" },
        { value: "p1", label: "P1" },
      ],
    };
    expect(parse(priority, "P1")).toEqual({ value: "p1" });
    expect(parse(priority, "P9")).toEqual({ error: "「优先级」没有选项「P9」。" });
    const tags: FieldSpec = { ...priority, name: "标签", dataType: "multiSelect" };
    expect(parse(tags, "P0、P1")).toEqual({ value: ["p0", "p1"] });
    const area: FieldSpec = {
      name: "区域",
      dataType: "cascadeSelect",
      options: [
        { value: "cn", label: "中国" },
        { value: "sh", label: "上海", parent: "cn" },
      ],
    };
    expect(parse(area, formatFieldValue(area, "sh"))).toEqual({ value: "sh" });
    expect(parse(area, "上海")).toEqual({ value: "sh" });
    expect(parse({ name: "参与人", dataType: "user" }, "张三, 李四")).toEqual({ value: ["u1", "u2"] });
    expect(parse({ name: "负责人", dataType: "singleUser" }, "王五")).toEqual({
      error: "「负责人」没有成员「王五」。",
    });
  });

  it("handles empty text, booleans, dates and fields that cannot be pasted", () => {
    expect(parse({ name: "备注", dataType: "text" }, "  ")).toEqual({ value: null });
    expect(parse({ name: "加急", dataType: "bool" }, "是")).toEqual({ value: true });
    expect(parse({ name: "上线", dataType: "date" }, "2026/11/03")).toEqual({ value: "2026-11-03" });
    expect(parse({ name: "周期", dataType: "dateRange" }, "2026-11-01 ~ 2026-11-30")).toEqual({
      value: { start: "2026-11-01", end: "2026-11-30" },
    });
    expect(parse({ name: "附件", dataType: "attachment" }, "1 个附件")).toEqual({ error: "「附件」不能粘贴。" });
  });
});
