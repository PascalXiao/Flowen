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

test("a status-flow type is configured as statuses and transitions, and items move between them", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `status-${suffix}@example.com`);
  await createSpace(page, `状态流 ${suffix}`);
  await openSettings(page);

  // 状态流类型，带一个“测试”角色
  await page.getByLabel("新类型名称").fill("缺陷");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "缺陷");
  await typeTab(page, "角色");
  await page.getByLabel("新角色名称").fill("测试");
  await page.getByRole("button", { name: "添加角色" }).click();
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("缺陷流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "缺陷流程" }).click();

  // 默认是 待处理 → 处理中 → 已完成；在中间加一个“待验证”，只有测试能验证通过
  await expect(page.getByText("状态流", { exact: true })).toBeVisible();
  await page.getByLabel("新状态名称").fill("待验证");
  await page.getByRole("button", { name: "添加状态" }).click();
  await page.getByRole("button", { name: "删除流转处理中 → 已完成" }).click();
  await choose(page.getByLabel("流转起点"), "处理中");
  await choose(page.getByLabel("流转终点"), "待验证");
  await page.getByRole("button", { name: "添加流转" }).click();
  await choose(page.getByLabel("流转起点"), "待验证");
  await choose(page.getByLabel("流转终点"), "已完成");
  await page.getByRole("button", { name: "添加流转" }).click();
  await page.getByRole("button", { name: "待验证 → 已完成：测试" }).click();
  await expect(page.getByRole("button", { name: "待验证 → 已完成：测试" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("没有发现问题，可以发布。")).toBeVisible();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  // 新工作项从“待处理”开始，按流转一步步走
  await closeTypeConfig(page);
  await openItems(page);
  await createItem(page, "登录页报错", { label: "缺陷名称" });
  const panel = page.getByRole("region", { name: "当前状态" });
  await expect(panel).toContainText("待处理");
  await panel.getByRole("button", { name: "处理中" }).click();
  await expect(panel).toContainText("处理中");
  await panel.getByRole("button", { name: "待验证" }).click();
  await expect(panel).toContainText("待验证");
  // 空间管理员不受角色限制
  await panel.getByRole("button", { name: "已完成" }).click();
  await expect(panel.getByText("已完成", { exact: true }).first()).toBeVisible();
  await expect(page.locator("header").getByText("已完成", { exact: true }).first()).toBeVisible();

  // 列表里阶段列显示状态名
  await openItems(page);
  await expect(page.getByRole("row", { name: /登录页报错/ })).toContainText("已完成");
});
