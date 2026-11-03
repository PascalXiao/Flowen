import { describe, expect, it } from "vitest";
import {
  compileFormula,
  FormulaError,
  type FormulaNodeItem,
  fieldIndex,
  formatFieldValue,
  orderFormulas,
} from "../src/index.ts";

const FIELDS: Record<string, string> = { 工时: "hours", 单价: "price", 开始: "start", 结束: "end", 标签: "tags" };
const resolve = (ref: string) => FIELDS[ref] ?? (Object.values(FIELDS).includes(ref) ? ref : undefined);
const values: Record<string, unknown> = {
  hours: 8,
  price: 12.5,
  start: "2026-11-02",
  end: "2026-11-09",
  tags: ["a", "b"],
};
const run = (source: string, extra: Record<string, unknown> = {}) =>
  compileFormula(source, resolve).evaluate({ field: (k) => ({ ...values, ...extra })[k] ?? null });

describe("formula", () => {
  it("does arithmetic with precedence and treats blanks as 0", () => {
    expect(run("{工时} * {单价} + 1")).toBe(101);
    expect(run("({工时} + 2) * 2")).toBe(20);
    expect(run("-{工时} / 4")).toBe(-2);
    expect(run("{工时} + {单价}", { price: null })).toBe(8);
    expect(run("{工时} / 0")).toBeNull();
  });

  it("supports conditions, text and dates", () => {
    expect(run('IF({工时} > 5, "长", "短")')).toBe("长");
    expect(run('IF(AND({工时} >= 8, NOT(ISBLANK({单价}))), "ok")')).toBe("ok");
    expect(run('"共 " & {工时} & " 小时"')).toBe("共 8 小时");
    expect(run("DAYS({结束}, {开始})")).toBe(7);
    expect(run("DATEADD({开始}, 30)")).toBe("2026-12-02");
    expect(run("{结束} > {开始}")).toBe(true);
    expect(run("LEN({标签})")).toBe(2);
    expect(run("ROUND(10 / 3, 2)")).toBe(3.33);
    expect(run("MAX({工时}, {单价}, 3)")).toBe(12.5);
  });

  it("rewrites field names to keys and reports what it references", () => {
    const f = compileFormula("{工时}*({单价} + 1)", resolve);
    expect(f.source).toBe("{hours} * ({price} + 1)");
    expect(f.refs).toEqual(["hours", "price"]);
    expect(f.usesSubItems).toBe(false);
    expect(compileFormula(f.source, resolve).source).toBe(f.source);
  });

  it("aggregates sub-items", () => {
    const f = compileFormula("SUBITEMS_SUM({工时}) / SUBITEMS_COUNT()", resolve);
    expect(f.usesSubItems).toBe(true);
    // 子工作项函数里的字段按子工作项的字段对，不要求本类型上有
    expect(compileFormula("SUBITEMS_MAX({估分})", resolve).source).toBe("SUBITEMS_MAX({估分})");
    const scope = {
      field: () => null,
      subItemValues: (ref: string) => (ref === "工时" ? [3, null, 5] : []),
      subItemCount: 4,
      subItemsDone: 1,
    };
    expect(f.evaluate(scope)).toBe(2);
    expect(compileFormula("SUBITEMS_DONE() / SUBITEMS_COUNT()", resolve).evaluate(scope)).toBe(0.25);
  });

  it("explains mistakes", () => {
    expect(() => compileFormula("{不存在} + 1", resolve)).toThrow("字段「不存在」不存在");
    expect(() => compileFormula("FOO(1)", resolve)).toThrow("没有函数 FOO");
    expect(() => compileFormula("IF(1)", resolve)).toThrow("参数个数不对");
    expect(() => compileFormula("(1 + 2", resolve)).toThrow(FormulaError);
    expect(() => compileFormula("SUBITEMS_SUM(1)", resolve)).toThrow("要写成一个字段");
  });

  it("orders formulas by dependency and rejects cycles", () => {
    const a = { key: "a", name: "A", refs: ["b"] };
    const b = { key: "b", name: "B", refs: ["hours"] };
    expect(orderFormulas([a, b]).map((f) => f.key)).toEqual(["b", "a"]);
    expect(() => orderFormulas([a, { ...b, refs: ["a"] }])).toThrow("循环引用");
  });

  it("indexes and formats results by their value type", () => {
    const spec = { name: "x", dataType: "formula" as const };
    expect(fieldIndex(spec, 3.5).num).toBe(3.5);
    expect(fieldIndex(spec, "2026-01-02").str).toBe("2026-01-02");
    expect(fieldIndex(spec, true).items).toEqual(["true"]);
    expect(formatFieldValue(spec, 0.1 + 0.2)).toBe("0.3");
  });
});

