import { type Database, schema } from "@fp/db";
import { dayInTimeZone, dayToIso, dayToTimestamp, nodeFlowOf } from "@fp/engine";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";

/** 趋势图看最近几周。 */
const WEEKS = 8;
/** 延期列表最多列多少条。 */
const OVERDUE_LIMIT = 50;

export interface Dashboard {
  /** 空间时区里的今天（YYYY-MM-DD）。 */
  today: string;
  totals: {
    inProgress: number;
    completed: number;
    createdLast7Days: number;
    completedLast7Days: number;
    overdue: number;
  };
  /** 进行中的工作项按阶段（状态流按状态名）分布，多的在前。 */
  byStage: { stage: string; count: number }[];
  /** 进行中的工作项按类型分布。 */
  byType: { typeId: string; name: string; count: number }[];
  /** 最近几周每周新建、完成的工作项数，周一开始。 */
  weekly: { weekStart: string; created: number; completed: number }[];
  /** 进行中、计划结束日期已过的节点，拖得最久的在前。 */
  overdue: {
    workItemId: string;
    workItemName: string;
    nodeKey: string;
    nodeName: string;
    owners: { userId: string; name: string }[];
    plannedEnd: string;
    daysOverdue: number;
  }[];
  /** 每个人负责的进行中节点数，其中延期的有几个。 */
  load: { userId: string; name: string; nodes: number; overdue: number }[];
}

/** Day（1970-01-01 起的天数）是星期几，周一为 0。1970-01-01 是星期四。 */
const weekday = (day: number) => (((day + 3) % 7) + 7) % 7;

/**
 * 空间仪表盘的统计数据。在服务端用 SQL 汇总，前端不需要同步整个空间的工作项。
 * 空间成员都能看（成员能看到空间里所有工作项，统计里不含字段值）。
 */
