import { defineConfig } from "@playwright/test";

/**
 * 端到端测试：需要全套服务在跑（ZERO_API_ORIGIN=http://api:3000 AUTH_RATE_LIMIT=off docker compose --profile app up）。
 * 前端开发服务器没开的话会自动起一个。
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // CI 上失败的用例重跑一次：全套服务跑在一台机器上，同步和 Temporal 偶尔慢。重跑才过的用例在报告里记为 flaky
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:5173",
    launchOptions: {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      // 没有 UTF-8 区域设置时，Chromium 会把中文下载文件名换成 "download"
      env: { ...process.env, LANG: process.env.LANG || "C.UTF-8" },
    },
    trace: "retain-on-failure",
  },
  webServer: process.env.WEB_URL
    ? undefined
    : { command: "pnpm dev --port 5173 --strictPort", url: "http://localhost:5173", reuseExistingServer: true },
});
