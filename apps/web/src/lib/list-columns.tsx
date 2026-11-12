import {
  type FieldConfig,
  type FieldOption,
  formatFieldValue,
  formatNumber,
  nodeFlowOf,
  optionLabel,
  SIGNAL_STATE_LABEL,
  type SignalState,
} from "@fp/engine";
import type { queries } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { StageTag, StatusTag, Tag, type TagTone } from "@/components/ui/tag";

/** 列表查询返回的一行工作项。 */
export type ListItem = QueryResultType<ReturnType<typeof queries.workItems.list>>[number];

/** 字段（各类型的同键字段合在一起）。 */
export interface ListField {
  key: string;
  name: string;
  dataType: string;
  options: readonly FieldOption[] | null;
  config?: FieldConfig | null;
}

export interface ListContext {
  fields: ReadonlyMap<string, ListField>;
  userName: (id: string) => string;
  spaceName: string;
  typeName: (typeId: string) => string;
  /** 能做成列的角色和节点（各类型合在一起，按键去重）。 */
  roles?: readonly { key: string; name: string }[];
  nodes?: readonly { name: string }[];
  /** 能做成列的自定义关联（关联列和关联字段列）。 */
  relations?: readonly ListRelation[];
  /** 今天（YYYY-MM-DD），算延期用。 */
  today?: string;
}

/**
 * 一条自定义关联在本端的样子：out = 本端是关联的发起方（字段名是关联名），
 * in = 本端是被关联方（互相关联时的另一端字段名）。fields 是另一端工作项类型的字段。
 */
export interface ListRelation {
  defId: string;
  dir: "out" | "in";
  name: string;
  fields: readonly ListField[];
}

export interface ListColumn {
  key: string;
  title: string;
  width: number;
  render: (item: ListItem) => ReactNode;
  /** 排序和分组用的值。 */
  value: (item: ListItem) => string | number | null;
  /** 数字列：底部汇总可以求和、平均、最大、最小。 */
  numeric?: boolean;
  /** 复制单元格时的文本；不设时用 value。 */
  text?: (item: ListItem) => string;
  /** 字段列对应的字段：能往这一列粘贴。 */
  field?: ListField;
}

/** 单元格复制出去的文本。 */
export function cellText(col: ListColumn, item: ListItem): string {
  if (col.text) return col.text(item);
  const v = col.value(item);
  return v === null ? "" : String(v);
}

const TONES: TagTone[] = ["brand", "violet", "teal", "warning", "success", "danger"];
/** 选项的标签颜色：按选项值固定，同一个选项在各处颜色一样。 */
function toneOf(value: string): TagTone {
  let hash = 0;
  for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length] ?? "neutral";
}

const none = <span className="text-fg-disabled">—</span>;
const list = (v: unknown) => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]);

/** 人员：头像加名字，多个人时第一个后面跟 +N。 */
function People({ ids, name }: { ids: readonly string[]; name: (id: string) => string }) {
  const [first, ...rest] = ids;
  if (!first) return none;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={ids.map(name).join("、")}>
      <Avatar id={first} name={name(first)} size={20} />
      <span className="truncate">{name(first)}</span>
      {rest.length > 0 && <span className="shrink-0 text-fg-subtle">+{rest.length}</span>}
    </span>
  );
}

