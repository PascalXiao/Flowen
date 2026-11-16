import postgres from "postgres";
import { runMigrations } from "./migrate.ts";

/**
 * 集成测试用：在 TEST_DATABASE_URL 指向的服务器上新建一个空库并跑完迁移，返回它的连接串。
 * 默认连本机 docker compose 里的 Postgres。
 */
export async function createTestDatabase(name: string): Promise<string> {
  const base = new URL(process.env.TEST_DATABASE_URL ?? "postgresql://flowen:flowen@localhost:5432/postgres");
  const admin = postgres(base.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(base);
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  return url.toString();
}
