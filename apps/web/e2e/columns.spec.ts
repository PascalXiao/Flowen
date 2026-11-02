import { expect, test } from "@playwright/test";
import { closeTypeConfig, createItem, oemSpace, openItems, openSettings, openTypeConfig, typeTab } from "./helpers";

test("admins set the default columns of a work item list", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `columns-${suffix}@example.com`, `默认列 ${suffix}`);

  // 默认列里有「创建者」「提出时间」
  const grid = page.getByRole("grid");
  await expect(grid.getByRole("columnheader", { name: "创建者" })).toBeVisible();
  await expect(grid.getByRole("columnheader", { name: "提出时间" })).toBeVisible();

  // 在项目配置的「列」页签里去掉「创建者」，把「提出时间」挪到「状态」后面
  await openSettings(page);
  await openTypeConfig(page, "项目");
  await typeTab(page, "列");
  await page.getByRole("checkbox", { name: "显示列 创建者" }).uncheck();
  const shown = page.getByRole("region", { name: "已显示的列" });
  await expect(shown).not.toContainText("创建者");
  await shown.getByRole("button", { name: "上移列 提出时间" }).click();
  await page.getByRole("button", { name: "保存默认列" }).click();
  await expect(page.getByText("已保存")).toBeVisible();

  // 回到项目列表：新的默认列生效
  await closeTypeConfig(page);
  await openItems(page, "项目");
  await expect(grid.getByRole("columnheader", { name: "创建者" })).toHaveCount(0);
  await expect(grid.getByRole("columnheader", { name: "提出时间" })).toBeVisible();

  // 恢复默认后「创建者」回来
  await openSettings(page);
  await openTypeConfig(page, "项目");
  await typeTab(page, "列");
  await page.getByRole("button", { name: "恢复默认" }).click();
  await expect(page.getByRole("checkbox", { name: "显示列 创建者" })).toBeChecked();
});

test("role, node and schedule columns show who does what and how a work item is doing", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `role-columns-${suffix}@example.com`, `角色列 ${suffix}`);
  await openSettings(page);
  await openTypeConfig(page, "项目");
  await typeTab(page, "列");
  await page.getByRole("checkbox", { name: "显示列 角色：NPD" }).check();
  await page.getByRole("checkbox", { name: "显示列 节点：需求立项提案" }).check();
  await page.getByRole("checkbox", { name: "显示列 延期" }).check();
  await page.getByRole("checkbox", { name: "显示列 预计完成" }).check();
  await page.getByRole("button", { name: "保存默认列" }).click();
  await expect(page.getByText("已保存")).toBeVisible();
  await closeTypeConfig(page);

  await openItems(page, "项目");
  await createItem(page, "面霜立项");
  await openItems(page, "项目");
  const grid = page.getByRole("grid");
  for (const name of ["角色：NPD", "节点：需求立项提案", "延期", "预计完成"])
    await expect(grid.getByRole("columnheader", { name })).toBeVisible();
  const row = grid.getByRole("row").filter({ hasText: "面霜立项" });
  await expect(row).toContainText("进行中");
});