/** 按字段类型显示单元格。 */
export function renderFieldValue(field: ListField, value: unknown, name: (id: string) => string): ReactNode {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0))
    return none;
  const spec = {
    name: field.name,
    dataType: field.dataType as never,
    options: field.options,
    config: field.config ?? null,
  };
  switch (field.dataType) {
    case "select":
    case "radio":
    case "multiSelect":
    case "cascadeSelect":
    case "cascadeMulti":
    case "businessLine":
      return (
        <span className="inline-flex min-w-0 gap-1">
          {list(value).map((v) => (
            <Tag key={String(v)} tone={toneOf(String(v))}>
              <span className="max-w-32 truncate">{optionLabel(spec, v)}</span>
            </Tag>
          ))}
        </span>
      );
    case "user":
    case "singleUser":
      return <People ids={list(value).map(String)} name={name} />;
    case "bool":
      return value === true ? "是" : "否";
    case "number":
      return <span className="tabular-nums">{formatNumber(Number(value), field.config?.number)}</span>;
    case "link":
    case "docLink":
      return (
        <a href={String(value)} target="_blank" rel="noreferrer" className="truncate text-brand-500 hover:underline">
          {String(value)}
        </a>
      );
    case "signal":
    case "multiSignal":
      return (
        <span className="inline-flex gap-1">
          {list(value).map((s, i) => {
            const state = (s as { state?: SignalState }).state ?? "none";
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: 信号没有 id
              <Tag key={i} tone={state === "passed" ? "success" : state === "failed" ? "danger" : "neutral"}>
                {SIGNAL_STATE_LABEL[state]}
              </Tag>
            );
          })}
        </span>
      );
    default:
      return <span className="truncate">{formatFieldValue(spec, value, name)}</span>;
  }
}

function fieldValueOf(item: { fieldValues: readonly { fieldKey: string; value: unknown }[] }, key: string): unknown {
  return item.fieldValues.find((v) => v.fieldKey === key)?.value ?? null;
}

/** 进行中节点的负责人（状态流工作项没有节点，取全部角色成员）。 */
function currentOwners(item: ListItem): string[] {
  const owners = item.nodes.filter((n) => n.state === "inProgress").flatMap((n) => n.owners ?? []);
  return [...new Set(owners)];
}

function inProgressNodes(item: ListItem): string {
  const def = nodeFlowOf(item.flowVersion?.definition);
  return item.nodes
    .filter((n) => n.state === "inProgress")
    .map((n) => def?.nodes.find((d) => d.key === n.nodeKey)?.name ?? n.nodeKey)
    .join("、");
}

