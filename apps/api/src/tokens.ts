import { createHash, randomBytes, randomUUID } from "node:crypto";
import { type Database, schema } from "@fp/db";
import { writeAudit } from "@fp/server";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";

/** 一个用户最多保留的令牌数。 */
const MAX_TOKENS = 20;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** 按 `Authorization: Bearer fp_…` 找到令牌对应的用户；顺便记一下最近使用时间（一分钟内不重复写）。 */
export async function tokenUser(database: Database, headers: Headers): Promise<string | null> {
  const match = /^Bearer\s+(fp_[A-Za-z0-9_-]+)$/.exec(headers.get("authorization") ?? "");
  if (!match?.[1]) return null;
  const [row] = await database.db
    .select({ id: schema.apiToken.id, userId: schema.apiToken.userId })
    .from(schema.apiToken)
    .where(eq(schema.apiToken.tokenHash, hash(match[1])));
  if (!row) return null;
  await database.db
    .update(schema.apiToken)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(schema.apiToken.id, row.id),
        or(isNull(schema.apiToken.lastUsedAt), lt(schema.apiToken.lastUsedAt, sql`now() - interval '1 minute'`)),
      ),
    );
  return row.userId;
}

/**
 * 管理自己的开放接口令牌：列出、创建（明文只返回这一次）、删除。走登录会话，不接受令牌本身，
 * 免得一个泄露的令牌能给自己续命。
 */
export function tokenRoutes(database: Database, userID: (headers: Headers) => Promise<string | null>) {
  const mine = (userId: string) =>
    database.db
      .select({
        id: schema.apiToken.id,
        name: schema.apiToken.name,
        prefix: schema.apiToken.prefix,
        createdAt: schema.apiToken.createdAt,
        lastUsedAt: schema.apiToken.lastUsedAt,
      })
      .from(schema.apiToken)
      .where(eq(schema.apiToken.userId, userId))
      .orderBy(desc(schema.apiToken.createdAt));

  return new Hono()
    .get("/api/tokens", async (c) => {
      const me = await userID(c.req.raw.headers);
      if (!me) return c.json({ error: "未登录。" }, 401);
      return c.json(await mine(me));
    })
    .post("/api/tokens", async (c) => {
      const me = await userID(c.req.raw.headers);
      if (!me) return c.json({ error: "未登录。" }, 401);
      const body = await c.req.json<{ name?: unknown }>().catch(() => ({}) as never);
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 60) return c.json({ error: "请填写令牌名称（不超过 60 个字）。" }, 400);
      if ((await mine(me)).length >= MAX_TOKENS) return c.json({ error: `最多只能有 ${MAX_TOKENS} 个令牌。` }, 409);
      const token = `fp_${randomBytes(32).toString("base64url")}`;
      const id = randomUUID();
      await database.db
        .insert(schema.apiToken)
        .values({ id, userId: me, name, tokenHash: hash(token), prefix: token.slice(0, 10) });
      await writeAudit(database.db, { actor: me, action: "account.createToken", targetId: id, targetName: name });
      return c.json({ id, name, token }, 201);
    })
    .delete("/api/tokens/:id", async (c) => {
      const me = await userID(c.req.raw.headers);
      if (!me) return c.json({ error: "未登录。" }, 401);
      const deleted = await database.db
        .delete(schema.apiToken)
        .where(and(eq(schema.apiToken.id, c.req.param("id")), eq(schema.apiToken.userId, me)))
        .returning({ id: schema.apiToken.id, name: schema.apiToken.name });
      if (deleted.length === 0) return c.json({ error: "令牌不存在。" }, 404);
      await writeAudit(database.db, {
        actor: me,
        action: "account.deleteToken",
        targetId: deleted[0]?.id,
        targetName: deleted[0]?.name,
      });
      return c.body(null, 204);
    });
}
