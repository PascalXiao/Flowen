import { expect, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  createSpace,
  openItems,
  openSettings,
  openTypeConfig,
  selectByName,
  signUp,
  typeTab,
} from "./helpers";

test("a formula field is computed from other fields and can be edited", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `formula-${suffix}@example.com`);
  await createSpace(page, `公式 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("报价单");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "报价单");

  for (const name of ["数量", "单价"]) {
    await typeTab(page, "字段");
    await page.getByLabel("新字段名称").fill(name);
    await choose(selectByName(page, "dataType"), "number");
    await page.getByRole("button", { name: "添加字段" }).click();
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  }
  await page.getByLabel("新字段名称").fill("总价");
  await choose(selectByName(page, "dataType"), "formula");
  await page.getByLabel("公式", { exact: true }).fill("{数量} * {不存在}");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByText("公式有误：字段「不存在」不存在。")).toBeVisible();
  await page.getByLabel("公式", { exact: true }).fill("{数量}*{单价}");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("cell", { name: "{数量} * {单价}" })).toBeVisible();

  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  await closeTypeConfig(page);
  await openItems(page);
  await createItem(page, "A 客户报价", { label: "报价单名称" });
  const fields = page.getByRole("region", { name: "字段" });
  await expect(fields.getByLabel("总价")).toHaveAttribute("readonly", "");
  await fields.getByLabel("数量").fill("3");
  await fields.getByLabel("数量").blur();
  await fields.getByLabel("单价").fill("12.5");
  await fields.getByLabel("单价").blur();
  await expect(fields.getByLabel("总价")).toHaveValue("37.5");
  const itemUrl = page.url();

  // 改公式后已有的工作项跟着重算
  await openSettings(page);
  await openTypeConfig(page, "报价单");
  await typeTab(page, "字段");
  await page.getByRole("button", { name: "编辑总价的公式" }).click();
  await page.getByLabel("总价的公式").fill("ROUND({数量} * {单价} * 1.06, 1)");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("cell", { name: "ROUND({数量} * {单价} * 1.06, 1)" })).toBeVisible();
  await page.goto(itemUrl);
  await expect(page.getByRole("region", { name: "字段" }).getByLabel("总价")).toHaveValue("39.8");
});