const time = (ms: number | null | undefined) => {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 计划日期（存的是 UTC 零点）转 YYYY-MM-DD。 */
const dayOf = (ms: number | null | undefined) => (ms == null ? null : new Date(ms).toISOString().slice(0, 10));
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const todayOf = (ctx: ListContext) => ctx.today ?? new Date().toISOString().slice(0, 10);

/** 进行中节点的排期范围。 */
function inProgressSpan(item: ListItem) {
  const nodes = item.nodes.filter((n) => n.state === "inProgress");
  const starts = nodes.flatMap((n) => (n.plannedStart == null ? [] : [dayOf(n.plannedStart) as string]));
  const ends = nodes.flatMap((n) => (n.plannedEnd == null ? [] : [dayOf(n.plannedEnd) as string]));
  return starts.length && ends.length
    ? { start: starts.sort()[0] as string, end: ends.sort()[ends.length - 1] as string }
    : null;
}
/** 进行中节点最多延期了几天（计划结束早于今天）。 */
function delayDays(item: ListItem, today: string) {
  if (item.status !== "inProgress") return 0;
  const ends = item.nodes.flatMap((n) =>
    n.state === "inProgress" && n.plannedEnd != null ? [dayOf(n.plannedEnd) as string] : [],
  );
  return Math.max(0, ...ends.map((end) => daysBetween(end, today)));
}
/** 当前（最早开始的进行中）节点已经停留了几天。 */
function stayDays(item: ListItem, today: string) {
  const starts = item.nodes.flatMap((n) =>
    n.state === "inProgress" && n.actualStart != null ? [dayOf(n.actualStart) as string] : [],
  );
  return starts.length ? daysBetween(starts.sort()[0] as string, today) : null;
}
/** 预计完成：没跳过的节点里最晚的计划结束。 */
function expectedEnd(item: ListItem) {
  const ends = item.nodes.flatMap((n) =>
    n.state !== "skipped" && n.plannedEnd != null ? [dayOf(n.plannedEnd) as string] : [],
  );
  return ends.length ? (ends.sort()[ends.length - 1] as string) : null;
}

const NODE_STATE_TEXT: Record<string, string> = {
  notStarted: "未开始",
  inProgress: "进行中",
  completed: "已完成",
  skipped: "已跳过",
};

/** 节点列：这个节点的状态和计划排期。按节点名对上（各流程里同名的节点算一列），键是 node:节点名。 */
export function nodeColumn(node: { name: string }): ListColumn {
  const of = (i: ListItem) => {
    const key = nodeFlowOf(i.flowVersion?.definition)?.nodes.find((d) => d.name === node.name)?.key;
    return key ? i.nodes.find((n) => n.nodeKey === key) : undefined;
  };
  return {
    key: `node:${node.name}`,
    title: `节点：${node.name}`,
    width: 190,
    render: (i) => {
      const n = of(i);
      if (!n) return none;
      const span =
        n.plannedStart != null && n.plannedEnd != null ? `${dayOf(n.plannedStart)} ~ ${dayOf(n.plannedEnd)}` : "";
      return (
        <span className="inline-flex items-center gap-1.5 truncate">
          <Tag tone={n.state === "inProgress" ? "brand" : n.state === "completed" ? "success" : "neutral"}>
            {NODE_STATE_TEXT[n.state ?? "notStarted"] ?? n.state}
          </Tag>
          <span className="text-fg-muted tabular-nums">{span}</span>
        </span>
      );
    },
    value: (i) => dayOf(of(i)?.plannedEnd) ?? "",
  };
}

/** 角色列：担任这个角色的人。键是 role:角色键。 */
export function roleColumn(role: { key: string; name: string }, ctx: ListContext): ListColumn {
  const ids = (i: ListItem) => i.roleMembers.filter((m) => m.roleKey === role.key).map((m) => m.userId);
  return {
    key: `role:${role.key}`,
    title: `角色：${role.name}`,
    width: 140,
    render: (i) => <People ids={ids(i)} name={ctx.userName} />,
    value: (i) => ids(i).map(ctx.userName).join("、"),
  };
}

type Linked = {
  id: string;
  name: string;
  stage: string | null;
  fieldValues: readonly { fieldKey: string; value: unknown }[];
};
/** 这条关联连着的工作项。 */
function linkedOf(item: ListItem, rel: ListRelation): Linked[] {
  const out =
    rel.dir === "out"
      ? item.outgoing.filter((r) => r.relationDefId === rel.defId).map((r) => r.to)
      : item.incoming.filter((r) => r.relationDefId === rel.defId).map((r) => r.from);
  return out.filter((w): w is NonNullable<typeof w> => !!w) as unknown as Linked[];
}
const relKey = (rel: Pick<ListRelation, "dir" | "defId">) => `${rel.dir}:${rel.defId}`;

/** 关联列：关联着的工作项名称，点开在抽屉里看。键是 rel:out|in:关联定义 id。 */
export function relationColumn(rel: ListRelation): ListColumn {
  return {
    key: `rel:${relKey(rel)}`,
    title: rel.name,
    width: 180,
    render: (i) => {
      const linked = linkedOf(i, rel);
      if (!linked.length) return none;
      return (
        <span className="inline-flex min-w-0 gap-1.5" title={linked.map((w) => w.name).join("、")}>
          {linked.map((w) => (
            <Link
              key={w.id}
              className="truncate text-brand-500 hover:underline"
              from="/spaces/$spaceId/$typeKey"
              to="."
              search={(prev) => ({ ...prev, item: w.id })}
            >
              {w.name}
            </Link>
          ))}
        </span>
      );
    },
    value: (i) =>
      linkedOf(i, rel)
        .map((w) => w.name)
        .join("、"),
  };
}

/**
 * 关联字段列：关联着的工作项的某个字段（如「关联项目 · 优先级」）。
 * 关联了多个时每个的值都列出来。键是 relf:out|in:关联定义 id:字段键；字段键 $stage 是对方的阶段。
 */
export function relatedFieldColumn(rel: ListRelation, field: ListField | "stage", ctx: ListContext): ListColumn {
  const fieldKey = field === "stage" ? "$stage" : field.key;
  const title = `${rel.name} · ${field === "stage" ? "状态" : field.name}`;
  const values = (i: ListItem) =>
    linkedOf(i, rel)
      .map((w) => (field === "stage" ? w.stage : fieldValueOf(w, fieldKey)))
      .filter((v) => !(v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)));
  const numeric = field !== "stage" && (field.dataType === "number" || field.dataType === "formula");
  return {
    key: `relf:${relKey(rel)}:${fieldKey}`,
    title,
    width: 160,
    numeric,
    render: (i) => {
      const vs = values(i);
      if (!vs.length) return none;
      return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {vs.map((v, n) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 同一个值可能出现多次
            <span key={n} className="inline-flex min-w-0">
              {field === "stage" ? <StageTag stage={String(v)} /> : renderFieldValue(field, v, ctx.userName)}
            </span>
          ))}
        </span>
      );
    },
    value: (i) => {
      const vs = values(i);
      if (!vs.length) return null;
      if (numeric) return vs.reduce<number>((sum, v) => sum + Number(v), 0);
      if (field === "stage") return vs.map(String).join("、");
      const spec = { name: field.name, dataType: field.dataType as never, options: field.options };
      return vs.map((v) => formatFieldValue(spec, v, ctx.userName)).join("、");
    },
  };
}

