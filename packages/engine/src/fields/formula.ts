/**
 * 公式字段：一个小的表达式语言，用工作项自己的字段和子工作项的汇总算出一个值。
 *
 *   {工时} * {单价}
 *   IF({预算} > 10000, "大", "小")
 *   DAYS({截止日期}, {开始日期})
 *   SUBITEMS_SUM({工时}) / SUBITEMS_COUNT()
 *
 * 字段写成 {字段名}（也可以写字段键），保存时统一换成字段键。空值在加减乘除里按 0 算，
 * 在 & 拼接里按空字符串算；除以 0 得到空值。结果是数字、文本、日期（YYYY-MM-DD）或是否。
 *
 * 也能沿关联取别的工作项（对照飞书项目的计算字段）：
 *
 *   COUNT(RELATED("关联风险")) > 0                          是否存在关联风险
 *   COUNTIF(RELATED("关联风险"), each.状态 = "进行中")       进行中的关联风险个数
 *   SUM(MAP(CHILDREN(), each.{工时}))                        子工作项工时之和
 *   FILTER(RELATED("关联SKU"), each.{是否上市}).名称         符合条件的关联 SKU 名称
 *   NODE("需求评审").状态 = "completed"                      节点状态、结论（.结论）
 *
 * 字段组的值是行的列表，each.{列名} 取这一行的列。
 *
 * RELATED、CHILDREN 得到工作项列表；列表.{字段} 取每一项的字段；each 是 FILTER、MAP、COUNTIF、SUMIF、
 * ANYOF、ALLOF 里当前的那一项。工作项上除了字段，还有 名称、状态、阶段、流程类型 四个属性，
 * 以及 节点（这个工作项的流程节点列表，每个节点有 名称、状态、结论）：
 *
 *   COUNTIF(RELATED("关联评审管理"), each.流程类型 = "CDCP") > 0         关联的评审里有没有 CDCP 流程的
 *   COUNTIF(FILTER(RELATED("关联产品资料").节点, each.名称 = "产品手册"), each.状态 = "completed") > 0
 *
 * 节点还有 计划开始、计划结束、实际结束（YYYY-MM-DD）。TEMPLATE()、TYPE() 是本工作项的流程类型和类型名，
 * LIST(a, b, …) 把几个值放成一个列表（对照飞书的 [a, b]）：JOIN(LIST(RELATED("关联项目").名称, TEMPLATE()), " ")。
 *FIND(列表, 条件) 取第一个满足的项；
 * LEVEL(级联值, n) 取级联选项路径上的第 n 级（对照飞书的「级联字段第三级」）：
 *
 *   FIND(FILTER(RELATED("关联需求SKU流程").节点, TRUE), each.名称 = "成品到仓").计划结束
 *   FIND(RELATED("关联成本率").{成本率维护}, LEVEL(each.{分类}, 3) = LEVEL({分类}, 3)).{成本率}
 */

export type FormulaValue = number | string | boolean | null;

/** 公式里能拿到的另一个工作项（关联的、子工作项）。 */
export interface FormulaItem {
  name: string;
  status: string | null;
  stage: string | null;
  /** 流程类型（流程模板的名称）。 */
  template?: string | null;
  /** 这个工作项的流程节点；不提供时 .节点 得到空列表。 */
  nodes?: readonly FormulaNodeItem[];
  /** 按字段名或字段键取值。 */
  field(ref: string): unknown;
}

/** 列表里的一个节点（取 .节点 得到的）：节点名、状态（notStarted/inProgress/completed/skipped）、结论。 */
export interface FormulaNodeItem {
  name: string;
  state: string;
  conclusion: string | null;
  /** 计划开始、计划结束、实际结束（YYYY-MM-DD）。 */
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualEnd?: string | null;
}

/** 公式里能拿到的节点。 */
export interface FormulaNode {
  state: string;
  conclusion: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualEnd?: string | null;
}

