/** 运行配置，全部来自环境变量，默认值对应本机 docker compose。 */
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://flowen:flowen@localhost:5432/flowen",
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "fp-events",
  /** Webhook 允许推送到内网和本机地址。默认不允许，只在测试或全内网部署时打开。 */
  webhookAllowPrivate: process.env.WEBHOOK_ALLOW_PRIVATE === "true",
};
