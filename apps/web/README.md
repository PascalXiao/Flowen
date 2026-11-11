# @fp/web

Flowen 的前端：React 19 + Vite + TanStack Router，界面组件用 Semi Design，数据通过 Zero 同步。整体说明见仓库根目录的 README。

```bash
pnpm --filter @fp/web dev        # http://localhost:5173，需要 API 和 zero-cache 在跑
pnpm --filter @fp/web test:e2e   # 端到端测试，需要全套服务（见 playwright.config.ts）
```

- 页面在 `src/pages/`，跨页面的组件在 `src/components/`，通用控件在 `src/components/ui/`
- 读数据只用 `@fp/sync` 里的命名查询，写数据只用其中的 mutator
- 不需要登录的流程演示页在 `src/flow-demo/`