export class FormulaError extends Error {
  override name = "FormulaError";
}

type Node =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "ref"; key: string }
  | { kind: "unary"; op: "-"; arg: Node }
  | { kind: "binary"; op: string; left: Node; right: Node }
  | { kind: "call"; name: string; args: Node[] }
  /** 取属性：工作项的字段或 名称/状态/阶段，列表上取每一项的。 */
  | { kind: "member"; target: Node; prop: string; field: boolean }
  /** FILTER、MAP 等里面当前的那一项。 */
  | { kind: "each" };

/** 用到别的工作项的函数：只能在服务端算。 */
const CROSS_ITEM = ["RELATED", "CHILDREN", "NODE"] as const;

/** 子工作项汇总：参数是子工作项上的字段（按字段键或名称对上）。 */
const AGGREGATES = ["SUBITEMS_SUM", "SUBITEMS_AVG", "SUBITEMS_MIN", "SUBITEMS_MAX"] as const;
/** 不带参数的子工作项计数。 */
const COUNTS = ["SUBITEMS_COUNT", "SUBITEMS_DONE"] as const;

/** 支持的函数和参数个数（[最少, 最多]），编辑器里也用它列出可用函数。 */
export const FORMULA_FUNCTIONS: Record<string, { args: [number, number]; doc: string }> = {
  IF: { args: [2, 3], doc: "IF(条件, 成立时, 不成立时)" },
  AND: { args: [1, 99], doc: "AND(条件1, 条件2, …) 都成立" },
  OR: { args: [1, 99], doc: "OR(条件1, 条件2, …) 有一个成立" },
  NOT: { args: [1, 1], doc: "NOT(条件)" },
  ISBLANK: { args: [1, 1], doc: "ISBLANK(值) 是否为空" },
  SUM: { args: [1, 99], doc: "SUM(数1, 数2, …)" },
  AVG: { args: [1, 99], doc: "AVG(数1, 数2, …)" },
  MIN: { args: [1, 99], doc: "MIN(数1, 数2, …)" },
  MAX: { args: [1, 99], doc: "MAX(数1, 数2, …)" },
  ROUND: { args: [1, 2], doc: "ROUND(数, 小数位)" },
  ABS: { args: [1, 1], doc: "ABS(数)" },
  CONCAT: { args: [1, 99], doc: "CONCAT(文本1, 文本2, …)" },
  LEN: { args: [1, 1], doc: "LEN(文本) 长度；多选、人员字段为个数" },
  DAYS: { args: [2, 2], doc: "DAYS(结束日期, 开始日期) 相差天数" },
  DATEADD: { args: [2, 2], doc: "DATEADD(日期, 天数)" },
  SUBITEMS_SUM: { args: [1, 1], doc: "SUBITEMS_SUM({字段}) 子工作项该字段之和" },
  SUBITEMS_AVG: { args: [1, 1], doc: "SUBITEMS_AVG({字段}) 子工作项该字段平均值" },
  SUBITEMS_MIN: { args: [1, 1], doc: "SUBITEMS_MIN({字段})" },
  SUBITEMS_MAX: { args: [1, 1], doc: "SUBITEMS_MAX({字段})" },
  SUBITEMS_COUNT: { args: [0, 0], doc: "SUBITEMS_COUNT() 子工作项个数" },
  SUBITEMS_DONE: { args: [0, 0], doc: "SUBITEMS_DONE() 已完成的子工作项个数" },
  RELATED: { args: [1, 1], doc: 'RELATED("关联名") 关联的工作项列表（两个方向都算）' },
  CHILDREN: { args: [0, 0], doc: "CHILDREN() 子工作项列表" },
  NODE: { args: [1, 1], doc: 'NODE("节点名或键") 节点，取 .状态（notStarted/inProgress/completed/skipped）、.结论' },
  COUNT: { args: [1, 1], doc: "COUNT(列表) 个数" },
  COUNTIF: { args: [2, 2], doc: "COUNTIF(列表, each 的条件) 满足条件的个数" },
  SUMIF: { args: [2, 3], doc: "SUMIF(列表, each 的条件, each 的数值) 满足条件的求和" },
  FILTER: { args: [2, 2], doc: "FILTER(列表, each 的条件) 满足条件的项" },
  MAP: { args: [2, 2], doc: "MAP(列表, each 的表达式) 每一项算出的值" },
  ANYOF: { args: [2, 2], doc: "ANYOF(列表, each 的条件) 有一项满足" },
  ALLOF: { args: [2, 2], doc: "ALLOF(列表, each 的条件) 每一项都满足" },
  CONTAINS: { args: [2, 2], doc: "CONTAINS(列表或文本, 值) 是否包含" },
  JOIN: { args: [1, 2], doc: "JOIN(列表, 分隔符) 连成文本，默认用「、」" },
  FIRST: { args: [1, 1], doc: "FIRST(列表) 第一项" },
  FIND: { args: [2, 2], doc: "FIND(列表, each 的条件) 第一个满足条件的项" },
  STRING: { args: [1, 1], doc: "STRING(值) 转成文本" },
  EMPTY: { args: [1, 1], doc: "EMPTY(值) 是否为空（空列表也算）" },
  DATE: { args: [1, 1], doc: 'DATE("2026-01-01") 日期' },
  LEVEL: { args: [2, 2], doc: "LEVEL(级联值, n) 级联选项路径上的第 n 级" },
  LIST: { args: [1, 99], doc: "LIST(值1, 值2, …) 放成一个列表，空值不算" },
  TEMPLATE: { args: [0, 0], doc: "TEMPLATE() 本工作项的流程类型" },
  TYPE: { args: [0, 0], doc: "TYPE() 本工作项的类型名" },
  TODAY: { args: [0, 0], doc: "TODAY() 今天（YYYY-MM-DD）" },
};

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source.charAt(i);
    if (/\s/.test(c)) {
      i++;
    } else if (c === "." && !/[0-9]/.test(source.charAt(i + 1))) {
      tokens.push({ t: "op", v: "." });
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+|^[0-9]+\.?/.exec(source.slice(i));
      if (!m) throw new FormulaError(`第 ${i + 1} 个字符附近的数字写错了。`);
      tokens.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (c === '"') {
      const end = source.indexOf('"', i + 1);
      if (end < 0) throw new FormulaError("文本少了结尾的引号。");
      tokens.push({ t: "str", v: source.slice(i + 1, end) });
      i = end + 1;
    } else if (c === "{") {
      const end = source.indexOf("}", i + 1);
      if (end < 0) throw new FormulaError("字段少了结尾的 }。");
      tokens.push({ t: "ref", v: source.slice(i + 1, end).trim() });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i)) as RegExpExecArray;
      tokens.push({ t: "id", v: m[0].toUpperCase() });
      i += m[0].length;
    } else if (/[\u4e00-\u9fff]/.test(c)) {
      // 中文属性名（.名称 .状态 .阶段 .结论）
      const m = /^[\u4e00-\u9fff]+/.exec(source.slice(i)) as RegExpExecArray;
      tokens.push({ t: "id", v: m[0] });
      i += m[0].length;
    } else {
      const two = source.slice(i, i + 2);
      if ([">=", "<=", "!=", "<>"].includes(two)) {
        tokens.push({ t: "op", v: two === "<>" ? "!=" : two });
        i += 2;
      } else if ("+-*/&=<>(),".includes(c)) {
        tokens.push({ t: "op", v: c });
        i++;
      } else {
        throw new FormulaError(`不认识的字符「${c}」。`);
      }
    }
  }
  return tokens;
}

