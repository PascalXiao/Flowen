import { randomUUID } from "node:crypto";
import { type Database, schema } from "@fp/db";
import { applySpaceSnapshot, type SpaceSnapshot, snapshotSpace, summarizeSnapshot, writeAudit } from "@fp/server";
import { AUDIT_ACTIONS, AUDIT_RETENTION_DAYS, type AuditEntry } from "@fp/sync";
import { and, desc, eq, gte, ilike, inArray, lt, lte, or, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

/*
 * 空间级的管理接口：存为模板、从模板新建空间、复制空间、审计日志。
 * 都要在服务端读写整个空间，所以不走 Zero；新建出来的数据由 Zero 的复制同步给浏览器。
 */

type UserID = (headers: Headers) => Promise<string | null>;

/** 请求方的 IP：部署在 Caddy 后面时取 X-Forwarded-For 的第一个。 */
export const clientIp = (headers: Headers) =>
  headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;

const includes = z.object({ views: z.boolean(), charts: z.boolean(), items: z.boolean() });
const createTemplateBody = z.object({
  spaceId: z.string(),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).nullable().optional(),
  scope: z.enum(["personal", "org"]).default("personal"),
  includes,
});
const fromTemplateBody = z.object({
  templateId: z.string(),
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(60),
});
const copyBody = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(60),
  views: z.boolean().default(true),
  charts: z.boolean().default(true),
  members: z.boolean().default(false),
});

