# Flowen

Flowen 是一个项目管理平台：工作项、节点流程、排期、自动化、公式字段、权限、度量和全景视图。

全栈 TypeScript monorepo。流程引擎只有一份代码，服务端用它做权威计算，浏览器用同一份代码做实时校验和预览。

## 目录

| 路径 | 内容 |
| --- | --- |
| `packages/engine` | 流程引擎：零依赖纯 TypeScript，服务端和浏览器共用。`src/samples/demo-flow.ts` 是一套虚构的 48 节点示例流程，演示页、示例模板导入和测试都用它 |
| `apps/web` | 前端：React 19 + Vite + Tailwind CSS v4 + Semi Design + React Flow。界面规范见下面的“界面” |
| `apps/api` | 后端：Node.js 24 + Hono。Better Auth 登录（`/api/auth/*`）、Zero 的查询和写入接口（`/api/zero/*`）、流程校验 |
| `apps/worker` | Temporal worker（每个工作项一个事件流 workflow，按顺序处理事件）和 Outbox 中继 |
| `packages/db` | PostgreSQL 17 + Drizzle：表结构、迁移、`appendEvents`（业务写入和事件同一事务） |
| `packages/sync` | Zero 同步层：schema（drizzle-zero 从 `packages/db` 生成）、查询、mutator，前端和服务端共用 |
| `docker-compose.yml` | Postgres（pgvector、逻辑复制）、Temporal + UI、zero-cache、迁移；`app` profile 再加 API、worker、中继 |

## 界面

设计 token 都在 `apps/web/src/index.css` 的 `@theme` 里：品牌蓝 `brand-*`，文字 `fg` / `fg-muted` / `fg-subtle`，
线 `line` / `line-subtle`，底色 `canvas` / `surface`，状态色 `success` / `warning` / `danger`。页面里只用这些语义类，不直接写 slate、sky 这类颜色。
字号 12/14/16/20，控件高 32px，圆角 6px。

组件在 `apps/web/src/components/ui/`：`Button`、`Input` / `Select` / `Textarea` / `Field`、`Tag` / `StatusTag` / `StageTag`、`Avatar`、
`Dialog`、`Popover`、`DropdownMenu`、`Tabs` / `Segmented`、`PageHeader` / `PageBody` / `Panel` / `EmptyState`。
布局：`AppShell` 是左侧导航（空间切换、工作项类型、自动化、空间设置、通知、账号）加右侧页面；没有空间参数的页面用 `useActiveSpace` 报告自己所在的空间。
新建类的操作用弹窗，详情页右侧是用细线分节的面板。

## 读写怎么走

前端通过 Zero 读写。读：只能用 `packages/sync/src/queries.ts` 里的命名查询，zero-cache 把它转给 `/api/zero/query`，
服务端按登录用户展开成带权限过滤的查询（只看得到自己所在空间的数据）。写：调用 `packages/sync/src/mutators.ts` 里的 mutator，
浏览器先乐观执行，zero-cache 再转给 `/api/zero/mutate`，由 `packages/server/src/mutators.ts` 权威执行一遍，并在同一个事务里追加事件。

## 事件怎么流转

业务写入时在同一个事务里调用 `appendEvents`：写 `event_log`，写 `infra.outbox`，发 NOTIFY。
中继（`apps/worker/src/relay.ts`）收到通知后，按 id 顺序把事件用 signalWithStart 交给 `stream:work_item:<id>` 这个 workflow；
workflow 逐条调用 activity 处理，按事件 id 丢弃重复投递。只有一个中继能拿到领导者锁，所以同一个工作项的事件不会乱序；
投递失败的事件留在 outbox 里，下一轮从它开始重试。

`infra` schema 里的表（outbox、登录会话和凭据、向量）不进 Zero 的 publication，不会同步到浏览器。

## 运行

需要 Node.js 24 和 pnpm 10。

```bash
pnpm install
pnpm test        # 所有包的测试
pnpm typecheck
pnpm check       # Biome 格式和代码检查
```

```bash
pnpm --filter @fp/web dev   # 演示页 http://localhost:5173
pnpm --filter @fp/api dev   # API http://localhost:3000
```

基础设施用 Docker Compose 起：

```bash
docker compose up -d                   # Postgres :5432、Temporal :7233、Temporal UI http://localhost:8080、zero-cache :4848，并跑迁移
docker compose --profile app up -d     # 再加 API :3000、Temporal worker、Outbox 中继（端到端测试时设 ZERO_API_ORIGIN=http://api:3000）
```

上线部署（一台服务器、一个域名、自动 HTTPS、备份）见 [deploy/README.md](deploy/README.md)。

集成测试需要真实的 Postgres 和 Temporal：

```bash
docker compose up -d --wait postgres temporal && docker compose run --rm temporal-namespace
pnpm test:integration
```

改了 `packages/db/src/schema.ts` 之后：

```bash
pnpm db:generate   # 生成迁移，并重新生成 Zero schema
```

## 当前进度

已经有的（细节看 git 历史和 PR）：

- **配置**：工作项类型（节点流 / 状态流）、28 种字段类型、字段规则（默认值、有效性、条件显示和必填）、公式（43 个函数，能沿关联和子工作项取数）、角色（出现规则、分配方式、单人）、业务线、详情页和新建页布局（页签、分组、关联信息、关联表格、节点信息等控件）、流程模板编辑器（会签、卡点、裁剪、自定义按钮、完成结论、节点字段、节点依赖和排期规则）、关系定义、工作日历
- **使用**：列表（列配置、节点衍生列、单元格复制粘贴、批量操作、汇总行、着色）、看板（泳道）、树形、甘特、空间甘特、详情页（流程图、节点卡片、催一催、子任务、评论楼中楼、动态、附件、投票）、关键路径和计划基线、我的工作（待办和已办）、全局搜索、视图
- **权限**：空间角色、用户组、按类型的查看范围和操作授权、字段可见和可改
- **自动化与集成**：事件、定时和临期触发，条件分支，通知、评论、建工作项、改状态等动作；Webhook；开放接口（`/open-api/v1`）
- **度量与总览**：仪表盘、度量图表和钻取、人员排期、跨空间全景视图
- **数据**：Excel 导出导入、回收站、工作移交
- **部署**：`deploy/` 下的生产 Compose 配置和备份脚本

还没有的：单点登录和 IM 集成（现在是邮箱密码登录）、多租户、跨工作项的节点依赖、多项目甘特、空间关联、层级管理、轻应用、AI。
