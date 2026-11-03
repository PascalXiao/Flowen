import { expect, test } from "@playwright/test";
import { choose, createItem, oemSpace, openAutomations, openItems } from "./helpers";

test("an automation rule fills a field on new work items through the Temporal worker", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `automation-${suffix}@example.com`, `自动化 ${suffix}`);

  // 新建规则：工作项创建后，把“关联需求SKU流程”填成 SKU-AUTO
  await openAutomations(page);
  await expect(page.getByText("还没有自动化规则。")).toBeVisible();
  await page.getByLabel("规则名称").fill("创建后填 SKU");
  await choose(page.getByLabel("触发时机"), "工作项创建后");
  await page.getByRole("button", { name: "添加动作" }).click();
  const action = page.getByRole("group", { name: "动作 1" });
  await choose(action.getByLabel("动作类型"), "修改字段");
  await choose(action.getByRole("combobox", { name: "字段", exact: true }), "关联需求SKU流程");
  await action.getByLabel("设为").fill("SKU-AUTO");
  await page.getByRole("button", { name: "保存规则" }).click();
  const rule = page.getByRole("region", { name: "创建后填 SKU" });
  await expect(rule).toContainText("工作项创建后，把「关联需求SKU流程」设为 SKU-AUTO");

  // 创建工作项：事件经 Outbox → Temporal → worker 执行规则，字段值同步回页面
  await openItems(page);
  await createItem(page, "新品 G");
  await expect(page.getByLabel("关联需求SKU流程")).toHaveValue("SKU-AUTO", { timeout: 30_000 });

  // 执行记录
  await openAutomations(page);
  await expect(rule.getByRole("list", { name: "执行记录" })).toContainText("成功");
  await expect(rule.getByRole("list", { name: "执行记录" })).toContainText("新品 G");

  // 停用后新的工作项不再被修改
  await rule.getByLabel("启用").uncheck();
  await expect(rule.getByLabel("启用")).not.toBeChecked();
});
