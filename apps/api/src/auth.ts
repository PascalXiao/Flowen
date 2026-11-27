import { type Database, schema } from "@fp/db";
import { writeAudit } from "@fp/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sql } from "drizzle-orm";

export interface AuthOptions {
  baseUrl: string;
  secret: string;
  trustedOrigins: string[];
  /** 默认按 Better Auth 的生产配置限流。 */
  rateLimit?: boolean;
  /** 注册时直接成为企业管理员的邮箱（小写）。 */
  orgAdminEmails?: string[];
}

/**
 * 登录。第一期用邮箱 + 密码；企业 IM、OIDC 单点登录以后作为 social provider / 插件接入。
 * 用户表在 public（前端要显示名字），会话和凭据在 infra，不会同步到浏览器。
 */
export function createAuth(database: Database, options: AuthOptions) {
  return betterAuth({
    baseURL: options.baseUrl,
    basePath: "/api/auth",
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(database.db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: { enabled: true },
    databaseHooks: {
      user: {
        create: {
          // 还没有企业管理员时（新部署的第一个人），或者邮箱在 ORG_ADMIN_EMAILS 里，成为企业管理员
          after: async (user) => {
            const listed = options.orgAdminEmails?.includes(user.email.toLowerCase()) ?? false;
            await database.db.execute(
              listed
                ? sql`insert into org_admin (user_id) values (${user.id}) on conflict do nothing`
                : sql`insert into org_admin (user_id) select ${user.id} where not exists (select 1 from org_admin)`,
            );
            await writeAudit(database.db, {
              actor: user.id,
              action: "account.signUp",
              targetId: user.id,
              targetName: user.name,
            });
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await writeAudit(database.db, {
              actor: session.userId,
              action: "account.login",
              ip: session.ipAddress ?? null,
              detail: session.userAgent ? { userAgent: session.userAgent } : null,
            });
          },
        },
      },
    },
    ...(options.rateLimit === false && { rateLimit: { enabled: false } }),
  });
}

export type Auth = ReturnType<typeof createAuth>;
