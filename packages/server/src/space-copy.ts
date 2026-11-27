import { randomUUID } from "node:crypto";
import { schema, type Tx } from "@fp/db";
import type { SpaceTemplateIncludes, SpaceTemplateSummary } from "@fp/db/schema";
import { and, asc, eq, getTableColumns, inArray, isNull } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

/*
 * 空间快照：存为模板、从模板新建空间、复制空间都靠它。
 * 快照是空间里各张配置表（和可选的视图、图表、工作项）的原始行，id 还是原来的；
 * 应用到新空间时给每一行换新 id，行里所有引用（包括 JSON 里的）跟着换，再插入。
 *
 * 不复制的：跨空间的关联和层级、别的空间的类型触发的自动化（飞书也是「跨空间配置不复制」）、
 * Webhook（地址和密钥是对外的）、个人视图、评论附件和操作记录。
 * 人员：新空间里不是成员的人从配置里去掉（角色默认成员、业务线管理员、通知对象……），
 * 创建人一类的列换成执行复制的人。
 */

/** 模板里最多带多少条工作项。 */
export const MAX_TEMPLATE_ITEMS = 500;

/** 按插入顺序排列的表（先被引用的在前）。 */
const TABLES = {
  businessLine: schema.businessLine,
  userGroup: schema.userGroup,
  workItemType: schema.workItemType,
  fieldDef: schema.fieldDef,
  roleDef: schema.roleDef,
  flowTemplate: schema.flowTemplate,
  flowVersion: schema.flowVersion,
  relationDef: schema.relationDef,
  hierarchy: schema.hierarchy,
  linkRule: schema.linkRule,
  automationRule: schema.automationRule,
  savedView: schema.savedView,
  metricChart: schema.metricChart,
  workItem: schema.workItem,
  fieldValue: schema.fieldValue,
  fieldValueItem: schema.fieldValueItem,
  fieldViewer: schema.fieldViewer,
  roleMember: schema.roleMember,
  nodeInstance: schema.nodeInstance,
  nodeConfirmation: schema.nodeConfirmation,
  nodeTask: schema.nodeTask,
  nodeDependency: schema.nodeDependency,
  relation: schema.relation,
  savedViewItem: schema.savedViewItem,
  spaceMember: schema.spaceMember,
  userGroupMember: schema.userGroupMember,
  typeAccess: schema.typeAccess,
} satisfies Record<string, PgTable>;
type TableKey = keyof typeof TABLES;
type Row = Record<string, unknown>;

export interface SpaceSnapshot {
  version: 1;
  /** 快照来自哪个空间（应用时用来认出 id 里嵌着的空间 id）。 */
  spaceId: string;
  space: { name: string; timezone: string; calendar: unknown };
  includes: SpaceTemplateIncludes & { members: boolean };
  tables: Partial<Record<TableKey, Row[]>>;
}

/** 选项：模板要带的内容；members 只用于复制空间（把成员、用户组成员一起带过去）。 */
export type SnapshotOptions = SpaceTemplateIncludes & { members?: boolean };