/** 一条关联能加的列：关联本身，加上对方的状态和每个字段（关联、公式之外的字段也能显示）。 */
export function relationColumns(rel: ListRelation, ctx: ListContext): ListColumn[] {
  return [
    relationColumn(rel),
    relatedFieldColumn(rel, "stage", ctx),
    ...rel.fields.filter((f) => f.dataType !== "relation").map((f) => relatedFieldColumn(rel, f, ctx)),
  ];
}

/** 系统列（工作项本身的属性和由流程算出的信息）。名称列另外处理，总在第一列。 */
export function systemColumns(ctx: ListContext): ListColumn[] {
  return [
    {
      key: "stage",
      title: "状态",
      width: 140,
      render: (i) => (
        <span className="inline-flex items-center gap-1">
          <StageTag stage={i.stage ?? null} />
          {i.status !== "inProgress" && <StatusTag status={i.status} />}
        </span>
      ),
      value: (i) => i.stage ?? "",
    },
    {
      key: "owners",
      title: "当前负责人",
      width: 140,
      render: (i) => <People ids={currentOwners(i)} name={ctx.userName} />,
      value: (i) => currentOwners(i).map(ctx.userName).join("、"),
    },
    {
      key: "nodes",
      title: "进行中节点",
      width: 160,
      render: (i) => <span className="truncate">{inProgressNodes(i) || none}</span>,
      value: (i) => inProgressNodes(i),
    },
    {
      key: "schedule",
      title: "进行中节点排期",
      width: 190,
      render: (i) => {
        const span = inProgressSpan(i);
        return span ? <span className="tabular-nums">{`${span.start} ~ ${span.end}`}</span> : none;
      },
      value: (i) => inProgressSpan(i)?.end ?? "",
    },
    {
      key: "delay",
      title: "延期",
      numeric: true,
      width: 100,
      render: (i) => {
        const days = delayDays(i, todayOf(ctx));
        return days > 0 ? <Tag tone="danger">延期 {days} 天</Tag> : none;
      },
      value: (i) => delayDays(i, todayOf(ctx)),
      text: (i) => String(delayDays(i, todayOf(ctx)) || ""),
    },
    {
      key: "stay",
      title: "当前节点停留",
      numeric: true,
      width: 120,
      render: (i) => {
        const days = stayDays(i, todayOf(ctx));
        return days === null ? none : <span className="tabular-nums">{days} 天</span>;
      },
      value: (i) => stayDays(i, todayOf(ctx)) ?? -1,
      text: (i) => String(stayDays(i, todayOf(ctx)) ?? ""),
    },
    {
      key: "expectedEnd",
      title: "预计完成",
      width: 120,
      render: (i) => <span className="tabular-nums">{expectedEnd(i) ?? "—"}</span>,
      value: (i) => expectedEnd(i) ?? "",
    },
    {
      key: "type",
      title: "工作项类型",
      width: 120,
      render: (i) => ctx.typeName(i.typeId),
      value: (i) => ctx.typeName(i.typeId),
    },
    {
      key: "space",
      title: "所属空间",
      width: 120,
      render: () => <span className="truncate">{ctx.spaceName}</span>,
      value: () => ctx.spaceName,
    },
    {
      key: "createdAt",
      title: "提出时间",
      width: 150,
      render: (i) => <span className="text-fg-muted tabular-nums">{time(i.createdAt)}</span>,
      value: (i) => i.createdAt ?? 0,
      text: (i) => time(i.createdAt),
    },
    {
      key: "updatedAt",
      title: "更新时间",
      width: 150,
      render: (i) => <span className="text-fg-muted tabular-nums">{time(i.updatedAt)}</span>,
      value: (i) => i.updatedAt ?? 0,
      text: (i) => time(i.updatedAt),
    },
    {
      key: "creator",
      title: "创建者",
      width: 120,
      render: (i) => <People ids={[i.createdBy]} name={ctx.userName} />,
      value: (i) => ctx.userName(i.createdBy),
    },
  ];
}

