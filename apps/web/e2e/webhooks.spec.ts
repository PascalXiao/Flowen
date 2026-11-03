import { expect, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  createSpace,
  openItems,
  openSettings,
  openTypeConfig,
  signUp,
  typeTab,
} from "./helpers";

test("admins configure webhooks and see each delivery", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `webhook-${suffix}@example.com`);
  await createSpace(page, `推送 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("缺陷");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "缺陷");
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  await closeTypeConfig(page);
  await page.getByRole("tablist", { name: "空间配置" }).getByRole("tab", { name: "自动化" }).click();
  const form = page.getByRole("form", { name: "添加 Webhook" });
  await form.getByLabel("Webhook 名称").fill("内网服务");
  await form.getByLabel("推送地址").fill("not a url");
  await form.getByRole("button", { name: "添加 Webhook" }).click();
  await expect(page.getByText("请填写 http 或 https 开头的地址。")).toBeVisible();
  // 默认不允许推送到内网地址，推送会被拦下并记为失败
  await form.getByLabel("推送地址").fill("http://127.0.0.1:9/hook");
  await form.getByLabel("创建工作项").check();
  await form.getByRole("button", { name: "添加 Webhook" }).click();
  const hook = page.getByRole("region", { name: "Webhook 内网服务" });
  await expect(hook).toContainText("事件：创建工作项");
  await expect(hook).toContainText("whsec_");

  await openItems(page);
  await createItem(page, "导出失败", { label: "缺陷名称" });
  await openSettings(page, "自动化");
  await hook.getByText(/最近推送/).click();
  const deliveries = hook.getByRole("list", { name: "内网服务的推送记录" });
  await expect(deliveries.getByRole("listitem")).toHaveCount(1);
  await expect(deliveries).toContainText("创建工作项");
  await expect(deliveries).toContainText("失败", { timeout: 20_000 });
  await expect(deliveries).toContainText("不允许推送到内网地址");

  await hook.getByLabel("启用").uncheck();
  await expect(hook).toContainText("已停用");
  await hook.getByRole("button", { name: "删除 Webhook 内网服务" }).click();
  await expect(hook).toHaveCount(0);
});