describe("formula across work items", () => {
  const item = (
    name: string,
    status: string,
    fields: Record<string, unknown>,
    extra: { template?: string; nodes?: FormulaNodeItem[] } = {},
  ) => ({
    name,
    status,
    stage: null,
    field: (ref: string) => fields[ref] ?? null,
    ...extra,
  });
  const reviews = [
    item(
      "评审 1",
      "inProgress",
      {},
      {
        template: "CDCP",
        nodes: [
          {
            name: "产品手册",
            state: "completed",
            conclusion: null,
            plannedStart: "2026-11-02",
            plannedEnd: "2026-11-06",
            actualEnd: "2026-11-05",
          },
        ],
      },
    ),
    item(
      "评审 2",
      "inProgress",
      {},
      { template: "PDCP", nodes: [{ name: "产品手册", state: "inProgress", conclusion: null }] },
    ),
  ];
  const risks = [
    item("包材风险", "inProgress", { 等级: "高", 影响天数: 3 }),
    item("配方风险", "completed", { 等级: "低", 影响天数: 1 }),
  ];
  // 字段组「成本率维护」：每行是 品牌、类型、成本率
  const costs = [
    item("成本率配置", "completed", {
      成本率维护: [
        { 品牌: "B2214", 类型: "BRAND_DEFAULT", 成本率: 0.3 },
        { 品牌: "B2214", 类型: "SUBCLASS_SPECIFIC", 分类: "卸妆油", 成本率: 0.2 },
        { 品牌: "B2214", 类型: "SUBCLASS_SPECIFIC", 成本率: 0.25 },
        { 品牌: "B02330", 类型: "BRAND_DEFAULT", 成本率: 0.4 },
      ],
    }),
  ];
  const scope = {
    field: (k: string) => values[k] ?? null,
    related: (name: string) =>
      name === "关联风险" ? risks : name === "关联评审" ? reviews : name === "关联成本率" ? costs : [],
    children: () => [item("SKU-1", "completed", { 工时: 3 }), item("SKU-2", "inProgress", { 工时: 4 })],
    node: (ref: string) => (ref === "需求评审" ? { state: "completed", conclusion: "pass" } : null),
    today: "2026-10-23",
    template: "OEM",
    typeName: "项目",
    // 级联选项：卸妆油在 面部洗护 / 卸妆 下面
    optionPath: (v: string) => (v === "卸妆油" ? ["面部洗护", "卸妆", "卸妆油"] : [v]),
  };
  const calc = (source: string) => compileFormula(source, resolve).evaluate(scope);

  it("checks whether related items exist and filters them", () => {
    expect(calc('COUNT(RELATED("关联风险")) > 0')).toBe(true);
    expect(calc('COUNT(RELATED("关联CDCP")) > 0')).toBe(false);
    expect(calc('COUNTIF(RELATED("关联风险"), each.状态 = "inProgress")')).toBe(1);
    expect(calc('JOIN(FILTER(RELATED("关联风险"), each.{等级} = "高").名称)')).toBe("包材风险");
    expect(calc('SUMIF(RELATED("关联风险"), TRUE, each.{影响天数})')).toBe(4);
    expect(calc('ANYOF(RELATED("关联风险"), each.{等级} = "低")')).toBe(true);
    expect(calc('ALLOF(RELATED("关联风险"), each.状态 = "completed")')).toBe(false);
  });

  it("reads the rows of a field group on related items", () => {
    const rows = (cond: string) => `FILTER(RELATED("关联成本率").{成本率维护}, ${cond})`;
    expect(calc(`COUNT(${rows('each.{品牌} = "B2214"')})`)).toBe(3);
    expect(calc(`FIRST(${rows('AND(each.{品牌} = "B2214", each.{类型} = "BRAND_DEFAULT")')}).{成本率}`)).toBe(0.3);
    expect(calc(`SUM(MAP(${rows('each.{品牌} = "B02330"')}, each.{成本率}))`)).toBe(0.4);
  });

  it("finds the first match, converts values and reads cascade levels and node schedules", () => {
    expect(calc(`FIND(RELATED("关联成本率").{成本率维护}, LEVEL(each.{分类}, 3) = "卸妆油").{成本率}`)).toBe(0.2);
    expect(calc(`LEVEL("卸妆油", 2)`)).toBe("卸妆");
    expect(calc(`LEVEL("卸妆油", 4)`)).toBeNull();
    expect(calc(`FIND(RELATED("关联风险"), each.{等级} = "中")`)).toBeNull();
    expect(calc(`STRING(12) = "12"`)).toBe(true);
    expect(calc(`EMPTY(RELATED("关联CDCP"))`)).toBe(true);
    expect(calc(`DATE("1970-01-01")`)).toBe("1970-01-01");
    expect(calc(`FIND(RELATED("关联评审").节点, each.名称 = "产品手册").计划结束`)).toBe("2026-11-06");
  });

  it("lists values and reads its own flow type and type", () => {
    expect(calc(`JOIN(LIST(TYPE(), TEMPLATE(), ""), " ")`)).toBe("项目 OEM");
    expect(calc(`JOIN(LIST(JOIN(RELATED("关联风险").名称, "、"), "风险提报"), " ")`)).toBe(
      "包材风险、配方风险 风险提报",
    );
    expect(calc(`FIND(RELATED("关联评审").节点, each.名称 = "产品手册").实际结束`)).toBe("2026-11-05");
  });

  it("reads the flow type and the nodes of related items", () => {
    expect(calc('COUNTIF(RELATED("关联评审"), each.流程类型 = "CDCP") > 0')).toBe(true);
    expect(calc('COUNTIF(RELATED("关联评审"), each.流程类型 = "ADCP") > 0')).toBe(false);
    expect(calc('COUNTIF(FILTER(RELATED("关联评审").节点, each.名称 = "产品手册"), each.状态 = "completed")')).toBe(1);
    expect(calc('COUNT(RELATED("关联风险").节点)')).toBe(0);
  });

  it("sums sub-items, reads nodes and today", () => {
    expect(calc("SUM(MAP(CHILDREN(), each.{工时}))")).toBe(7);
    expect(calc("SUM(CHILDREN().{工时})")).toBe(7);
    expect(calc('NODE("需求评审").结论 = "pass"')).toBe(true);
    expect(calc('CONTAINS({标签}, "b")')).toBe(true);
    expect(calc("DAYS(TODAY(), {开始})")).toBe(-10);
  });

  it("marks formulas that read other items and round-trips the source", () => {
    const f = compileFormula('COUNTIF(RELATED("关联风险"), each.{等级} = "高") > 0', resolve);
    expect(f.usesRelated).toBe(true);
    expect(f.source).toBe('COUNTIF(RELATED("关联风险"), each.{等级} = "高") > 0');
    expect(compileFormula(f.source, resolve).source).toBe(f.source);
    expect(compileFormula("{工时} + 1", resolve).usesRelated).toBe(false);
  });
});
