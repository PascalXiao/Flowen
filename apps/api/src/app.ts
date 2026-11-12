import { connect, type Database, schema } from "@fp/db";
import { type FlowDefinition, validateFlow } from "@fp/engine";
import { spaceRoles } from "@fp/sync";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { attachmentRoutes } from "./attachments.ts";
import { type Auth, createAuth } from "./auth.ts";
import { type BlobStore, fileBlobStore } from "./blobs.ts";
import { config } from "./config.ts";
import { dashboardRoutes } from "./dashboard.ts";
import { listStatsRoutes } from "./list-stats.ts";
import { createOpenApiHandler, OPEN_API_PREFIX } from "./open-api.ts";
import { importDemoTemplate } from "./seed/demo.ts";
import { tokenRoutes } from "./tokens.ts";
import { createZeroHandlers } from "./zero/handlers.ts";

export interface Services {
  database: Database;
  auth: Auth;
  zero: ReturnType<typeof createZeroHandlers>;
  blobs: BlobStore;
}

export function createServices(databaseUrl = config.databaseUrl, filesDir = config.filesDir): Services {
  const database = connect(databaseUrl);
  const auth = createAuth(database, {
    baseUrl: config.baseUrl,
    secret: config.authSecret,
    trustedOrigins: config.webOrigins,
    rateLimit: config.authRateLimit,
  });
  return { database, auth, zero: createZeroHandlers(database), blobs: fileBlobStore(filesDir) };
}

/** HTTP 应用：登录、Zero 的查询和写入转发、附件、开放接口和它的令牌。 */
export function createApp({ database, auth, zero, blobs }: Services) {
  const openApi = createOpenApiHandler();

  async function userID(headers: Headers): Promise<string | null> {
    const session = await auth.api.getSession({ headers });
    return session?.user.id ?? null;
  }

  async function isSpaceAdmin(spaceId: string, userId: string): Promise<boolean> {
    const [member] = await database.db
      .select()
      .from(schema.spaceMember)
      .where(and(eq(schema.spaceMember.spaceId, spaceId), eq(schema.spaceMember.userId, userId)));
    return member?.role === "admin";
  }

  return (
    new Hono()
      .use("/api/*", cors({ origin: config.webOrigins, credentials: true }))
      .get("/api/health", (c) => c.json({ ok: true }))
      .route("/", attachmentRoutes(database, blobs, userID))
      .route("/", tokenRoutes(database, userID))
      .route("/", dashboardRoutes(database, userID))
      .route("/", listStatsRoutes(database, userID))
      // 开放接口给服务端调用，用令牌认证，不带 cookie，所以不需要 CORS 白名单
      .all(`${OPEN_API_PREFIX}/*`, async (c) => {
        const { matched, response } = await openApi.handle(c.req.raw, {
          prefix: OPEN_API_PREFIX,
          context: { headers: c.req.raw.headers, database, zero },
        });
        return matched ? c.newResponse(response.body, response) : c.json({ error: "接口不存在。" }, 404);
      })
      .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
      .post("/api/zero/query", async (c) => {
        const id = await userID(c.req.raw.headers);
        if (!id) return c.json({ error: "未登录。" }, 401);
        return c.json(await zero.query(c.req.raw, id));
      })
      .post("/api/zero/mutate", async (c) => {
        const id = await userID(c.req.raw.headers);
        if (!id) return c.json({ error: "未登录。" }, 401);
        return c.json(await zero.mutate(c.req.raw, id));
      })
      // 模板编辑器做好之前，用它把 示例流程 导入空间作为演示和验收数据。只有空间管理员能调用。
      .post("/api/spaces/:spaceId/import-demo", async (c) => {
        const id = await userID(c.req.raw.headers);
        if (!id) return c.json({ error: "未登录。" }, 401);
        const spaceId = c.req.param("spaceId");
        if (!(await isSpaceAdmin(spaceId, id))) return c.json({ error: "只有空间管理员可以导入模板。" }, 403);
        const existing = await database.db.$count(schema.workItemType, eq(schema.workItemType.spaceId, spaceId));
        if (existing > 0) return c.json({ error: "这个空间已经有工作项类型了。" }, 409);
        return c.json(await importDemoTemplate(database.db, spaceId));
      })
      // 按邮箱把已注册的用户加进空间，可以指定空间角色（默认成员）。查用户要看全站的用户表，所以不走 Zero（浏览器只同步得到同空间成员的邮箱）。
      .post("/api/spaces/:spaceId/members", async (c) => {
        const id = await userID(c.req.raw.headers);
        if (!id) return c.json({ error: "未登录。" }, 401);
        const spaceId = c.req.param("spaceId");
        if (!(await isSpaceAdmin(spaceId, id))) return c.json({ error: "只有空间管理员可以添加成员。" }, 403);
        const body = await c.req.json<{ email?: unknown; role?: unknown }>().catch(() => ({}) as never);
        if (typeof body?.email !== "string" || !body.email.includes("@")) return c.json({ error: "请填写邮箱。" }, 400);
        const [found] = await database.db
          .select({ id: schema.user.id, name: schema.user.name })
          .from(schema.user)
          .where(eq(schema.user.email, body.email.trim().toLowerCase()));
        if (!found) return c.json({ error: "这个邮箱还没有注册。" }, 404);
        const added = await database.db
          .insert(schema.spaceMember)
          .values({ spaceId, userId: found.id, role: spaceRoles.find((r) => r === body.role) ?? "member" })
          .onConflictDoNothing()
          .returning();
        if (added.length === 0) return c.json({ error: "已经是空间成员了。" }, 409);
        return c.json({ userId: found.id, name: found.name });
      })
      .post("/api/flows/validate", async (c) => {
        const definition = await c.req.json<FlowDefinition>();
        if (!Array.isArray(definition?.nodes) || !Array.isArray(definition?.edges))
          return c.json({ error: "请求体必须是包含 nodes 和 edges 的流程定义。" }, 400);
        return c.json(validateFlow(definition));
      })
  );
}