export async function spaceDashboard(database: Database, spaceId: string, typeId?: string): Promise<Dashboard> {
  const { db } = database;
  const [space] = await db
    .select({ timezone: schema.space.timezone })
    .from(schema.space)
    .where(eq(schema.space.id, spaceId));
  const tz = space?.timezone ?? "Asia/Shanghai";
  const today = dayInTimeZone(Date.now(), tz);
  const firstWeek = today - weekday(today) - (WEEKS - 1) * 7;
  const item = schema.workItem;
  const inSpace = and(eq(item.spaceId, spaceId), isNull(item.deletedAt), typeId ? eq(item.typeId, typeId) : undefined);
  /** 时间点在空间时区里是哪一天（Day）。 */
  const localDay = (column: unknown) => sql<number>`((${column} at time zone ${tz})::date - date '1970-01-01')::int`;

  const statusRows = await db
    .select({ status: item.status, count: sql<number>`count(*)::int` })
    .from(item)
    .where(inSpace)
    .groupBy(item.status);
  const count = (status: string) => statusRows.find((r) => r.status === status)?.count ?? 0;

  const byStage = await db
    .select({ stage: sql<string>`coalesce(${item.stage}, '未设置')`, count: sql<number>`count(*)::int` })
    .from(item)
    .where(and(inSpace, eq(item.status, "inProgress")))
    .groupBy(sql`1`)
    .orderBy(sql`2 desc`, sql`1`);

  const byType = await db
    .select({ typeId: item.typeId, name: schema.workItemType.name, count: sql<number>`count(*)::int` })
    .from(item)
    .innerJoin(schema.workItemType, eq(schema.workItemType.id, item.typeId))
    .where(and(inSpace, eq(item.status, "inProgress")))
    .groupBy(item.typeId, schema.workItemType.name, schema.workItemType.sort)
    .orderBy(schema.workItemType.sort);

  const since = new Date(dayToTimestamp(firstWeek - 1));
  const createdDays = await db
    .select({ day: localDay(item.createdAt), count: sql<number>`count(*)::int` })
    .from(item)
    .where(and(inSpace, gte(item.createdAt, since)))
    .groupBy(sql`1`);
  // 完成时间取 workItemCompleted 事件；同一个工作项一天里反复完成只算一次
  const event = schema.eventLog;
  const completedDays = await db
    .select({ day: localDay(event.at), count: sql<number>`count(distinct ${event.workItemId})::int` })
    .from(event)
    .innerJoin(item, eq(item.id, event.workItemId))
    .where(and(inSpace, eq(event.kind, "workItemCompleted"), gte(event.at, since)))
    .groupBy(sql`1`);
  const weekly = Array.from({ length: WEEKS }, (_, i) => ({
    weekStart: dayToIso(firstWeek + i * 7),
    created: 0,
    completed: 0,
  }));
  const bucket = (day: number) => weekly[Math.floor((day - firstWeek) / 7)];
  for (const r of createdDays) {
    const w = bucket(r.day);
    if (w) w.created += r.count;
  }
  for (const r of completedDays) {
    const w = bucket(r.day);
    if (w) w.completed += r.count;
  }
  const sumSince = (rows: { day: number; count: number }[]) =>
    rows.filter((r) => r.day > today - 7).reduce((a, r) => a + r.count, 0);

  // 进行中的节点；计划结束日期按“天”存（UTC 零点），早于今天的就是延期
  const node = schema.nodeInstance;
  const activeNodes = await db
    .select({
      workItemId: item.id,
      workItemName: item.name,
      nodeKey: node.nodeKey,
      owners: node.owners,
      plannedEnd: node.plannedEnd,
      definition: schema.flowVersion.definition,
    })
    .from(node)
    .innerJoin(item, eq(item.id, node.workItemId))
    .leftJoin(schema.flowVersion, eq(schema.flowVersion.id, item.flowVersionId))
    .where(and(inSpace, eq(item.status, "inProgress"), eq(node.state, "inProgress")));
  const todayStart = dayToTimestamp(today);
  const late = activeNodes
    .filter((n) => n.plannedEnd !== null && n.plannedEnd.getTime() < todayStart)
    .sort((a, b) => (a.plannedEnd?.getTime() ?? 0) - (b.plannedEnd?.getTime() ?? 0));

  const userIds = [...new Set(activeNodes.flatMap((n) => n.owners))];
  const users =
    userIds.length > 0
      ? await db
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.user)
          .where(inArray(schema.user.id, userIds))
      : [];
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? id;

  const load = new Map<string, { nodes: number; overdue: number }>();
  for (const n of activeNodes)
    for (const userId of n.owners) {
      const entry = load.get(userId) ?? { nodes: 0, overdue: 0 };
      entry.nodes++;
      if (late.includes(n)) entry.overdue++;
      load.set(userId, entry);
    }

  return {
    today: dayToIso(today),
    totals: {
      inProgress: count("inProgress"),
      completed: count("completed"),
      createdLast7Days: sumSince(createdDays),
      completedLast7Days: sumSince(completedDays),
      overdue: new Set(late.map((n) => n.workItemId)).size,
    },
    byStage,
    byType: byType.map(({ typeId, name, count }) => ({ typeId, name, count })),
    weekly,
    overdue: late.slice(0, OVERDUE_LIMIT).map((n) => {
      const end = Math.floor((n.plannedEnd?.getTime() ?? 0) / 86_400_000);
      return {
        workItemId: n.workItemId,
        workItemName: n.workItemName,
        nodeKey: n.nodeKey,
        nodeName: nodeFlowOf(n.definition)?.nodes.find((x) => x.key === n.nodeKey)?.name ?? n.nodeKey,
        owners: n.owners.map((userId) => ({ userId, name: nameOf(userId) })),
        plannedEnd: dayToIso(end),
        daysOverdue: today - end,
      };
    }),
    load: [...load]
      .map(([userId, v]) => ({ userId, name: nameOf(userId), ...v }))
      .sort((a, b) => b.nodes - a.nodes || b.overdue - a.overdue),
  };
}

export function dashboardRoutes(database: Database, userID: (headers: Headers) => Promise<string | null>) {
  return new Hono().get("/api/spaces/:spaceId/dashboard", async (c) => {
    const me = await userID(c.req.raw.headers);
    if (!me) return c.json({ error: "未登录。" }, 401);
    const spaceId = c.req.param("spaceId");
    const [member] = await database.db
      .select()
      .from(schema.spaceMember)
      .where(and(eq(schema.spaceMember.spaceId, spaceId), eq(schema.spaceMember.userId, me)));
    if (!member) return c.json({ error: "空间不存在或没有权限。" }, 404);
    return c.json(await spaceDashboard(database, spaceId, c.req.query("type") || undefined));
  });
}
