/**
 * 字段类型和字段值的规范形式。前端编辑、mutator 写入、自动化动作都先过这里，
 * 存进 field_value.value 的总是规范形式：
 *
 * - text、textarea：字符串；richText：HTML 字符串
 * - link、docLink：http(s) 链接字符串；phone：电话号码；email：邮箱
 * - number：有限数字
 * - bool：true / false
 * - date：YYYY-MM-DD；datetime：YYYY-MM-DD HH:mm；dateRange：{ start, end }（YYYY-MM-DD，start ≤ end）
 * - select、radio、cascadeSelect、businessLine：选项值（业务线的选项来自空间业务线树）；multiSelect、cascadeMulti：选项值数组（去重、按选项顺序）
 * - user：用户 id 数组（去重）；singleUser：用户 id
 * - attachment：附件 id 数组
 * - signal：{ state, text?, url? }；multiSignal：它的数组（只由开放接口写入）
 * - fieldGroup：多行表格，每行是「列键 → 该列的规范值」，空行去掉（列定义在 config.columns）
 * - multiPerson：每人一行，行里 _user 是填写人，其余同字段组；一人只有一行，没填的行也保留（人在名单上）
 *
 * 空值（空字符串、空数组）统一成 null。
 */

export type FieldDataType =
  | "text"
  | "textarea"
  | "richText"
  | "number"
  | "bool"
  | "date"
  | "datetime"
  | "dateRange"
  | "select"
  | "radio"
  | "multiSelect"
  | "cascadeSelect"
  | "cascadeMulti"
  | "businessLine"
  | "user"
  | "singleUser"
  | "link"
  | "docLink"
  | "phone"
  | "email"
  | "attachment"
  | "signal"
  | "multiSignal"
  | "fieldGroup"
  | "multiPerson"
  | "vote"
  | "relation"
  | "formula";

/** 界面上能新建的字段类型，按字段类型分组排序（关联走关联定义，公式由公式引擎计算）。 */
export const EDITABLE_FIELD_TYPES = [
  "text",
  "textarea",
  "richText",
  "select",
  "multiSelect",
  "cascadeSelect",
  "cascadeMulti",
  "radio",
  "businessLine",
  "singleUser",
  "user",
  "date",
  "dateRange",
  "datetime",
  "number",
  "bool",
  "link",
  "docLink",
  "attachment",
  "phone",
  "email",
  "signal",
  "multiSignal",
  "fieldGroup",
  "multiPerson",
  "vote",
] as const;

export const FIELD_TYPE_LABEL: Record<FieldDataType, string> = {
  text: "单行文本",
  textarea: "多行文本",
  richText: "富文本",
  number: "数字",
  bool: "开关",
  date: "日期",
  datetime: "日期+时间",
  dateRange: "日期区间",
  select: "单选",
  radio: "单选按钮",
  multiSelect: "多选",
  cascadeSelect: "级联单选",
  cascadeMulti: "级联多选",
  businessLine: "业务线",
  user: "多选人员",
  singleUser: "单选人员",
  link: "URL",
  docLink: "关联云文档",
  phone: "电话",
  email: "邮箱",
  attachment: "附件",
  signal: "系统外信号",
  multiSignal: "多值系统外信号",
  fieldGroup: "字段组",
  multiPerson: "多人复合字段",
  vote: "投票",
  relation: "关联工作项",
  formula: "公式",
};

/** 有选项的字段类型。 */
export const OPTION_FIELD_TYPES: readonly FieldDataType[] = [
  "select",
  "radio",
  "multiSelect",
  "cascadeSelect",
  "cascadeMulti",
  "vote",
];
/** 级联字段：选项用 parent 组成树（业务线的选项是空间的业务线树）。 */
export const CASCADE_FIELD_TYPES: readonly FieldDataType[] = ["cascadeSelect", "cascadeMulti", "businessLine"];
/** 值是数组的字段类型。 */
export const MULTI_VALUE_FIELD_TYPES: readonly FieldDataType[] = [
  "multiSelect",
  "cascadeMulti",
  "user",
  "attachment",
  "multiSignal",
];
/** 只能由开放接口和自动化写入、页面上只读的字段类型。 */
export const SYSTEM_WRITTEN_FIELD_TYPES: readonly FieldDataType[] = ["signal", "multiSignal", "formula", "relation"];
/** 不能直接写值的字段类型：投票只能投票、放榜（见 sync 的 vote）。 */
export const NOT_DIRECTLY_WRITTEN_FIELD_TYPES: readonly FieldDataType[] = [...SYSTEM_WRITTEN_FIELD_TYPES, "vote"];

