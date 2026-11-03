import { expect, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  createSpace,
  openSettings,
  openTypeConfig,
  selectByName,
  signUp,
  typeTab,
} from "./helpers";

test("a multi-person field: each person adds and fills their own group", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `multi-person-${suffix}@example.com`);
  await createSpace(page, `多人复合 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("技术评审");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "技术评审");

  await typeTab(page, "字段");
  await page.getByLabel("新字段名称").fill("评审意见");
  await choose(selectByName(page, "dataType"), "multiPerson");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("cell", { name: "评审意见", exact: true })).toBeVisible();

  // 每人填：结论（单选）、意见（文本）；填写人自行添加
  await page.getByRole("button", { name: "配置字段 评审意见" }).click();
  const sheet = page.locator(".semi-sidesheet");
  await expect(sheet.getByLabel("填写人")).toBeVisible();
  await sheet.getByLabel("第 1 列名称").fill("结论");
  await choose(sheet.getByLabel("第 1 列类型"), "select");
  for (const option of ["通过", "不通过"]) {
    await sheet.getByLabel("新选项").fill(option);
    await sheet.getByRole("button", { name: "添加选项" }).click();
  }
  await sheet.getByRole("button", { name: "添加列" }).click();
  await sheet.getByLabel("第 2 列名称").fill("意见");
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet).toBeHidden();

  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await closeTypeConfig(page);

  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "技术评审" }).click();
  await createItem(page, "登录改版", { label: "技术评审名称" });

  const table = page.getByRole("table", { name: "评审意见" });
  await expect(table.getByText("还没有人填写")).toBeVisible();
  await page.getByRole("button", { name: "我来填写" }).click();
  await expect(table.getByRole("row").filter({ hasText: "Pascal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "我来填写" })).toBeHidden();
  await choose(table.getByLabel("评审意见 Pascal 结论"), { label: "通过" });
  await table.getByLabel("评审意见 Pascal 意见").fill("接口兼容旧版");
  await table.getByLabel("评审意见 Pascal 意见").blur();
  await page.reload();
  await expect(page.getByRole("table", { name: "评审意见" }).getByLabel("评审意见 Pascal 意见")).toHaveValue(
    "接口兼容旧版",
  );
});
