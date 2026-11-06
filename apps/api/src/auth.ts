import { type Database, schema } from "@fp/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

export interface AuthOptions {
  baseUrl: string;
  secret: string;
  trustedOrigins: string[];
  /** 默认按 Better Auth 的生产配置限流。 */
  rateLimit?: boolean;
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
    ...(options.rateLimit === false && { rateLimit: { enabled: false } }),
  });
}

export type Auth = ReturnType<typeof createAuth>;