export interface FieldOption {
  value: string;
  label?: string;
  color?: string;
  /** 级联字段里的上级选项值。 */
  parent?: string;
  /** 禁用的选项不能再选，已经选了的保留。 */
  disabled?: boolean;
  /** 投票选项的分值（算平均分）。 */
  score?: number;
}

/**
 * 投票字段的设置：表态（赞成 / 反对 / 弃权）、单选、多选；
 * 备注不需要 / 可填 / 必填；盲投时放榜前只看得到自己的票，放榜的是空间管理员和 revealRoles 里的角色。
 */
export interface VoteConfig {
  mode: "stance" | "single" | "multi";
  remark?: "off" | "optional" | "required";
  blind?: boolean;
  revealRoles?: string[];
}

/** 投票字段存在字段值里的汇总：投过票的人、是否已放榜。每张票在 vote_ballot 表里。 */
export interface VoteSummary {
  voters: string[];
  revealed: boolean;
}

/** 表态投票的默认选项。 */
export const STANCE_OPTIONS: (FieldOption & { label: string })[] = [
  { value: "赞成", label: "赞成", color: "green", score: 1 },
  { value: "反对", label: "反对", color: "red", score: 0 },
  { value: "弃权", label: "弃权", color: "grey" },
];

/** 数字的显示格式。只影响显示，存的总是原值。 */
export interface NumberFormat {
  /** 小数位数；不设时原样显示。 */
  precision?: number;
  /** 千分位分隔。 */
  thousands?: boolean;
  /** 缩放：百分比 ×100 加 %，千分比 ×1000 加 ‰，千 / 万 / 百万 除下去加单位。 */
  scale?: "raw" | "percent" | "permille" | "thousand" | "tenThousand" | "million";
  /** 自定义符号（如 ¥、件）和位置。 */
  symbol?: string;
  symbolPosition?: "before" | "after";
}

export interface FieldSpec {
  name: string;
  dataType: FieldDataType;
  options?: readonly FieldOption[] | null;
  /** 数字格式、级联层级、字段组的列等类型相关的设置（见 field-rules 的 FieldConfig）。 */
  config?: {
    number?: NumberFormat | null;
    leafOnly?: boolean | null;
    columns?: readonly FieldGroupColumn[] | null;
    people?: MultiPersonConfig | null;
    vote?: VoteConfig | null;
  } | null;
}

/** 字段组的一列：一个小字段。 */
export interface FieldGroupColumn {
  key: string;
  name: string;
  dataType: FieldGroupColumnType;
  options?: readonly FieldOption[] | null;
}

/** 字段组里能用的列类型。 */
export const FIELD_GROUP_COLUMN_TYPES = [
  "text",
  "number",
  "select",
  "multiSelect",
  "cascadeSelect",
  "date",
  "bool",
  "singleUser",
  "user",
  "link",
] as const;
export type FieldGroupColumnType = (typeof FIELD_GROUP_COLUMN_TYPES)[number];

/**
 * 多人复合字段的填写人：role 设了就是这个角色上的人各填一组，
 * 没设就是自行添加（每人把自己加进来填）。
 */
export interface MultiPersonConfig {
  role?: string | null;
}

/** 多人复合字段每行里填写人的键。 */
export const PERSON_KEY = "_user";

/** 字段组的一行。 */
export type FieldGroupRow = Record<string, unknown>;

const columnSpec = (column: FieldGroupColumn): FieldSpec => ({
  name: column.name,
  dataType: column.dataType,
  options: column.options ?? null,
});

