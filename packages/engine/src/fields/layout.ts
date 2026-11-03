/*
 * 详情页和新建页的布局，对照飞书项目的「页面布局」：
 *
 * - 详情页由页签组成：自定义页签（里面分组，组里放字段和控件）和系统页签（节点详情、评论、动态），
 *   页签可以排序、删除系统页签、设显示条件。
 * - 分组里可以放：字段（可改显示名、附加说明、显示条件、新建页隐藏、占满一行）、提示文字、
 *   某种关联的工作项、全部关联、子工作项、角色与人员、附件。同一个字段可以放在多处。
 * - 新建页可以和详情页同步（按详情页里字段的顺序），也可以单独布局。
 *
 * 布局只决定怎么显示，不是权限：藏起来的字段照样能被公式、筛选、自动化使用。
 * 没放进任何地方、也没藏起来的字段（比如布局保存之后新加的字段）排在第一个自定义页签最后的「其他字段」里，
 * 所以新字段不会因为忘了改布局而看不到。
 *
 * 早期的布局只有一层分组（groups + hidden），读的时候换算成「基本信息」页签。
 */

import { type Condition, conditionFields } from "../flow/condition.ts";

/** 早期布局的分组（只有字段）。 */
export interface DetailLayoutGroup {
  name: string;
  /** 分组里的字段键，按显示顺序。 */
  fields: string[];
  /** 详情页上默认收起。 */
  collapsed?: boolean;
}

export type LayoutItem =
  | {
      kind: "field";
      field: string;
      /** 显示名，不填用字段名。 */
      label?: string;
      /** 附加说明，显示在控件下面。 */
      hint?: string;
      /** 布局上的显示条件（和字段自己的显示规则同时生效）。 */
      showWhen?: Condition;
      /** 新建页不显示。 */
      createHidden?: boolean;
      /** 占满一行（两栏布局里）。 */
      wide?: boolean;
    }
  | { kind: "text"; text: string; tone?: "info" | "warning" }
  /** 一种关联的关联工作项列表。 */
  | { kind: "relation"; relationDefId: string; title?: string }
  /**
   * 关联信息：沿一种关联，只读显示关联工作项上的一个字段（对照飞书项目的「关联信息」控件）。
   * field 是对端类型的字段名或字段键；关联了多个时值用「、」连起来。
   */
  | { kind: "relatedField"; relationDefId: string; field: string; label?: string }
  /**
   * 节点信息：显示某个节点的负责人、排期（可改）、完成结论（对照飞书项目的「节点信息」控件）。
   * node 是节点键或节点名；工作项的流程里没有这个节点时不显示。
   */
  | { kind: "nodeInfo"; node: string; info?: NodeInfoPart[]; label?: string }
  /**
   * 关联工作项视图：一种关联的工作项排成表格，列是对端的字段（字段名或键，「名称」「状态」是工作项自带的），
   * 字段单元格可以直接改（对照飞书项目的「关联工作项视图」控件）。
   */
  | { kind: "relationTable"; relationDefId: string; columns: string[]; title?: string }
  /**
   * 多节点视图：几个节点排成表格，看各自的负责人、状态、结论和意见（对照飞书项目的「多节点视图」）。
   * nodes 是节点键或名；template 填了时只在用这个流程类型的工作项上显示。
   */
  | { kind: "nodeTable"; nodes: string[]; template?: string; title?: string }
  /** 所有关联（含上级、子工作项）。 */
  | { kind: "relations" }
  | { kind: "roles" }
  | { kind: "subItems" }
  | { kind: "attachments" };

/** 节点信息里显示哪些：负责人、排期、完成结论和意见。 */
export type NodeInfoPart = "owner" | "schedule" | "conclusion";

export interface LayoutSection {
  name: string;
  items: LayoutItem[];
  collapsed?: boolean;
  /** 一栏还是两栏。 */
  columns?: 1 | 2;
}

export type SystemTab = "nodes" | "comments" | "activity";

export interface LayoutTab {
  key: string;
  name: string;
  /** 系统页签；为空的是自定义页签。 */
  system?: SystemTab;
  sections?: LayoutSection[];
  /** 满足条件才显示这个页签。 */
  showWhen?: Condition;
}

export interface DetailLayout {
  /** 早期布局：一层分组。 */
  groups?: DetailLayoutGroup[];
  /** 详情页和新建表单上都不显示的字段。 */
  hidden?: string[];
  tabs?: LayoutTab[];
  /** 新建页：和详情页同步，或单独布局。 */
  create?: { mode: "sync" } | { mode: "custom"; items: LayoutItem[] };
  /** 字段名在控件左边还是上面。 */
  labelPosition?: "side" | "top";
}