/** 给空间拍快照。 */
export async function snapshotSpace(db: Tx, spaceId: string, options: SnapshotOptions): Promise<SpaceSnapshot> {
  const [space] = await db.select().from(schema.space).where(eq(schema.space.id, spaceId));
  if (!space) throw new Error("空间不存在。");
  const t: Partial<Record<TableKey, Row[]>> = {};
  const ids = (rows: Row[] | undefined, key = "id") => (rows ?? []).map((r) => r[key] as string);
  const sel = <T extends PgTable>(table: T) => db.select().from(table as PgTable);

  t.businessLine = await sel(schema.businessLine).where(eq(schema.businessLine.spaceId, spaceId));
  t.userGroup = await sel(schema.userGroup).where(eq(schema.userGroup.spaceId, spaceId));
  t.workItemType = await sel(schema.workItemType)
    .where(eq(schema.workItemType.spaceId, spaceId))
    .orderBy(asc(schema.workItemType.sort));
  const typeIds = new Set(ids(t.workItemType));
  const inTypes = (col: PgColumn) => inArray(col, [...typeIds, "-"]);
  t.fieldDef = await sel(schema.fieldDef).where(inTypes(schema.fieldDef.typeId));
  t.roleDef = await sel(schema.roleDef).where(inTypes(schema.roleDef.typeId));
  t.flowTemplate = await sel(schema.flowTemplate).where(inTypes(schema.flowTemplate.typeId));
  t.flowVersion = await sel(schema.flowVersion).where(
    inArray(schema.flowVersion.templateId, [...ids(t.flowTemplate), "-"]),
  );
  // 只要两端都在本空间的关联
  t.relationDef = (
    await sel(schema.relationDef).where(
      and(eq(schema.relationDef.spaceId, spaceId), eq(schema.relationDef.toSpaceId, spaceId)),
    )
  ).filter((d) => typeIds.has(d.fromTypeId as string) && typeIds.has(d.toTypeId as string));
  const defIds = new Set(ids(t.relationDef));
  t.hierarchy = (await sel(schema.hierarchy).where(eq(schema.hierarchy.spaceId, spaceId))).filter((h) => {
    const layers = (h.layers ?? []) as { typeId: string; relationDefId: string | null }[];
    return (
      typeIds.has(h.rootTypeId as string) &&
      layers.every((l) => typeIds.has(l.typeId) && (l.relationDefId === null || defIds.has(l.relationDefId)))
    );
  });
  t.linkRule = (await sel(schema.linkRule).where(eq(schema.linkRule.spaceId, spaceId))).filter((r) =>
    defIds.has(r.relationDefId as string),
  );
  t.automationRule = (await sel(schema.automationRule).where(eq(schema.automationRule.spaceId, spaceId))).filter(
    (r) => {
      const typeId = (r.trigger as { typeId?: string } | null)?.typeId;
      return !typeId || typeIds.has(typeId);
    },
  );
  if (options.views)
    t.savedView = await sel(schema.savedView).where(
      and(eq(schema.savedView.spaceId, spaceId), eq(schema.savedView.visibility, "public")),
    );
  if (options.charts) t.metricChart = await sel(schema.metricChart).where(eq(schema.metricChart.spaceId, spaceId));

  if (options.items) {
    t.workItem = await sel(schema.workItem)
      .where(
        and(eq(schema.workItem.spaceId, spaceId), isNull(schema.workItem.deletedAt), inTypes(schema.workItem.typeId)),
      )
      .orderBy(asc(schema.workItem.createdAt))
      .limit(MAX_TEMPLATE_ITEMS);
    const itemIds = [...ids(t.workItem), "-"];
    const itemSet = new Set(itemIds);
    t.fieldValue = await sel(schema.fieldValue).where(inArray(schema.fieldValue.workItemId, itemIds));
    t.fieldValueItem = await sel(schema.fieldValueItem).where(inArray(schema.fieldValueItem.workItemId, itemIds));
    t.fieldViewer = await sel(schema.fieldViewer).where(inArray(schema.fieldViewer.workItemId, itemIds));
    t.roleMember = await sel(schema.roleMember).where(inArray(schema.roleMember.workItemId, itemIds));
    t.nodeInstance = await sel(schema.nodeInstance).where(inArray(schema.nodeInstance.workItemId, itemIds));
    const nodeIds = [...ids(t.nodeInstance), "-"];
    t.nodeConfirmation = await sel(schema.nodeConfirmation).where(
      inArray(schema.nodeConfirmation.nodeInstanceId, nodeIds),
    );
    t.nodeTask = await sel(schema.nodeTask).where(inArray(schema.nodeTask.workItemId, itemIds));
    t.nodeDependency = await sel(schema.nodeDependency).where(
      and(inArray(schema.nodeDependency.workItemId, itemIds), inArray(schema.nodeDependency.targetNodeId, nodeIds)),
    );
    t.relation = (await sel(schema.relation).where(inArray(schema.relation.fromId, itemIds))).filter(
      (r) => itemSet.has(r.toId as string) && (r.relationDefId === null || defIds.has(r.relationDefId as string)),
    );
    if (t.savedView?.length)
      t.savedViewItem = await sel(schema.savedViewItem).where(
        and(inArray(schema.savedViewItem.viewId, ids(t.savedView)), inArray(schema.savedViewItem.workItemId, itemIds)),
      );
  }

  if (options.members) {
    t.spaceMember = await sel(schema.spaceMember).where(eq(schema.spaceMember.spaceId, spaceId));
    t.userGroupMember = await sel(schema.userGroupMember).where(
      inArray(schema.userGroupMember.groupId, [...ids(t.userGroup), "-"]),
    );
    t.typeAccess = await sel(schema.typeAccess).where(inTypes(schema.typeAccess.typeId));
  }

  // 存成 JSON：日期变成字符串，应用时按列类型还原
  return JSON.parse(
    JSON.stringify({
      version: 1,
      spaceId,
      space: { name: space.name, timezone: space.timezone, calendar: space.calendar },
      includes: { views: options.views, charts: options.charts, items: options.items, members: !!options.members },
      tables: t,
    }),
  ) as SpaceSnapshot;
}

