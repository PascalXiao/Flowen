# 飞书项目复刻

Flowen 复刻飞书项目（Meego）的核心能力：工作项、节点流程、排期、自动化、公式字段和权限。设计文档见 Claude Docs「飞书项目复刻：数据模型与流程引擎设计」。

全栈 TypeScript monorepo。流程引擎只有一份代码，服务端用它做权威计算，浏览器用同一份代码做实时校验和预览。

## 目录

| 路径 | 内容 |
| --- | --- |
| `packages/engine` | 流程引擎：零依赖纯 TypeScript，服务端和浏览器共用。`src/samples/oem-v289.ts` 是 OEM v289 流程的验收数据 |
| `apps/web` | 前端：React 19 + Vite + Tailwind CSS v4 + Radix + React Flow。界面规范见下面的“界面” |
| `apps/api` | 后端：Node.js 24 + Hono。Better Auth 登录（`/api/auth/*`）、Zero 的查询和写入接口（`/api/zero/*`）、流程校验 |
| `apps/worker` | Temporal worker（每个工作项一个事件流 workflow，按顺序处理事件）和 Outbox 中继 |
| `packages/db` | PostgreSQL 17 + Drizzle：表结构、迁移、`appendEvents`（业务写入和事件同一事务） |
| `packages/sync` | Zero 同步层：schema（drizzle-zero 从 `packages/db` 生成）、查询、mutator，前端和服务端共用 |
| `docker-compose.yml` | Postgres（pgvector、逻辑复制）、Temporal + UI、zero-cache、迁移；`app` profile 再加 API、worker、中继 |

## 界面

视觉参照飞书项目。设计 token 都在 `apps/web/src/index.css` 的 `@theme` 里：品牌蓝 `brand-*`，文字 `fg` / `fg-muted` / `fg-subtle`，
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

- [x] 流程引擎：节点状态、分叉汇聚、开关裁剪（汇聚时跳过）、单人确认 / 会签 / 自动完成 / 子工作项驱动、卡点、阶段改写、回滚、工作项完成判定、发布前校验
- [x] 节点子任务（负责人、截止日期，模板可预置）和节点完成表单（必填字段）；有没完成的子任务或必填项没填时不能确认
- [x] 我的工作：所有空间里轮到我的节点和分给我的子任务，按截止日期分组
- [x] 状态流工作项（缺陷、工单）：新建类型时选节点流或状态流；状态流模板配置状态、流转、可操作角色和流转条件，工作项在详情页按可用流转切换状态
- [x] 权限：空间角色（管理员、成员、访客，访客只能查看和评论）；字段按工作项角色控制可见和可改（看不到的值不会同步到浏览器）；节点的可操作角色可以回滚、调整排期
- [x] 看板视图：按阶段分列；只看一个状态流类型时按状态分列，拖动卡片即按流转规则流转
- [x] 字段类型：数字、日期、单选、多选、人员、链接、是否；写入时按类型校验，列表可按字段值筛选（属于、范围、包含文字）并存为视图，条件和自动化也支持
- [x] 工作项动态：详情页「动态」页签按时间列出谁做了什么（节点流转、状态、字段、角色、排期、子任务、关联、评论），受限字段的改动只给能看到的人
- [x] 树形视图：空间列表可切到「树形」，按子工作项或任一自定义关联分层，逐层展开
- [x] 公式字段：四则运算、比较、IF、ROUND、日期差、文本拼接，以及子工作项汇总（求和、计数、完成数）；服务端在输入变化时自动重算并逐级汇总
- [x] 附件：工作项上传、下载、删除附件（单个 50 MB 以内），图片带缩略图；文件存在 API 的数据卷里，访客只能下载
- [x] 全局搜索：⌘K / Ctrl+K 在所有空间里按名称、文本字段（只查自己能看到的）和评论找工作项，键盘选择打开
- [x] 详情页布局：管理员在类型配置里把字段分组、排序、设为不显示，分组可以默认收起；新建表单按同样的顺序
- [x] 开放接口：账号菜单「开放接口」里创建个人访问令牌，用 `Authorization: Bearer` 调 `/open-api/v1`（空间、工作项查询和详情、新建、改字段、确认节点、状态流转、评论），权限和本人一致；文档在 `/open-api/v1/docs`
- [x] Webhook：空间设置里配置推送地址和订阅的事件，请求带 HMAC-SHA256 签名，失败按退避重试 5 次，推送记录可查；默认不推送到内网地址（`WEBHOOK_ALLOW_PRIVATE=true` 放开）
- [x] 上线部署：`deploy/` 下的生产 Compose 配置（Caddy 自动 HTTPS、前端和 API、Zero 同域名、内部端口不暴露、密钥必填）、备份脚本和部署说明
- [x] 仪表盘：空间里进行中、近 7 天新建和完成、延期数量，阶段和类型分布，最近 8 周新建和完成趋势，延期节点列表和每人负载；可以按类型筛选
- [x] OEM 流程演示页
- [ ] 排期引擎（正排、倒排、多参照）
- [ ] 公式字段
- [ ] 自动化引擎
- [x] 基础设施：Docker Compose、数据库表结构和迁移、Zero schema、Temporal worker、Outbox 中继
- [x] 登录（Better Auth 邮箱密码）、Zero 的查询和写入接口（新建空间、改字段值）
- [x] 新建工作项：流程引擎算出初始节点状态和阶段，事件写入 event_log；OEM v289 导入工具（`pnpm --filter @fp/api seed:oem <空间 id>`）
- [ ] 前端接入 Zero 和登录页；节点确认、回滚；oRPC 开放接口
- [ ] 正式的前端页面：空间、工作项列表、详情、模板编辑器