class Parser {
  private pos = 0;
  private readonly tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): Node {
    if (this.tokens.length === 0) throw new FormulaError("公式是空的。");
    const node = this.comparison();
    if (this.pos < this.tokens.length) throw new FormulaError("公式末尾有多余的内容。");
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private isOp(...ops: string[]): string | null {
    const t = this.peek();
    return t?.t === "op" && ops.includes(t.v) ? t.v : null;
  }
  private expect(op: string) {
    if (!this.isOp(op)) throw new FormulaError(`这里应该是「${op}」。`);
    this.pos++;
  }

  private comparison(): Node {
    const left = this.concat();
    const op = this.isOp("=", "!=", ">", ">=", "<", "<=");
    if (!op) return left;
    this.pos++;
    return { kind: "binary", op, left, right: this.concat() };
  }
  private concat(): Node {
    let node = this.additive();
    while (this.isOp("&")) {
      this.pos++;
      node = { kind: "binary", op: "&", left: node, right: this.additive() };
    }
    return node;
  }
  private additive(): Node {
    let node = this.term();
    for (let op = this.isOp("+", "-"); op; op = this.isOp("+", "-")) {
      this.pos++;
      node = { kind: "binary", op, left: node, right: this.term() };
    }
    return node;
  }
  private term(): Node {
    let node = this.unary();
    for (let op = this.isOp("*", "/"); op; op = this.isOp("*", "/")) {
      this.pos++;
      node = { kind: "binary", op, left: node, right: this.unary() };
    }
    return node;
  }
  private unary(): Node {
    if (this.isOp("-")) {
      this.pos++;
      return { kind: "unary", op: "-", arg: this.unary() };
    }
    let node = this.primary();
    while (this.isOp(".")) {
      this.pos++;
      const t = this.peek();
      this.pos++;
      if (t?.t === "ref") node = { kind: "member", target: node, prop: t.v, field: true };
      else if (t?.t === "id") node = { kind: "member", target: node, prop: t.v, field: false };
      else throw new FormulaError("「.」后面要写字段 {字段名} 或 名称、状态、阶段、结论。");
    }
    return node;
  }
  private primary(): Node {
    const t = this.peek();
    if (!t) throw new FormulaError("公式没写完。");
    this.pos++;
    switch (t.t) {
      case "num":
        return { kind: "num", value: t.v };
      case "str":
        return { kind: "str", value: t.v };
      case "ref":
        return { kind: "ref", key: t.v };
      case "id": {
        if (t.v === "TRUE" || t.v === "FALSE") return { kind: "bool", value: t.v === "TRUE" };
        if (t.v === "EACH") return { kind: "each" };
        const fn = FORMULA_FUNCTIONS[t.v];
        if (!fn) throw new FormulaError(`没有函数 ${t.v}。`);
        this.expect("(");
        const args: Node[] = [];
        if (!this.isOp(")")) {
          args.push(this.comparison());
          while (this.isOp(",")) {
            this.pos++;
            args.push(this.comparison());
          }
        }
        this.expect(")");
        if (args.length < fn.args[0] || args.length > fn.args[1])
          throw new FormulaError(`${t.v} 的参数个数不对：${fn.doc}。`);
        return { kind: "call", name: t.v, args };
      }
      case "op":
        if (t.v === "(") {
          const node = this.comparison();
          this.expect(")");
          return node;
        }
        throw new FormulaError(`这里不该出现「${t.v}」。`);
    }
  }
}

