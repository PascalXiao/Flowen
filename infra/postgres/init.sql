-- 首次启动时执行：应用库、Zero 的 CVR 和变更日志库、Temporal 用户、pgvector 扩展。
-- 表结构由 packages/db 的迁移创建（docker compose 里的 migrate 服务，或 pnpm --filter @fp/db db:migrate）。
CREATE ROLE temporal WITH LOGIN PASSWORD 'temporal' CREATEDB;
CREATE DATABASE flowen;
CREATE DATABASE zero;
\c flowen
CREATE EXTENSION IF NOT EXISTS vector;