type RelationDefLike = {
  id: string;
  fromTypeId: string;
  toTypeId: string;
  name: string;
  reverseName: string | null;
};
type SourceType = {
  id?: string;
  roles: readonly { key: string; name: string }[];
  flowTemplates: readonly { currentVersion?: { definition: unknown } | null | undefined }[];
};

/**
 * 角色列、节点列、关联列的来源：这些类型的角色、流程当前版本里的节点（按名称去重），
 * 以及从这些类型出发的关联、指向这些类型并在这一端有字段名的互相关联。
 * space 是空间里所有类型（带字段和关联定义），用来找关联另一端的字段。
 */
export function columnSources(
  types: readonly SourceType[],
  space: readonly { id: string; fields: readonly ListField[]; relationDefs: readonly RelationDefLike[] }[] = [],
) {
  const roles = new Map<string, string>();
  const nodes = new Set<string>();
  for (const t of types) {
    for (const r of t.roles) if (!roles.has(r.key)) roles.set(r.key, r.name);
    for (const f of t.flowTemplates)
      for (const n of nodeFlowOf(f.currentVersion?.definition)?.nodes ?? []) nodes.add(n.name);
  }
  const ids = new Set(types.flatMap((t) => (t.id ? [t.id] : [])));
  const fieldsOf = (typeId: string) => space.find((t) => t.id === typeId)?.fields ?? [];
  const relations: ListRelation[] = [];
  for (const d of space.flatMap((t) => t.relationDefs)) {
    if (ids.has(d.fromTypeId)) relations.push({ defId: d.id, dir: "out", name: d.name, fields: fieldsOf(d.toTypeId) });
    if (ids.has(d.toTypeId) && d.reverseName)
      relations.push({ defId: d.id, dir: "in", name: d.reverseName, fields: fieldsOf(d.fromTypeId) });
  }
  return {
    roles: [...roles].map(([key, name]) => ({ key, name })),
    nodes: [...nodes].map((name) => ({ name })),
    relations,
  };
}

