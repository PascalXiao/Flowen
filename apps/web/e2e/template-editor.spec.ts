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

test("configure a type from scratch, draw and publish its flow, then create a work item with it", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `editor-${suffix}@example.com`);
  await createSpace(page, `配置 ${suffix}`);
  await openSettings(page);

  // 新建类型，配角色、字段和模板
  await page.getByLabel("新类型名称").fill("缺陷");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "缺陷");
  await typeTab(page, "角色");
  await page.getByLabel("新角色名称").fill("开发");
  await page.getByRole("button", { name: "添加角色" }).click();
  await typeTab(page, "字段");
  await page.getByLabel("新字段名称").fill("需要测试");
  await page.getByLabel("选项（单选、多选用，逗号分隔）").fill("是，否");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("cell", { name: "是 / 否" })).toBeVisible();
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认流程" }).click();
  await expect(page.getByText("v1 草稿")).toBeVisible();

  // 画流程：开始 → 修复 → 验证（只在需要测试时出现）
  const node = (name: string) => page.locator(".react-flow__node", { hasText: name });
  const panel = page.getByRole("main");
  await node("开始").click();
  await page.getByRole("button", { name: "添加节点" }).click();
  await panel.getByLabel("节点名称").fill("修复");
  await panel.getByLabel("开发", { exact: true }).check();
  await page.getByRole("button", { name: "添加节点" }).click();
  await panel.getByLabel("节点名称").fill("验证");
  await panel.getByLabel("开发", { exact: true }).check();
  await panel
    .getByRole("group", { name: "出现条件（不满足时跳过这个节点）" })
    .getByRole("button", { name: "+ 添加条件" })
    .click();
  await expect(node("验证")).toContainText("有出现条件");
  await expect(panel.getByText("没有发现问题，可以发布。")).toBeVisible();

  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  // 用新流程建一个缺陷，不需要测试：验证节点被跳过
  await closeTypeConfig(page);
  await openItems(page);
  await createItem(page, "登录报错", {
    label: "缺陷名称",
    before: (dialog) => choose(dialog.getByLabel("需要测试"), "否"),
  });

  await expect(panel.getByRole("region", { name: "修复" })).toBeVisible();
  await expect(node("验证")).toContainText("已跳过");
});
