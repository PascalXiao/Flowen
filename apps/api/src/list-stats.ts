import { type Database, schema } from "@fp/db";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

export interface ListStats {
  total: number;
  completed: number;
  /** 自己担任了角色的工作项数。 */
  involved: number;
}

/**
 * 列表上方的统计（总数、已完成、我参与的），在服务端用 SQL 数，前端不用为了几个数字同步整个空间。
 * 按和 Zero 查询一样的可见范围（packages/sync 的 itemVisible）数：管理员看全部，
 * 其他人看查看范围是全部的类型，以及查看范围是参与的类型里自己创建、担任角色或关注的工作项。
 */
export async function listStats(
  database: Database,
  spaceId: string,
  userId: string,
  typeIds: readonly string[],
): Promise<ListStats | null> {
  const { db } = database;
  const [member] = await db
    .select({ role: schema.spaceMember.role })
    .from(schema.spaceMember)
    .where(and(eq(schema.spaceMember.spaceId, spaceId), eq(schema.spaceMember.userId, userId)));
  if (!member) return null;
  const admin = member.role === "admin";
  const mine = sql`exists (select 1 from role_member r where r.work_item_id = w.id and r.user_id = ${userId})`;
  const access = (level: string) =>
    sql`exists (select 1 from type_access a where a.type_id = t.id and a.user_id = ${userId} and a.level = ${level})`;
  const visible = admin
    ? sql`true`
    : sql`(t.view_base = 'all' or ${access("all")} or (
        (t.view_base = 'involved' or ${access("involved")}) and (
          w.created_by = ${userId} or ${mine}
          or exists (select 1 from work_item_mark m where m.work_item_id = w.id and m.user_id = ${userId} and m.kind = 'follow')
        )
      ))`;
  const types = typeIds.length
    ? sql`and w.type_id in (${sql.join(
        typeIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;
  const [row] = await db.execute<{ total: number; completed: number; involved: number }>(sql`
    select count(*)::int as total,
      (count(*) filter (where w.status = 'completed'))::int as completed,
      (count(*) filter (where ${mine}))::int as involved
    from work_item w join work_item_type t on t.id = w.type_id
    where w.space_id = ${spaceId} and w.deleted_at is null ${types} and ${visible}`);
  return row ?? { total: 0, completed: 0, involved: 0 };
}

export function listStatsRoutes(database: Database, userID: (headers: Headers) => Promise<string | null>) {
  return new Hono().get("/api/spaces/:spaceId/list-stats", async (c) => {
    const me = await userID(c.req.raw.headers);
    if (!me) return c.json({ error: "未登录。" }, 401);
    const typeIds = c.req.queries("type") ?? [];
    if (typeIds.length > 200) return c.json({ error: "类型太多。" }, 400);
    const stats = await listStats(database, c.req.param("spaceId"), me, typeIds);
    if (!stats) return c.json({ error: "空间不存在或没有权限。" }, 404);
    return c.json(stats);
  });
}