export const SYSTEM_TAB_NAME: Record<SystemTab, string> = {
  nodes: "节点详情",
  comments: "评论",
  activity: "动态",
};

/** 没配置布局时唯一的分组。 */
export const DEFAULT_LAYOUT_GROUP = "字段";
/** 配置了布局、但没放进分组的字段所在的分组。 */
export const OTHER_LAYOUT_GROUP = "其他字段";
/** 第一个自定义页签的默认名称。 */
export const BASIC_TAB = "基本信息";

/** 按页签整理好的布局：每个字段都有着落（没放的进「其他字段」）。 */
export interface ResolvedLayout {
  tabs: LayoutTab[];
  create: LayoutItem[];
  labelPosition: "side" | "top";
}

const fieldItem = (field: string): LayoutItem => ({ kind: "field", field });

/** 默认的系统页签。 */
const systemTabs = (): LayoutTab[] =>
  (["nodes", "comments", "activity"] as const).map((system) => ({
    key: system,
    name: SYSTEM_TAB_NAME[system],
    system,
  }));

/** 布局里放到了的字段键。 */
function placedFields(tabs: readonly LayoutTab[]): Set<string> {
  const placed = new Set<string>();
  for (const tab of tabs)
    for (const section of tab.sections ?? [])
      for (const item of section.items) if (item.kind === "field") placed.add(item.field);
  return placed;
}

/**
 * 把布局整理成页签形式。fields 是类型的字段（按字段顺序），布局里引用了已经不存在的字段时跳过。
 */
export function resolveLayout(
  fields: readonly { key: string }[],
  layout: DetailLayout | null | undefined,
): ResolvedLayout {
  const known = new Set(fields.map((f) => f.key));
  const hidden = new Set(layout?.hidden ?? []);
  let tabs: LayoutTab[];
  if (layout?.tabs?.length) {
    tabs = layout.tabs.map((t) => ({
      ...t,
      ...(t.sections && {
        sections: t.sections.map((s) => ({
          ...s,
          items: s.items.filter((i) => i.kind !== "field" || known.has(i.field)),
        })),
      }),
    }));
  } else {
    // 早期布局或没有布局：一个「基本信息」页签，字段分组在前，然后是关联、附件、角色，再是系统页签
    const sections: LayoutSection[] = [];
    const seen = new Set<string>();
    for (const g of layout?.groups ?? []) {
      const keys = g.fields.filter((k) => known.has(k) && !hidden.has(k) && !seen.has(k));
      for (const k of keys) seen.add(k);
      if (keys.length > 0)
        sections.push({ name: g.name, items: keys.map(fieldItem), ...(g.collapsed && { collapsed: true }) });
    }
    const rest = fields.filter((f) => !seen.has(f.key) && !hidden.has(f.key)).map((f) => f.key);
    if (rest.length > 0)
      sections.push({
        name: layout?.groups?.length ? OTHER_LAYOUT_GROUP : DEFAULT_LAYOUT_GROUP,
        items: rest.map(fieldItem),
      });
    sections.push(
      { name: "角色", items: [{ kind: "roles" }] },
      { name: "关联工作项", items: [{ kind: "relations" }] },
      { name: "附件", items: [{ kind: "attachments" }] },
    );
    tabs = [{ key: "basic", name: BASIC_TAB, sections }, ...systemTabs()];
    return { tabs, create: createItems(tabs, layout), labelPosition: layout?.labelPosition ?? "side" };
  }
  // 新布局：没放的字段补进第一个自定义页签的「其他字段」
  const placed = placedFields(tabs);
  const rest = fields.filter((f) => !placed.has(f.key) && !hidden.has(f.key)).map((f) => f.key);
  const first = tabs.find((t) => !t.system);
  if (rest.length > 0) {
    const other: LayoutSection = { name: OTHER_LAYOUT_GROUP, items: rest.map(fieldItem) };
    if (first) first.sections = [...(first.sections ?? []), other];
    else tabs = [{ key: "basic", name: BASIC_TAB, sections: [other] }, ...tabs];
  }
  return { tabs, create: createItems(tabs, layout), labelPosition: layout?.labelPosition ?? "side" };
}

/** 新建页的内容：单独布局时按配置；和详情页同步时按详情页里字段和提示文字的顺序（每个字段只出现一次）。 */
function createItems(tabs: readonly LayoutTab[], layout: DetailLayout | null | undefined): LayoutItem[] {
  if (layout?.create?.mode === "custom") return layout.create.items;
  const seen = new Set<string>();
  const items: LayoutItem[] = [];
  for (const tab of tabs)
    for (const section of tab.sections ?? [])
      for (const item of section.items) {
        if (item.kind === "text") items.push(item);
        if (item.kind !== "field" || item.createHidden || seen.has(item.field)) continue;
        seen.add(item.field);
        items.push(item);
      }
  return items;
}

