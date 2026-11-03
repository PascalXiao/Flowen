import { expect, type Locator, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  oemSpace,
  openItems,
  openSettings,
  openTypeConfig,
  selectByName,
  typeTab,
} from "./helpers";

test("batch edit a field, terminate and restore selected rows", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `batch-${suffix}@example.com`, `批量 ${suffix}`);
  await openSettings(page);
  await openTypeConfig(page, "项目");
  await typeTab(page, "字段");
  await page.getByLabel("新字段名称").fill("批次");
  await choose(selectByName(page, "dataType"), "text");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("button", { name: "配置字段 批次" })).toBeVisible();
  await typeTab(page, "列");
  await page.getByRole("checkbox", { name: "显示列 批次" }).check();
  await page.getByRole("button", { name: "保存默认列" }).click();
  await expect(page.getByText("已保存")).toBeVisible();
  await closeTypeConfig(page);

  for (const name of ["面霜立项", "精华立项", "乳液立项"]) {
    await openItems(page, "项目");
    await createItem(page, name);
  }
  await openItems(page, "项目");
  const grid = page.getByRole("grid");
  const row = (name: string): Locator => grid.getByRole("row").filter({ hasText: name });
  for (const name of ["面霜立项", "精华立项"]) await row(name).getByRole("checkbox").check();
  const bar = page.getByRole("group", { name: "批量操作" });
  await expect(bar).toContainText("已选 2 项");

  // 批量改字段
  await bar.getByRole("button", { name: "修改字段" }).click();
  await choose(page.getByLabel("要修改的字段"), { label: "批次" });
  await page.getByLabel("改成").fill("第一批");
  await page.getByRole("button", { name: "应用" }).click();
  await expect(page.getByText("已修改 2 项")).toBeVisible();
  await expect(row("面霜立项").locator('[data-cell="批次"]')).toHaveText("第一批");
  await expect(row("精华立项").locator('[data-cell="批次"]')).toHaveText("第一批");
  await expect(row("乳液立项").locator('[data-cell="批次"]')).not.toHaveText("第一批");

  // 批量终止，再批量恢复
  await bar.getByRole("button", { name: "终止" }).click();
  await page.getByLabel("终止原因").fill("方案调整");
  await page.locator(".semi-popconfirm").getByRole("button", { name: "终止" }).click();
  await expect(page.getByText("已终止 2 项")).toBeVisible();
  await expect(bar.getByRole("button", { name: "终止" })).toHaveCount(0);
  await bar.getByRole("button", { name: "恢复" }).click();
  await expect(page.getByText("已恢复 2 项")).toBeVisible();
  await expect(bar.getByRole("button", { name: "终止" })).toBeVisible();

  await bar.getByRole("button", { name: "取消选择" }).click();
  await expect(bar).toHaveCount(0);
});