export function spaceAdminRoutes(database: Database, userID: UserID) {
  const { db } = database;

  const isOrgAdmin = async (userId: string) =>
    (await db.$count(schema.orgAdmin, eq(schema.orgAdmin.userId, userId))) > 0;
  const spaceRole = async (spaceId: string, userId: string) => {
    const [member] = await db
      .select({ role: schema.spaceMember.role })
      .from(schema.spaceMember)
      .where(and(eq(schema.spaceMember.spaceId, spaceId), eq(schema.spaceMember.userId, userId)));
    return member?.role;
  };
  const body = async <T extends z.ZodType>(req: Request, type: T) => {
    const parsed = type.safeParse(await req.json().catch(() => null));
    return parsed.success
      ? { data: parsed.data as z.output<T> }
      : { error: parsed.error.issues[0]?.message ?? "参数错误。" };
  };

  return (
    new Hono()
      // 存为模板：空间管理员可以；企业模板要企业管理员
      .post("/api/space-templates", async (c) => {
        const me = await userID(c.req.raw.headers);
        if (!me) return c.json({ error: "未登录。" }, 401);
        const parsed = await body(c.req.raw, createTemplateBody);
        if (!parsed.data) return c.json({ error: parsed.error }, 400);
        const args = parsed.data;
        if ((await spaceRole(args.spaceId, me)) !== "admin")
          return c.json({ error: "只有空间管理员可以把空间存为模板。" }, 403);
        if (args.scope === "org" && !(await isOrgAdmin(me)))
          return c.json({ error: "只有企业管理员可以发布企业模板。" }, 403);
        const id = randomUUID();
        const summary = await db.transaction(async (tx) => {
          const snapshot = await snapshotSpace(tx, args.spaceId, args.includes);
          const summary = summarizeSnapshot(snapshot);
          await tx.insert(schema.spaceTemplate).values({
            id,
            name: args.name,
            description: args.description ?? null,
            scope: args.scope,
            sourceSpaceId: args.spaceId,
            includes: args.includes,
            summary,
            createdBy: me,
          });
          await tx.insert(schema.spaceTemplateData).values({ templateId: id, snapshot: snapshot as never });
          await writeAudit(tx, {
            actor: me,
            action: "spaceTemplate.create",
            spaceId: args.spaceId,
            targetId: id,
            targetName: args.name,
            detail: { scope: args.scope, includes: args.includes },
            ip: clientIp(c.req.raw.headers),
          });
          return summary;
        });
        return c.json({ id, summary }, 201);
      })
      // 从模板新建空间：企业模板谁都能用，个人模板只有创建人能用
      .post("/api/spaces/from-template", async (c) => {
        const me = await userID(c.req.raw.headers);
        if (!me) return c.json({ error: "未登录。" }, 401);
        const parsed = await body(c.req.raw, fromTemplateBody);
        if (!parsed.data) return c.json({ error: parsed.error }, 400);
        const args = parsed.data;
        const [template] = await db
          .select({
            name: schema.spaceTemplate.name,
            scope: schema.spaceTemplate.scope,
            createdBy: schema.spaceTemplate.createdBy,
            snapshot: schema.spaceTemplateData.snapshot,
          })
          .from(schema.spaceTemplate)
          .innerJoin(schema.spaceTemplateData, eq(schema.spaceTemplateData.templateId, schema.spaceTemplate.id))
          .where(eq(schema.spaceTemplate.id, args.templateId));
        if (!template || (template.scope !== "org" && template.createdBy !== me))
          return c.json({ error: "模板不存在或没有权限。" }, 404);
        const spaceId = args.id ?? randomUUID();
        await db.transaction(async (tx) => {
          await applySpaceSnapshot(tx, template.snapshot as unknown as SpaceSnapshot, {
            spaceId,
            name: args.name,
            actor: me,
          });
          await writeAudit(tx, {
            actor: me,
            action: "space.createFromTemplate",
            spaceId,
            targetId: spaceId,
            targetName: args.name,
            detail: { templateId: args.templateId, templateName: template.name },
            ip: clientIp(c.req.raw.headers),
          });
        });
        return c.json({ id: spaceId }, 201);
      })
      // 复制空间：只复制配置（可选带上公共视图、图表和成员），空间管理员可以
      .post("/api/spaces/:spaceId/copy", async (c) => {
        const me = await userID(c.req.raw.headers);
        if (!me) return c.json({ error: "未登录。" }, 401);
        const source = c.req.param("spaceId");
        if ((await spaceRole(source, me)) !== "admin") return c.json({ error: "只有空间管理员可以复制空间。" }, 403);
        const parsed = await body(c.req.raw, copyBody);
        if (!parsed.data) return c.json({ error: parsed.error }, 400);
        const args = parsed.data;
        const spaceId = args.id ?? randomUUID();
        await db.transaction(async (tx) => {
          const snapshot = await snapshotSpace(tx, source, {
            views: args.views,
            charts: args.charts,
            items: false,
            members: args.members,
          });
          await applySpaceSnapshot(tx, snapshot, { spaceId, name: args.name, actor: me });
          await writeAudit(tx, {
            actor: me,
            action: "space.copy",
            spaceId,
            targetId: spaceId,
            targetName: args.name,
            detail: {
              from: source,
              fromName: snapshot.space.name,
              views: args.views,
              charts: args.charts,
              members: args.members,
            },
            ip: clientIp(c.req.raw.headers),
          });
        });
        return c.json({ id: spaceId }, 201);
      })
      // 审计日志：企业管理员看全部；空间管理员带 spaceId 看自己空间的；团队管理员带 teamId 看团队的
      .get("/api/audit", async (c) => {
        const me = await userID(c.req.raw.headers);
        if (!me) return c.json({ error: "未登录。" }, 401);
        const q = c.req.query();
        const orgAdmin = await isOrgAdmin(me);
        // 团队的操作记录：团队管理员也能看
        const teamAdmin = async (teamId: string) => {
          const [team] = await db
            .select({ admins: schema.team.admins })
            .from(schema.team)
            .where(eq(schema.team.id, teamId));
          return !!team?.admins.includes(me);
        };
        if (
          !orgAdmin &&
          !(q.spaceId && (await spaceRole(q.spaceId, me)) === "admin") &&
          !(q.teamId && (await teamAdmin(q.teamId)))
        )
          return c.json({ error: "只有企业管理员和空间管理员可以查看审计日志。" }, 403);
        const log = schema.auditLog;
        const where: (SQL | undefined)[] = [
          gte(log.at, sql`now() - make_interval(days => ${AUDIT_RETENTION_DAYS})`),
          q.spaceId ? eq(log.spaceId, q.spaceId) : undefined,
          q.teamId ? and(eq(log.category, "team"), eq(log.targetId, q.teamId)) : undefined,
          q.actor ? eq(log.actor, q.actor) : undefined,
          q.category ? eq(log.category, q.category) : undefined,
          q.action ? eq(log.action, q.action) : undefined,
          q.from ? gte(log.at, new Date(q.from)) : undefined,
          q.to ? lte(log.at, new Date(q.to)) : undefined,
          q.before ? lt(log.id, Number(q.before)) : undefined,
          q.q
            ? or(
                ilike(log.targetName, `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`),
                inArray(
                  log.action,
                  Object.entries(AUDIT_ACTIONS)
                    .filter(([, [, label]]) => label.includes(q.q as string))
                    .map(([action]) => action)
                    .concat("-"),
                ),
              )
            : undefined,
        ];
        const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
        const rows = await db
          .select({
            id: log.id,
            at: log.at,
            actor: log.actor,
            actorName: schema.user.name,
            spaceId: log.spaceId,
            spaceName: schema.space.name,
            category: log.category,
            action: log.action,
            targetId: log.targetId,
            targetName: log.targetName,
            detail: log.detail,
            ip: log.ip,
          })
          .from(log)
          .leftJoin(schema.user, eq(schema.user.id, log.actor))
          .leftJoin(schema.space, eq(schema.space.id, log.spaceId))
          .where(and(...where))
          .orderBy(desc(log.id))
          .limit(limit + 1);
        const entries: AuditEntry[] = rows
          .slice(0, limit)
          .map((r) => ({ ...r, at: r.at.toISOString(), detail: r.detail ?? null }));
        return c.json({ entries, next: rows.length > limit ? entries.at(-1)?.id : null });
      })
  );
}