/** 系统外信号的状态。 */
export const SIGNAL_STATES = ["none", "pending", "passed", "failed"] as const;
export type SignalState = (typeof SIGNAL_STATES)[number];
export const SIGNAL_STATE_LABEL: Record<SignalState, string> = {
  none: "无信号",
  pending: "处理中",
  passed: "通过",
  failed: "不通过",
};
export interface Signal {
  state: SignalState;
  text?: string;
  url?: string;
}

export interface DateRange {
  start: string;
  end: string;
}

export class FieldValueError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const PHONE = /^\+?[\d\s()-]{5,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL = /^https?:\/\/\S+$/i;

export function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 级联选项从根到它自己的路径（选项值）。遇到环时停下。 */
export function optionPath(options: readonly FieldOption[], value: string): string[] {
  const byValue = new Map(options.map((o) => [o.value, o]));
  const path: string[] = [];
  let current = byValue.get(value);
  while (current && !path.includes(current.value)) {
    path.unshift(current.value);
    current = current.parent ? byValue.get(current.parent) : undefined;
  }
  return path;
}

/** 选项的显示文字；级联选项显示完整路径「A / B」。 */
export function optionLabel(field: FieldSpec, value: unknown): string {
  const options = field.options ?? [];
  const label = (v: string) => {
    const o = options.find((x) => x.value === v);
    return o?.label || v;
  };
  if (CASCADE_FIELD_TYPES.includes(field.dataType))
    return optionPath(options, String(value)).map(label).join(" / ") || String(value);
  return label(String(value));
}

function normalizeSignal(value: unknown, fail: (why: string) => never): Signal {
  const raw = isObject(value) ? value : { state: value };
  const state = String(raw.state ?? "");
  if (!(SIGNAL_STATES as readonly string[]).includes(state)) fail(`的信号状态只能是 ${SIGNAL_STATES.join(" / ")}。`);
  const signal: Signal = { state: state as SignalState };
  if (typeof raw.text === "string" && raw.text.trim()) signal.text = raw.text.trim();
  if (typeof raw.url === "string" && raw.url.trim()) {
    if (!URL.test(raw.url.trim())) fail("的信号链接要以 http:// 或 https:// 开头。");
    signal.url = raw.url.trim();
  }
  return signal;
}

/** 把输入整理成字段的规范值；不合法时抛 FieldValueError，消息可以直接给用户看。 */
export function normalizeFieldValue(field: FieldSpec, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (Array.isArray(value) && value.length === 0) return null;
  const fail = (why: string): never => {
    throw new FieldValueError(`「${field.name}」${why}`);
  };
  const optionList = field.options ?? [];
  const options = optionList.map((o) => o.value);
  const text = (what: string) =>
    typeof value === "string" || typeof value === "number" ? String(value).trim() : fail(`要填${what}。`);

  switch (field.dataType) {
    case "text":
      return text("文本");
    case "textarea":
      // 多行文本保留行首缩进，只去掉首尾空行
      return typeof value === "string" ? value.replace(/^\s*\n|\s+$/g, "") : text("文本");
    case "richText": {
      const html = typeof value === "string" ? value.trim() : fail("要填富文本。");
      return richTextToPlain(html).trim() === "" && !/<img\b/i.test(html) ? null : html;
    }
    case "link":
    case "docLink": {
      const link = typeof value === "string" ? value.trim() : fail("要填链接。");
      if (!URL.test(link)) fail("要填以 http:// 或 https:// 开头的链接。");
      return link;
    }
    case "phone": {
      const phone = text("电话");
      if (!PHONE.test(phone)) fail("要填电话号码。");
      return phone;
    }
    case "email": {
      const email = text("邮箱");
      if (!EMAIL.test(email)) fail("要填邮箱地址。");
      return email.toLowerCase();
    }
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
      if (!Number.isFinite(n)) fail("要填数字。");
      return n;
    }
    case "bool":
      if (value === true || value === "true" || value === "是") return true;
      if (value === false || value === "false" || value === "否") return false;
      return fail("只能选是或否。");
    case "date": {
      const day = typeof value === "string" ? value.trim() : "";
      if (!validDate(day)) fail("要填日期（YYYY-MM-DD）。");
      return day;
    }
    case "datetime": {
      const m = typeof value === "string" ? DATETIME.exec(value.trim()) : null;
      if (!m?.[1] || !validDate(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59)
        fail("要填日期和时间（YYYY-MM-DD HH:mm）。");
      return `${m?.[1]} ${m?.[2]}:${m?.[3]}`;
    }
    case "dateRange": {
      const raw = Array.isArray(value) ? { start: value[0], end: value[1] } : isObject(value) ? value : null;
      const start = typeof raw?.start === "string" ? raw.start.trim() : "";
      const end = typeof raw?.end === "string" ? raw.end.trim() : "";
      if (!start && !end) return null;
      if (!validDate(start) || !validDate(end)) fail("要填开始和结束日期（YYYY-MM-DD）。");
      if (start > end) fail("的开始日期不能晚于结束日期。");
      return { start, end };
    }
    case "select":
    case "radio":
    case "cascadeSelect":
    case "businessLine": {
      const v = String(value);
      if (!options.includes(v)) fail(`没有选项「${v}」。`);
      if (field.dataType === "cascadeSelect" && field.config?.leafOnly && optionList.some((o) => o.parent === v))
        fail("要选到最后一级。");
      return v;
    }
    case "multiSelect":
    case "cascadeMulti": {
      const chosen = new Set(asList(value).map(String));
      for (const v of chosen) if (!options.includes(v)) fail(`没有选项「${v}」。`);
      if (field.dataType === "cascadeMulti" && field.config?.leafOnly)
        for (const v of chosen) if (optionList.some((o) => o.parent === v)) fail("要选到最后一级。");
      return options.filter((o) => chosen.has(o));
    }
    case "user": {
      const ids = [...new Set(asList(value).map(String))].filter((id) => id !== "");
      return ids.length > 0 ? ids : null;
    }
    case "singleUser": {
      const ids = asList(value)
        .map(String)
        .filter((id) => id !== "");
      if (ids.length > 1) fail("只能选一个人。");
      return ids[0] ?? null;
    }
    case "attachment": {
      const ids = [...new Set(asList(value).map(String))].filter((id) => id !== "");
      return ids.length > 0 ? ids : null;
    }
    case "signal":
      return normalizeSignal(value, fail);
    case "multiSignal":
      return asList(value).map((v) => normalizeSignal(v, fail));
    case "fieldGroup": {
      const columns = field.config?.columns ?? [];
      const rows: FieldGroupRow[] = [];
      for (const [i, raw] of asList(value).entries()) {
        if (!isObject(raw)) fail(`第 ${i + 1} 行不是一行数据。`);
        const row: FieldGroupRow = {};
        for (const column of columns) {
          try {
            const v = normalizeFieldValue(columnSpec(column), (raw as Record<string, unknown>)[column.key]);
            if (v !== null) row[column.key] = v;
          } catch (e) {
            fail(`第 ${i + 1} 行${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (Object.keys(row).length > 0) rows.push(row);
      }
      return rows.length > 0 ? rows : null;
    }
    case "multiPerson": {
      const columns = field.config?.columns ?? [];
      const rows: FieldGroupRow[] = [];
      const seen = new Set<string>();
      for (const [i, raw] of asList(value).entries()) {
        if (!isObject(raw)) fail(`第 ${i + 1} 行不是一行数据。`);
        const record = raw as Record<string, unknown>;
        const user = typeof record[PERSON_KEY] === "string" ? (record[PERSON_KEY] as string) : "";
        if (!user) fail(`第 ${i + 1} 行没有填写人。`);
        if (seen.has(user)) fail("每人只能有一组。");
        seen.add(user);
        const row: FieldGroupRow = { [PERSON_KEY]: user };
        for (const column of columns) {
          try {
            const v = normalizeFieldValue(columnSpec(column), record[column.key]);
            if (v !== null) row[column.key] = v;
          } catch (e) {
            fail(`第 ${i + 1} 行${e instanceof Error ? e.message : String(e)}`);
          }
        }
        rows.push(row);
      }
      return rows.length > 0 ? rows : null;
    }
    case "vote":
      return fail("是投票字段，要在字段上投票。");
    case "relation":
      return fail("是关联字段，要在关联里设置。");
    case "formula":
      return fail("是公式字段，由系统计算，不能手动修改。");
  }
}

/** 富文本 HTML 去掉标签后的纯文本，用于检索、列表和事件描述。 */
export function richTextToPlain(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const SCALE: Record<NonNullable<NumberFormat["scale"]>, [number, string]> = {
  raw: [1, ""],
  percent: [100, "%"],
  permille: [1000, "‰"],
  thousand: [1 / 1000, "千"],
  tenThousand: [1 / 10_000, "万"],
  million: [1 / 1_000_000, "百万"],
};

/** 按数字格式显示数字。 */
export function formatNumber(value: number, format: NumberFormat | null | undefined): string {
  if (!format) return String(Math.round(value * 10_000) / 10_000);
  const [factor, unit] = SCALE[format.scale ?? "raw"];
  const scaled = value * factor;
  const precision = format.precision;
  let text =
    precision === undefined
      ? String(Math.round(scaled * 10_000) / 10_000)
      : scaled.toFixed(Math.max(0, Math.min(10, precision)));
  if (format.thousands) {
    const [int = "", frac] = text.split(".");
    text = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac !== undefined ? `.${frac}` : "");
  }
  text += unit;
  if (format.symbol) text = format.symbolPosition === "after" ? text + format.symbol : format.symbol + text;
  return text;
}

/** 字段值的可读文本，用于列表、事件描述等。 */
export function formatFieldValue(
  field: FieldSpec,
  value: unknown,
  userName: (id: string) => string = (id) => id,
): string {
  if (value === null || value === undefined) return "";
  const signal = (v: unknown) => {
    if (!isObject(v)) return String(v);
    const state = SIGNAL_STATE_LABEL[v.state as SignalState] ?? String(v.state);
    return typeof v.text === "string" && v.text ? `${state}：${v.text}` : state;
  };
  switch (field.dataType) {
    case "bool":
      return value === true ? "是" : value === false ? "否" : String(value);
    case "number":
      return typeof value === "number" ? formatNumber(value, field.config?.number) : String(value);
    case "select":
    case "radio":
    case "cascadeSelect":
    case "businessLine":
      return optionLabel(field, value);
    case "multiSelect":
    case "cascadeMulti":
      return asList(value)
        .map((v) => optionLabel(field, v))
        .join("、");
    case "user":
    case "singleUser":
      return asList(value).map(String).map(userName).join("、");
    case "richText":
      return richTextToPlain(String(value));
    case "dateRange":
      return isObject(value) ? `${String(value.start)} ~ ${String(value.end)}` : String(value);
    case "attachment":
      return `${asList(value).length} 个附件`;
    case "signal":
      return signal(value);
    case "multiSignal":
      return asList(value).map(signal).join("、");
    case "fieldGroup":
      return `${asList(value).length} 行`;
    case "multiPerson":
      return `${asList(value).length} 人`;
    case "vote":
      return isObject(value) ? `${asList(value.voters).length} 人已投` : "";
    case "formula":
      if (typeof value === "number") return String(Math.round(value * 10_000) / 10_000);
      if (typeof value === "boolean") return value ? "是" : "否";
      return String(value);
    default:
      return Array.isArray(value) ? value.join("、") : String(value);
  }
}

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/**
 * 字段值的检索列：数字和日期（按天数）放进 num 做范围筛选，文本类放进 str 做模糊匹配，
 * 单选、多选、人员、是否的每个值放进 items 做“属于”筛选。
 */
export function fieldIndex(
  field: FieldSpec,
  value: unknown,
): { num: number | null; str: string | null; items: string[] } {
  const empty = { num: null, str: null, items: [] as string[] };
  if (value === null || value === undefined) return empty;
  switch (field.dataType) {
    case "number":
      return { ...empty, num: Number(value) };
    case "date":
      return { ...empty, num: dayNumber(String(value)), str: String(value) };
    case "datetime": {
      const [day = "", time = "00:00"] = String(value).split(" ");
      return { ...empty, num: Date.parse(`${day}T${time}:00Z`) / 86_400_000, str: String(value) };
    }
    case "dateRange":
      // 按开始日期筛范围，文字里带上结束日期
      return isObject(value)
        ? { ...empty, num: dayNumber(String(value.start)), str: `${String(value.start)} ~ ${String(value.end)}` }
        : empty;
    case "text":
    case "textarea":
    case "link":
    case "docLink":
    case "phone":
    case "email":
      return { ...empty, str: String(value) };
    case "richText":
      return { ...empty, str: richTextToPlain(String(value)) };
    case "select":
    case "radio":
    case "bool":
    case "singleUser":
      return { ...empty, items: [String(value)] };
    case "cascadeSelect":
    case "businessLine":
      // 级联值的每一级都能命中「属于」筛选：筛「华东」时「华东 / 上海」也算
      return { ...empty, items: optionPath(field.options ?? [], String(value)) };
    case "cascadeMulti":
      return {
        ...empty,
        items: [...new Set(asList(value).flatMap((v) => optionPath(field.options ?? [], String(v))))],
      };
    case "multiSelect":
    case "user":
      return { ...empty, items: asList(value).map(String) };
    case "signal":
      return isObject(value) ? { ...empty, items: [String(value.state)], str: formatFieldValue(field, value) } : empty;
    case "multiSignal":
      return {
        ...empty,
        items: [...new Set(asList(value).map((v) => (isObject(v) ? String(v.state) : String(v))))],
      };
    case "fieldGroup": {
      // 每个单元格的文字都能搜到
      const columns = field.config?.columns ?? [];
      const cells = asList(value).flatMap((row) =>
        isObject(row) ? columns.map((c) => formatFieldValue(columnSpec(c), row[c.key] ?? null)).filter(Boolean) : [],
      );
      return { ...empty, str: cells.join(" ") || null };
    }
    case "multiPerson": {
      // 按填写人筛「属于」，单元格文字能搜到
      const columns = field.config?.columns ?? [];
      const rows = asList(value).filter(isObject);
      const cells = rows.flatMap((row) =>
        columns.map((c) => formatFieldValue(columnSpec(c), row[c.key] ?? null)).filter(Boolean),
      );
      return {
        ...empty,
        num: rows.length,
        str: cells.join(" ") || null,
        items: rows.map((r) => String(r[PERSON_KEY])),
      };
    }
    case "vote":
      // 按投票人数筛范围，投过票的人能按「属于」筛
      return isObject(value)
        ? { ...empty, num: asList(value.voters).length, items: asList(value.voters).map(String) }
        : empty;
    case "formula":
      // 公式的结果类型看值：数字、日期可以按范围筛，文本按包含筛，是否按属于筛
      if (typeof value === "number") return fieldIndex({ ...field, dataType: "number" }, value);
      if (typeof value === "boolean") return fieldIndex({ ...field, dataType: "bool" }, value);
      if (validDate(String(value))) return fieldIndex({ ...field, dataType: "date" }, value);
      return fieldIndex({ ...field, dataType: "text" }, value);
    default:
      return empty;
  }
}

/**
 * 条件求值时字段值的样子：日期区间取开始日期，系统外信号取状态，
 * 级联值展开成整条路径（条件「业务线 = 华东」对「华东 / 上海」也成立）。
 */
export function conditionValue(field: FieldSpec, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  switch (field.dataType) {
    case "dateRange":
      return isObject(value) ? value.start : value;
    case "signal":
      return isObject(value) ? value.state : value;
    case "multiSignal":
      return asList(value).map((v) => (isObject(v) ? v.state : v));
    case "richText":
      return richTextToPlain(String(value));
    case "cascadeSelect":
    case "cascadeMulti":
    case "businessLine":
      return fieldIndex(field, value).items;
    default:
      return value;
  }
}

/** 列表里能粘贴文本的字段类型（附件、信号、字段组、关联、公式不行）。 */
export const PASTEABLE_FIELD_TYPES: readonly FieldDataType[] = [
  "text",
  "textarea",
  "richText",
  "number",
  "bool",
  "date",
  "datetime",
  "dateRange",
  "select",
  "radio",
  "multiSelect",
  "cascadeSelect",
  "cascadeMulti",
  "businessLine",
  "user",
  "singleUser",
  "link",
  "docLink",
  "phone",
  "email",
];

/**
 * 把复制来的文本（列表单元格、Excel、在线表格）转成字段值，对照 formatFieldValue 的反方向：
 * 选项按显示名（级联按「上级 / 下级」或末级名）找，人员按名字找，多值用顿号、逗号或分号隔开。
 * 空文本是清空（null）；对不上的返回 { error }。最终的校验和整理仍由 normalizeFieldValue 做。
 */
export function parseFieldText(
  field: FieldSpec,
  text: string,
  findUser: (name: string) => string | undefined = () => undefined,
): { value: unknown } | { error: string } {
  const raw = text.trim();
  if (!PASTEABLE_FIELD_TYPES.includes(field.dataType)) return { error: `「${field.name}」不能粘贴。` };
  if (raw === "") return { value: null };
  const parts = raw
    .split(/[、,，;；\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const option = (label: string) => {
    const options = field.options ?? [];
    const hit =
      options.find((o) => optionLabel(field, o.value) === label) ??
      options.find((o) => (o.label || o.value) === label) ??
      options.find((o) => o.value === label);
    return hit?.value;
  };
  const many = <T>(names: string[], find: (s: string) => T | undefined, what: string) => {
    const out: T[] = [];
    for (const n of names) {
      const v = find(n);
      if (v === undefined) return { error: `「${field.name}」没有${what}「${n}」。` };
      out.push(v);
    }
    return { value: out };
  };
  switch (field.dataType) {
    case "number": {
      // 去掉数字格式加上的符号、单位和千分位，再按缩放还原
      const format = field.config?.number;
      const [factor, unit] = SCALE[format?.scale ?? "raw"];
      let t = raw;
      if (format?.symbol) t = t.split(format.symbol).join("");
      // 带单位（如 50%、3万）按缩放还原；不带单位的数字原样存
      const scaled = unit !== "" && t.trim().endsWith(unit);
      if (scaled) t = t.trim().slice(0, -unit.length);
      const n = Number(t.replace(/[,，\s]/g, ""));
      if (t.trim() === "" || !Number.isFinite(n)) return { error: `「${field.name}」要填数字。` };
      return { value: scaled ? n / factor : n };
    }
    case "bool":
      if (["是", "true", "TRUE", "1", "开"].includes(raw)) return { value: true };
      if (["否", "false", "FALSE", "0", "关"].includes(raw)) return { value: false };
      return { error: `「${field.name}」要填「是」或「否」。` };
    case "date":
      return { value: raw.replace(/\//g, "-").slice(0, 10) };
    case "dateRange": {
      const [start, end] = raw.split(/\s*[~～至]\s*/).map((s) => s.replace(/\//g, "-"));
      return start && end ? { value: { start, end } } : { error: `「${field.name}」要填「开始 ~ 结束」。` };
    }
    case "select":
    case "radio":
    case "cascadeSelect":
    case "businessLine": {
      const v = option(raw);
      return v === undefined ? { error: `「${field.name}」没有选项「${raw}」。` } : { value: v };
    }
    case "multiSelect":
    case "cascadeMulti":
      return many(parts, option, "选项");
    case "user":
      return many(parts, findUser, "成员");
    case "singleUser": {
      const id = findUser(raw);
      return id === undefined ? { error: `「${field.name}」没有成员「${raw}」。` } : { value: id };
    }
    case "richText":
      return {
        value: raw
          .split("\n")
          .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
          .join(""),
      };
    case "textarea":
      return { value: text.replace(/^\s*\n|\s+$/g, "") };
    default:
      return { value: raw };
  }
}