/** 详情页按分组排好的字段（早期接口：只看字段，所有自定义页签的分组依次排下来，同一字段只取第一次）。 */
export interface LayoutGroup<F> {
  name: string;
  fields: F[];
  collapsed: boolean;
}

export function layoutFields<F extends { key: string }>(
  fields: readonly F[],
  layout: DetailLayout | null | undefined,
): LayoutGroup<F>[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const seen = new Set<string>();
  const groups: LayoutGroup<F>[] = [];
  for (const tab of resolveLayout(fields, layout).tabs)
    for (const section of tab.sections ?? []) {
      const members: F[] = [];
      for (const item of section.items) {
        if (item.kind !== "field" || seen.has(item.field)) continue;
        const field = byKey.get(item.field);
        if (!field) continue;
        seen.add(item.field);
        members.push(field);
      }
      if (members.length > 0) groups.push({ name: section.name, fields: members, collapsed: !!section.collapsed });
    }
  return groups;
}

/** 新建表单上显示的字段，按显示顺序。 */
export function visibleLayoutFields<F extends { key: string }>(
  fields: readonly F[],
  layout: DetailLayout | null | undefined,
): F[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return resolveLayout(fields, layout).create.flatMap((item) => {
    const field = item.kind === "field" ? byKey.get(item.field) : undefined;
    return field ? [field] : [];
  });
}

/** 检查布局。返回错误原因，没问题时返回 null。 */
export function checkLayout(
  layout: DetailLayout,
  fieldKeys: readonly string[],
  relationDefIds: readonly string[] = [],
): string | null {
  const known = new Set(fieldKeys);
  const field = (key: string) => (known.has(key) ? null : `字段「${key}」不存在。`);
  const checkCondition = (c: Condition | undefined, where: string) => {
    for (const key of c ? conditionFields(c) : [])
      if (!known.has(key)) return `${where}的条件用到的字段「${key}」不存在。`;
    return null;
  };
  const checkItems = (items: readonly LayoutItem[]) => {
    for (const item of items) {
      if (item.kind === "field") {
        const error = field(item.field) ?? checkCondition(item.showWhen, `字段「${item.field}」`);
        if (error) return error;
      }
      if (item.kind === "text" && !item.text.trim()) return "提示文字不能为空。";
      if (item.kind === "relation" && !relationDefIds.includes(item.relationDefId))
        return "关联工作项控件引用的关联不存在。";
      if (item.kind === "relationTable") {
        if (!relationDefIds.includes(item.relationDefId)) return "关联工作项视图引用的关联不存在。";
        if (item.columns.length === 0) return "关联工作项视图至少要有一列。";
      }
      if (item.kind === "relatedField") {
        if (!relationDefIds.includes(item.relationDefId)) return "关联信息控件引用的关联不存在。";
        if (!item.field.trim()) return "关联信息控件要选一个字段。";
      }
    }
    return null;
  };

  // 早期布局：分组不重名，每个字段只出现一次
  const names = new Set<string>();
  const seen = new Set<string>();
  for (const group of layout.groups ?? []) {
    const name = group.name.trim();
    if (!name) return "分组名称不能为空。";
    if (names.has(name)) return `分组「${name}」重名了。`;
    names.add(name);
    for (const key of group.fields) {
      const error = field(key);
      if (error) return error;
      if (seen.has(key)) return `字段「${key}」在布局里出现了不止一次。`;
      seen.add(key);
    }
  }
  for (const key of layout.hidden ?? []) {
    const error = field(key);
    if (error) return error;
    if (seen.has(key)) return `字段「${key}」在布局里出现了不止一次。`;
  }

  const tabKeys = new Set<string>();
  const tabNames = new Set<string>();
  for (const tab of layout.tabs ?? []) {
    if (!tab.name.trim()) return "页签名称不能为空。";
    if (tabKeys.has(tab.key) || tabNames.has(tab.name.trim())) return `页签「${tab.name}」重复了。`;
    tabKeys.add(tab.key);
    tabNames.add(tab.name.trim());
    const error = checkCondition(tab.showWhen, `页签「${tab.name}」`);
    if (error) return error;
    for (const section of tab.sections ?? []) {
      if (!section.name.trim()) return "分组名称不能为空。";
      const itemError = checkItems(section.items);
      if (itemError) return itemError;
    }
  }
  if (layout.tabs && !layout.tabs.some((t) => !t.system)) return "至少要有一个自定义页签。";
  if (layout.create?.mode === "custom") return checkItems(layout.create.items);
  return null;
}