/** 全部可选的列：系统列、字段列、角色列、节点列、关联列和关联字段列。 */
export function allColumns(ctx: ListContext): ListColumn[] {
  return [
    ...systemColumns(ctx),
    ...[...ctx.fields.values()].map((f) => fieldColumn(f, ctx)),
    ...(ctx.roles ?? []).map((r) => roleColumn(r, ctx)),
    ...(ctx.nodes ?? []).map((n) => nodeColumn(n)),
    ...(ctx.relations ?? []).flatMap((r) => relationColumns(r, ctx)),
  ];
}

/** 字段列：键是 field:字段键。 */
export function fieldColumn(field: ListField, ctx: ListContext): ListColumn {
  const wide = ["richText", "textarea", "multiSelect", "cascadeMulti", "user"].includes(field.dataType);
  return {
    key: `field:${field.key}`,
    title: field.name,
    width: wide ? 180 : 130,
    numeric: field.dataType === "number" || field.dataType === "formula",
    field,
    render: (i) => renderFieldValue(field, fieldValueOf(i, field.key), ctx.userName),
    text: (i) => {
      const v = fieldValueOf(i, field.key);
      const spec = {
        name: field.name,
        dataType: field.dataType as never,
        options: field.options,
        config: field.config ?? null,
      };
      return v === null ? "" : formatFieldValue(spec, v, ctx.userName);
    },
    value: (i) => {
      const v = fieldValueOf(i, field.key);
      if (typeof v === "number") return v;
      const spec = { name: field.name, dataType: field.dataType as never, options: field.options };
      return v === null ? null : formatFieldValue(spec, v, ctx.userName);
    },
  };
}

/** 没保存过列设置时默认显示的列。 */
export function defaultColumnKeys(fields: ReadonlyMap<string, ListField>): string[] {
  const line = [...fields.values()].find((f) => f.dataType === "businessLine");
  const priority = [...fields.values()].find((f) => f.name.includes("优先级"));
  return [
    "stage",
    "owners",
    ...(priority ? [`field:${priority.key}`] : []),
    ...(line ? [`field:${line.key}`] : []),
    "type",
    "space",
    "createdAt",
    "creator",
  ];
}

/** 列表查询要带的数据（字段值、节点、关联），由用到的列键和条件里的字段算出来。 */
export interface ListNeeds {
  fields: string[];
  nodes: "none" | "active" | "all";
  relations: boolean;
  relatedFields: string[];
  roles: string[];
}

/** 进行中节点就够的系统列；节点列和预计完成要全部节点。 */
const ACTIVE_NODE_COLUMNS = new Set(["owners", "nodes", "schedule", "delay", "stay"]);

export function listNeeds(columnKeys: readonly string[], conditionFieldKeys: readonly string[] = []): ListNeeds {
  const fields = new Set(conditionFieldKeys.filter((k) => !k.startsWith("$")));
  const relatedFields = new Set<string>();
  const roles = new Set<string>();
  let nodes: ListNeeds["nodes"] = "none";
  let relations = false;
  for (const key of columnKeys) {
    if (key.startsWith("field:")) fields.add(key.slice("field:".length));
    else if (key.startsWith("role:")) roles.add(key.slice("role:".length));
    else if (key.startsWith("node:") || key === "expectedEnd") nodes = "all";
    else if (ACTIVE_NODE_COLUMNS.has(key)) nodes = nodes === "all" ? "all" : "active";
    else if (key.startsWith("rel:")) relations = true;
    else if (key.startsWith("relf:")) {
      relations = true;
      // relf:out|in:关联定义 id:字段键
      const fieldKey = key.split(":").slice(3).join(":");
      if (fieldKey && !fieldKey.startsWith("$")) relatedFields.add(fieldKey);
    }
  }
  return {
    fields: [...fields].sort(),
    nodes,
    relations,
    relatedFields: [...relatedFields].sort(),
    roles: [...roles].sort(),
  };
}