/** 公式求值时要读的数据。 */
export interface FormulaScope {
  /** 本工作项的字段值（按字段键）。 */
  field(key: string): unknown;
  /** 子工作项上某个字段的值（参数是公式里写的字段键或名称）；不提供时子工作项函数得到空值。 */
  subItemValues?(ref: string): unknown[];
  subItemCount?: number;
  subItemsDone?: number;
  /** 按关联名（或关联键）取关联的工作项。 */
  related?(name: string): FormulaItem[];
  /** 子工作项。 */
  children?(): FormulaItem[];
  /** 按节点名或节点键取节点。 */
  node?(ref: string): FormulaNode | null;
  /** 今天（YYYY-MM-DD），不提供时按 UTC 当天。 */
  today?: string;
  /** 级联选项值从第一级到它自己的路径；不提供时 LEVEL 只认第一级。 */
  optionPath?(value: string): string[];
  /** 本工作项的流程类型（流程模板名）和类型名。 */
  template?: string | null;
  typeName?: string | null;
}

export interface CompiledFormula {
  /** 规范化后的源码：本工作项字段换成 {字段键}。 */
  source: string;
  /** 引用到的本工作项字段键。 */
  refs: string[];
  /** 是否用到子工作项汇总（要在服务端算）。 */
  usesSubItems: boolean;
  /** 是否用到别的工作项（关联、子工作项列表、节点），要在服务端算，关联的工作项变了也要重算。 */
  usesRelated: boolean;
  evaluate(scope: FormulaScope): FormulaValue;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (v: unknown): number | null =>
  typeof v === "string" && DATE.test(v) ? Math.round(Date.parse(`${v}T00:00:00Z`) / 86_400_000) : null;
const blank = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const num = (v: unknown): number => {
  if (blank(v)) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const text = (v: unknown): string => {
  if (blank(v)) return "";
  if (Array.isArray(v)) return v.map(text).join("、");
  if (isItem(v)) return v.name;
  if (typeof v === "boolean") return v ? "是" : "否";
  return String(v);
};
const truthy = (v: unknown): boolean => !blank(v) && v !== false && v !== 0 && v !== "false";
const isItem = (v: unknown): v is FormulaItem =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  "field" in v &&
  typeof (v as FormulaItem).field === "function";
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : blank(v) ? [] : [v]);
/** 取一个值上的属性：工作项的字段或名称/状态/阶段，节点的状态/结论。 */
function memberOf(v: unknown, prop: string, field: boolean): unknown {
  if (Array.isArray(v)) return v.flatMap((x) => list(memberOf(x, prop, field)));
  if (isItem(v)) {
    if (field) return v.field(prop) ?? null;
    if (prop === "名称" || prop === "NAME") return v.name;
    if (prop === "状态" || prop === "STATUS") return v.status;
    if (prop === "阶段" || prop === "STAGE") return v.stage;
    if (prop === "流程类型" || prop === "TEMPLATE") return v.template ?? null;
    if (prop === "节点" || prop === "NODES") return v.nodes ?? [];
    return v.field(prop) ?? null;
  }
  // 列表里的节点：名称、状态、结论
  if (typeof v === "object" && v !== null && "name" in v && "state" in v) {
    const n = v as FormulaNodeItem;
    if (prop === "名称" || prop === "NAME") return n.name;
    if (prop === "状态" || prop === "STATE" || prop === "STATUS") return n.state;
    if (prop === "结论" || prop === "CONCLUSION") return n.conclusion;
    if (prop === "计划开始" || prop === "PLANNEDSTART") return n.plannedStart ?? null;
    if (prop === "计划结束" || prop === "PLANNEDEND") return n.plannedEnd ?? null;
    if (prop === "实际结束" || prop === "ACTUALEND") return n.actualEnd ?? null;
  }
  if (typeof v === "object" && v !== null && "state" in v) {
    const n = v as FormulaNode;
    if (prop === "状态" || prop === "STATE" || prop === "STATUS") return n.state;
    if (prop === "结论" || prop === "CONCLUSION") return n.conclusion;
    if (prop === "计划开始" || prop === "PLANNEDSTART") return n.plannedStart ?? null;
    if (prop === "计划结束" || prop === "PLANNEDEND") return n.plannedEnd ?? null;
    if (prop === "实际结束" || prop === "ACTUALEND") return n.actualEnd ?? null;
  }
  // 字段组的一行：按列取值
  if (typeof v === "object" && v !== null) return (v as Record<string, unknown>)[prop] ?? null;
  return null;
}
const finite = (n: number): number | null => (Number.isFinite(n) ? n : null);

function compareValues(op: string, a: unknown, b: unknown): boolean {
  const da = dayOf(a);
  const db = dayOf(b);
  let x: number | string;
  let y: number | string;
  if (da !== null && db !== null) [x, y] = [da, db];
  else if (typeof a === "number" || typeof b === "number") [x, y] = [num(a), num(b)];
  else [x, y] = [text(a), text(b)];
  switch (op) {
    case "=":
      return x === y;
    case "!=":
      return x !== y;
    case ">":
      return x > y;
    case ">=":
      return x >= y;
    case "<":
      return x < y;
    default:
      return x <= y;
  }
}

function output(v: unknown): FormulaValue {
  if (blank(v)) return null;
  if (typeof v === "number") return finite(v);
  if (typeof v === "boolean" || typeof v === "string") return v;
  return text(v);
}

function evaluateNode(node: Node, scope: FormulaScope, each: unknown = null): unknown {
  switch (node.kind) {
    case "each":
      return each;
    case "member":
      return memberOf(evaluateNode(node.target, scope, each), node.prop, node.field);
    case "num":
    case "str":
    case "bool":
      return node.value;
    case "ref":
      return scope.field(node.key) ?? null;
    case "unary":
      return -num(evaluateNode(node.arg, scope, each));
    case "binary": {
      const a = evaluateNode(node.left, scope, each);
      const b = evaluateNode(node.right, scope, each);
      switch (node.op) {
        case "&":
          return text(a) + text(b);
        case "+":
          return num(a) + num(b);
        case "-":
          return num(a) - num(b);
        case "*":
          return num(a) * num(b);
        case "/":
          return num(b) === 0 ? null : num(a) / num(b);
        default:
          return compareValues(node.op, a, b);
      }
    }
    case "call":
      return call(node, scope, each);
  }
}

function call(node: Extract<Node, { kind: "call" }>, scope: FormulaScope, each: unknown): unknown {
  const arg = (i: number) => evaluateNode(node.args[i] as Node, scope, each);
  // SUM、MIN 这些也接受列表（如 SUM(MAP(…))）
  const all = () => node.args.flatMap((a) => list(evaluateNode(a, scope, each)));
  const nums = () => all().flatMap((v) => (blank(v) ? [] : [num(v)]));
  /** 对列表的每一项求第 i 个参数（each 指这一项）。 */
  const perItem = (i: number) => (x: unknown) => evaluateNode(node.args[i] as Node, scope, x);
  switch (node.name) {
    case "RELATED":
      return scope.related?.(text(arg(0))) ?? [];
    case "CHILDREN":
      return scope.children?.() ?? [];
    case "NODE":
      return scope.node?.(text(arg(0))) ?? null;
    case "COUNT":
      return list(arg(0)).length;
    case "COUNTIF":
      return list(arg(0)).filter((x) => truthy(perItem(1)(x))).length;
    case "SUMIF": {
      const value = node.args.length > 2 ? perItem(2) : (x: unknown) => x;
      return list(arg(0))
        .filter((x) => truthy(perItem(1)(x)))
        .reduce((sum: number, x) => sum + num(value(x)), 0);
    }
    case "FILTER":
      return list(arg(0)).filter((x) => truthy(perItem(1)(x)));
    case "MAP":
      return list(arg(0)).flatMap((x) => list(perItem(1)(x)));
    case "ANYOF":
      return list(arg(0)).some((x) => truthy(perItem(1)(x)));
    case "ALLOF": {
      const items = list(arg(0));
      return items.length > 0 && items.every((x) => truthy(perItem(1)(x)));
    }
    case "CONTAINS": {
      const hay = arg(0);
      const needle = arg(1);
      return Array.isArray(hay) ? hay.some((x) => text(x) === text(needle)) : text(hay).includes(text(needle));
    }
    case "JOIN":
      return list(arg(0))
        .map(text)
        .filter(Boolean)
        .join(node.args.length > 1 ? text(arg(1)) : "、");
    case "FIRST":
      return list(arg(0))[0] ?? null;
    case "FIND":
      return list(arg(0)).find((x) => truthy(perItem(1)(x))) ?? null;
    case "STRING":
      return text(arg(0));
    case "EMPTY":
      return blank(arg(0));
    case "DATE": {
      const day = text(arg(0)).trim();
      return dayOf(day) === null ? null : day;
    }
    case "LIST":
      return all().filter((v) => !blank(v));
    case "TEMPLATE":
      return scope.template ?? null;
    case "TYPE":
      return scope.typeName ?? null;
    case "LEVEL": {
      const value = arg(0);
      const n = Math.trunc(num(arg(1)));
      if (blank(value) || n < 1) return null;
      const path = scope.optionPath?.(text(value)) ?? [text(value)];
      return path[n - 1] ?? null;
    }
    case "TODAY":
      return scope.today ?? new Date().toISOString().slice(0, 10);
    case "IF":
      return truthy(arg(0)) ? arg(1) : node.args.length > 2 ? arg(2) : null;
    case "AND":
      return all().every(truthy);
    case "OR":
      return all().some(truthy);
    case "NOT":
      return !truthy(arg(0));
    case "ISBLANK":
      return blank(arg(0));
    case "SUM":
      return nums().reduce((s, n) => s + n, 0);
    case "AVG": {
      const ns = nums();
      return ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : null;
    }
    case "MIN":
    case "MAX": {
      const ns = nums();
      if (!ns.length) return null;
      return node.name === "MIN" ? Math.min(...ns) : Math.max(...ns);
    }
    case "ROUND": {
      const digits = node.args.length > 1 ? Math.max(0, Math.min(10, Math.trunc(num(arg(1))))) : 0;
      const f = 10 ** digits;
      return Math.round(num(arg(0)) * f) / f;
    }
    case "ABS":
      return Math.abs(num(arg(0)));
    case "CONCAT":
      return all().map(text).join("");
    case "LEN": {
      const v = arg(0);
      return Array.isArray(v) ? v.length : text(v).length;
    }
    case "DAYS": {
      const end = dayOf(arg(0));
      const start = dayOf(arg(1));
      return end === null || start === null ? null : end - start;
    }
    case "DATEADD": {
      const day = dayOf(arg(0));
      if (day === null) return null;
      return new Date((day + Math.trunc(num(arg(1)))) * 86_400_000).toISOString().slice(0, 10);
    }
    case "SUBITEMS_COUNT":
      return scope.subItemCount ?? null;
    case "SUBITEMS_DONE":
      return scope.subItemsDone ?? null;
    default: {
      // 子工作项汇总：参数必须是一个字段
      const ref = node.args[0];
      if (!scope.subItemValues || ref?.kind !== "ref") return null;
      const ns = scope.subItemValues(ref.key).flatMap((v) => (blank(v) ? [] : [num(v)]));
      if (node.name === "SUBITEMS_SUM") return ns.reduce((s, n) => s + n, 0);
      if (!ns.length) return null;
      if (node.name === "SUBITEMS_AVG") return ns.reduce((s, n) => s + n, 0) / ns.length;
      return node.name === "SUBITEMS_MIN" ? Math.min(...ns) : Math.max(...ns);
    }
  }
}

const PRECEDENCE: Record<string, number> = { "&": 2, "+": 3, "-": 3, "*": 4, "/": 4 };
const precedence = (node: Node) =>
  node.kind === "binary" ? (PRECEDENCE[node.op] ?? 1) : node.kind === "unary" ? 5 : 6;

/** 把语法树写回源码（规范化后保存），只在需要时加括号。 */
function print(node: Node): string {
  switch (node.kind) {
    case "num":
      return String(node.value);
    case "str":
      return JSON.stringify(node.value);
    case "bool":
      return node.value ? "TRUE" : "FALSE";
    case "ref":
      return `{${node.key}}`;
    case "unary":
      return `-${wrap(node.arg, precedence(node.arg) < 5)}`;
    case "binary": {
      const p = precedence(node);
      return `${wrap(node.left, precedence(node.left) < p)} ${node.op} ${wrap(node.right, precedence(node.right) <= p)}`;
    }
    case "call":
      return `${node.name}(${node.args.map(print).join(", ")})`;
    case "each":
      return "each";
    case "member":
      return `${wrap(node.target, precedence(node.target) < 6)}.${node.field ? `{${node.prop}}` : node.prop}`;
  }
}
const wrap = (node: Node, parens: boolean) => (parens ? `(${print(node)})` : print(node));

/**
 * 编译公式。resolve 把公式里写的字段名或字段键换成本工作项类型上的字段键，找不到返回 undefined。
 * 子工作项函数里的字段不在本类型上，原样保留，求值时再按子工作项的字段对。
 */
export function compileFormula(source: string, resolve: (ref: string) => string | undefined): CompiledFormula {
  const tree = new Parser(tokenize(source)).parse();
  const refs = new Set<string>();
  let usesSubItems = false;
  let usesRelated = false;
  const walk = (node: Node, inAggregate: boolean): Node => {
    switch (node.kind) {
      case "member":
        // 成员上的字段是别的工作项的字段，不按本类型解析
        return { ...node, target: walk(node.target, inAggregate) };
      case "ref": {
        if (inAggregate) return node;
        const key = resolve(node.key);
        if (!key) throw new FormulaError(`字段「${node.key}」不存在。`);
        refs.add(key);
        return { kind: "ref", key };
      }
      case "unary":
        return { ...node, arg: walk(node.arg, inAggregate) };
      case "binary":
        return { ...node, left: walk(node.left, inAggregate), right: walk(node.right, inAggregate) };
      case "call": {
        const aggregate = (AGGREGATES as readonly string[]).includes(node.name);
        if (aggregate || (COUNTS as readonly string[]).includes(node.name)) usesSubItems = true;
        if ((CROSS_ITEM as readonly string[]).includes(node.name)) usesRelated = true;
        if (aggregate && node.args[0]?.kind !== "ref")
          throw new FormulaError(`${node.name} 的参数要写成一个字段，比如 ${node.name}({工时})。`);
        return { ...node, args: node.args.map((a) => walk(a, aggregate)) };
      }
      default:
        return node;
    }
  };
  const resolved = walk(tree, false);
  return {
    source: print(resolved),
    refs: [...refs],
    usesSubItems,
    usesRelated,
    evaluate: (scope) => output(evaluateNode(resolved, scope)),
  };
}

/**
 * 按依赖顺序排列一个类型上的公式字段：被引用的先算。有循环引用时抛错，指出是哪些字段。
 */
export function orderFormulas<T extends { key: string; name: string; refs: readonly string[] }>(formulas: T[]): T[] {
  const byKey = new Map(formulas.map((f) => [f.key, f]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const ordered: T[] = [];
  const visit = (f: T, path: string[]) => {
    if (done.has(f.key)) return;
    if (visiting.has(f.key)) throw new FormulaError(`公式循环引用：${[...path, f.name].join(" → ")}。`);
    visiting.add(f.key);
    for (const ref of f.refs) {
      const dep = byKey.get(ref);
      if (dep) visit(dep, [...path, f.name]);
    }
    visiting.delete(f.key);
    done.add(f.key);
    ordered.push(f);
  };
  for (const f of formulas) visit(f, []);
  return ordered;
}
