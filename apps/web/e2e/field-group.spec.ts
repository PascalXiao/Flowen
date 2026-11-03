import { expect, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  createRelation,
  createSpace,
  openItems,
  openSettings,
  openTypeConfig,
  selectByName,
  signUp,
  typeTab,
} from "./helpers";

test("a field group is a small table with configurable columns", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `group-${suffix}@example.com`);
  await createSpace(page, `字段组 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("成本率配置");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "成本率配置");

  await typeTab(page, "字段");
  await page.getByLabel("新字段名称").fill("成本率维护");
  await choose(selectByName(page, "dataType"), "fieldGroup");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("cell", { name: "成本率维护", exact: true })).toBeVisible();

  // 列：品牌（单选）、成本率（数字）
  await page.getByRole("button", { name: "配置字段 成本率维护" }).click();
  const sheet = page.locator(".semi-sidesheet");
  await sheet.getByLabel("第 1 列名称").fill("品牌");
  await choose(sheet.getByLabel("第 1 列类型"), "select");
  for (const brand of ["且初", "ddg"]) {
    await sheet.getByLabel("新选项").fill(brand);
    await sheet.getByRole("button", { name: "添加选项" }).click();
  }
  await sheet.getByRole("button", { name: "添加列" }).click();
  await sheet.getByLabel("第 2 列名称").fill("成本率");
  await choose(sheet.getByLabel("第 2 列类型"), "number");
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet).toBeHidden();

  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await closeTypeConfig(page);

  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "成本率配置" }).click();
  await createItem(page, "2026 成本率", { label: "成本率配置名称" });

  // 详情页里加两行
  const table = page.getByRole("table", { name: "成本率维护" });
  for (const [i, brand, rate] of [
    [1, "且初", "0.3"],
    [2, "ddg", "0.4"],
  ] as const) {
    await page.getByRole("button", { name: "添加一行" }).click();
    await choose(table.getByLabel(`成本率维护第 ${i} 行品牌`), { label: brand });
    await table.getByLabel(`成本率维护第 ${i} 行成本率`).fill(rate);
    await table.getByLabel(`成本率维护第 ${i} 行成本率`).blur();
    await expect(table.getByLabel(`成本率维护第 ${i} 行成本率`)).toHaveValue(rate);
  }

  await page.reload();
  const saved = page.getByRole("table", { name: "成本率维护" });
  await expect(saved.getByLabel("成本率维护第 2 行成本率")).toHaveValue("0.4");
  await expect(saved.getByLabel("成本率维护第 1 行品牌")).toHaveText(/且初/);

  // 删掉第一行
  await page.getByRole("button", { name: "删除成本率维护第 1 行" }).click();
  await expect(saved.getByLabel("成本率维护第 1 行成本率")).toHaveValue("0.4");
  await expect(saved.getByLabel("成本率维护第 2 行成本率")).toHaveCount(0);
});

test("a formula looks up a row in a related work item's field group", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `group-formula-${suffix}@example.com`);
  await createSpace(page, `成本率 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("立项");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await createRelation(page, { from: "立项", to: "立项", name: "关联成本率" });

  await openTypeConfig(page, "立项");
  const addField = async (name: string, type: string, formula?: string) => {
    await typeTab(page, "字段");
    await page.getByLabel("新字段名称").fill(name);
    await choose(selectByName(page, "dataType"), type);
    if (formula) await page.getByLabel("公式", { exact: true }).fill(formula);
    await page.getByRole("button", { name: "添加字段" }).click();
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  };
  await addField("品牌", "text");
  await addField("成本率维护", "fieldGroup");
  await page.getByRole("button", { name: "配置字段 成本率维护" }).click();
  const sheet = page.locator(".semi-sidesheet");
  await sheet.getByLabel("第 1 列名称").fill("品牌");
  await sheet.getByRole("button", { name: "添加列" }).click();
  await sheet.getByLabel("第 2 列名称").fill("成本率");
  await choose(sheet.getByLabel("第 2 列类型"), "number");
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet).toBeHidden();
  await addField("成本率", "formula", 'FIND(RELATED("关联成本率").{成本率维护}, each.{品牌} = {品牌}).{成本率}');

  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await closeTypeConfig(page);

  // 成本率表：两个品牌
  await openItems(page);
  await createItem(page, "2026 成本率", { label: "立项名称" });
  const table = page.getByRole("table", { name: "成本率维护" });
  for (const [i, brand, rate] of [
    [1, "且初", "0.3"],
    [2, "ddg", "0.4"],
  ] as const) {
    await page.getByRole("button", { name: "添加一行" }).click();
    await table.getByLabel(`成本率维护第 ${i} 行品牌`).fill(brand);
    await table.getByLabel(`成本率维护第 ${i} 行品牌`).blur();
    await table.getByLabel(`成本率维护第 ${i} 行成本率`).fill(rate);
    await table.getByLabel(`成本率维护第 ${i} 行成本率`).blur();
    await expect(table.getByLabel(`成本率维护第 ${i} 行成本率`)).toHaveValue(rate);
  }

  // 立项：品牌 ddg，关联上成本率表后取到 0.4
  await openItems(page);
  await createItem(page, "面霜立项", { label: "立项名称" });
  const fields = page.getByRole("region", { name: "字段" });
  await fields.getByLabel("品牌", { exact: true }).fill("ddg");
  await fields.getByLabel("品牌", { exact: true }).blur();
  const group = page.getByRole("main").getByRole("region", { name: "关联成本率" });
  await choose(group.getByLabel("添加关联成本率"), { label: "2026 成本率" });
  await expect(fields.getByLabel("成本率", { exact: true })).toHaveValue("0.4", { timeout: 15_000 });
});