/** 模板卡片上的概要。 */
export function summarizeSnapshot(snapshot: SpaceSnapshot): SpaceTemplateSummary {
  const t = snapshot.tables;
  const count = (rows: Row[] | undefined, typeId: string) => (rows ?? []).filter((r) => r.typeId === typeId).length;
  return {
    types: (t.workItemType ?? []).map((type) => ({
      name: type.name as string,
      flowMode: (type.flowMode as "node" | "state") ?? "node",
      fields: count(t.fieldDef, type.id as string),
      roles: count(t.roleDef, type.id as string),
      templates: count(t.flowTemplate, type.id as string),
    })),
    views: (t.savedView ?? []).map((v) => v.name as string),
    charts: (t.metricChart ?? []).map((c) => c.name as string),
    items: t.workItem?.length ?? 0,
    automations: t.automationRule?.length ?? 0,
  };
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 给快照里的每一行换新 id，所有引用跟着换（JSON 里的也换）。
 * UUID 按表查换；id 里嵌着原空间 id 的（如示例模板的「<空间>/project」）把空间 id 换掉；其余的整串替换。
 */
function remapIds(snapshot: SpaceSnapshot, newSpaceId: string): Partial<Record<TableKey, Row[]>> {
  const map = new Map<string, string>([[snapshot.spaceId, newSpaceId]]);
  const others: string[] = [];
  for (const rows of Object.values(snapshot.tables))
    for (const row of rows ?? []) {
      const id = row.id;
      if (typeof id !== "string" || map.has(id)) continue;
      if (/^[0-9a-f-]{36}$/.test(id)) map.set(id, randomUUID());
      else if (id.includes(snapshot.spaceId)) map.set(id, id.split(snapshot.spaceId).join(newSpaceId));
      else if (id.length >= 6) {
        map.set(id, randomUUID());
        others.push(id);
      }
    }
  let text = JSON.stringify(snapshot.tables);
  if (others.length) {
    const re = new RegExp(
      others
        .sort((a, b) => b.length - a.length)
        .map(escapeRe)
        .join("|"),
      "g",
    );
    text = text.replace(re, (m) => map.get(m) ?? m);
  }
  text = text.replace(UUID, (m) => map.get(m) ?? m);
  // 嵌着原空间 id 的复合 id：空间 id 是 UUID 时上一步已经换了；不是 UUID 时在这里换
  if (!/^[0-9a-f-]{36}$/.test(snapshot.spaceId)) text = text.split(snapshot.spaceId).join(newSpaceId);
  return JSON.parse(text) as Partial<Record<TableKey, Row[]>>;
}

const DROP = Symbol("drop");

/** 去掉 JSON 里新空间不认识的人：数组里的删掉，作为键的删掉，作为值的置空。 */
function withoutUsers(value: unknown, removed: ReadonlySet<string>): unknown {
  if (typeof value === "string") return removed.has(value) ? DROP : value;
  if (Array.isArray(value)) return value.map((v) => withoutUsers(v, removed)).filter((v) => v !== DROP);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (removed.has(k)) continue;
      const next = withoutUsers(v, removed);
      out[k] = next === DROP ? null : next;
    }
    return out;
  }
  return value;
}

/** 记创建人一类的列：不在新空间里的人换成执行的人，而不是删掉整行。 */
const ACTOR_COLUMNS = new Set(["createdBy", "publishedBy"]);

/**
 * 把快照应用成一个新空间：建空间、执行人当管理员，再按顺序插入换过 id 的各表。
 * keepUsers 之外的人从数据里去掉（复制空间带成员时，成员都在 keepUsers 里）。返回新空间 id。
 */
export async function applySpaceSnapshot(
  db: Tx,
  snapshot: SpaceSnapshot,
  target: { spaceId: string; name: string; actor: string },
): Promise<string> {
  if (snapshot.version !== 1) throw new Error("模板版本不支持。");
  const tables = remapIds(snapshot, target.spaceId);
  const members = new Set([target.actor, ...(tables.spaceMember ?? []).map((m) => m.userId as string)]);
  const allUsers = await db.select({ id: schema.user.id }).from(schema.user);
  const removed = new Set(allUsers.map((u) => u.id).filter((id) => !members.has(id)));

  await db.insert(schema.space).values({
    id: target.spaceId,
    name: target.name,
    timezone: snapshot.space.timezone,
    calendar: snapshot.space.calendar as never,
  });
  await db.insert(schema.spaceMember).values({ spaceId: target.spaceId, userId: target.actor, role: "admin" });

  for (const [key, table] of Object.entries(TABLES) as [TableKey, PgTable][]) {
    const rows = tables[key];
    if (!rows?.length) continue;
    const columns = getTableColumns(table);
    const out: Row[] = [];
    for (const raw of rows) {
      if (key === "spaceMember" && raw.userId === target.actor) continue;
      const row: Row = {};
      let keep = true;
      for (const [name, column] of Object.entries(columns)) {
        if (!(name in raw)) continue;
        let value = withoutUsers(raw[name], removed);
        if (value === DROP) {
          if (ACTOR_COLUMNS.has(name)) value = target.actor;
          else if (column.notNull) {
            keep = false;
            break;
          } else value = null;
        }
        if (value !== null && column.columnType === "PgTimestamp") value = new Date(value as string);
        row[name] = value;
      }
      if (keep) out.push(row);
    }
    for (let i = 0; i < out.length; i += 500) await db.insert(table).values(out.slice(i, i + 500) as never);
  }
  return target.spaceId;
}
