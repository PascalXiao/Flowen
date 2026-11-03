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

test("the space dashboard counts work items by stage, type and week", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `dashboard-${suffix}@example.com`);
  await createSpace(page, `看板 ${suffix}`);
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
  await openItems(page);
  for (const name of ["白屏", "闪退", "卡顿"]) {
    await createItem(page, name, { label: "缺陷名称" });
    await openItems(page);
  }

  await page.getByRole("link", { name: "仪表盘" }).click();
  await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();
  const overview = page.getByRole("region", { name: "概览" });
  await expect(overview).toContainText("进行中3");
  await expect(overview).toContainText("近 7 天新建3");
  await expect(overview).toContainText("已延期0");
  await expect(page.getByRole("list", { name: "阶段分布" })).toContainText("待处理3");
  await expect(page.getByRole("list", { name: "类型分布" })).toContainText("缺陷3");
  await expect(page.getByRole("button", { name: /这周：新建 3，完成 0/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "延期节点 0" })).toContainText("没有延期的节点");

  // 按类型筛选
  await choose(page.getByLabel("工作项类型"), { label: "缺陷" });
  await expect(overview).toContainText("进行中3");
});
