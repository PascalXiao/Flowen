/** 运行配置，全部来自环境变量，默认值对应本机开发。 */
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://flowen:flowen@localhost:5432/flowen",
  /** 对外地址，登录回调和 cookie 用。 */
  baseUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  authSecret: process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me-in-production",
  /** 允许跨域带 cookie 访问的前端地址，逗号分隔。 */
  webOrigins: (process.env.WEB_ORIGINS ?? "http://localhost:5173").split(","),
  /** 登录接口限流（防暴力破解）。只在端到端测试里关掉，测试会在几秒内注册好几个账号。 */
  authRateLimit: process.env.AUTH_RATE_LIMIT !== "off",
  /** 附件等文件的存放目录。Docker Compose 部署时挂卷。 */
  filesDir: process.env.FILES_DIR ?? "./data/files",
  /** 注册时直接成为企业管理员的邮箱，逗号分隔。不设时第一个注册的人是企业管理员。 */
  orgAdminEmails: (process.env.ORG_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
};
