import { expect, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  createRelation,
  demoSpace,
  openItems,
  openSettings,
  openTypeConfig,
  typeTab,
} from "./helpers";

test("admins set the default columns of a work item list", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `columns-${suffix}@example.com`, `默认列 ${suffix}`);

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
  await demoSpace(page, "Pascal", `role-columns-${suffix}@example.com`, `角色列 ${suffix}`);
  await openSettings(page);
  await openTypeConfig(page, "项目");
  await typeTab(page, "列");
  await page.getByRole("checkbox", { name: "显示列 角色：NPD" }).check();
  await page.getByRole("checkbox", { name: "显示列 节点：立项提案" }).check();
  await page.getByRole("checkbox", { name: "显示列 延期" }).check();
  await page.getByRole("checkbox", { name: "显示列 预计完成" }).check();
  await page.getByRole("button", { name: "保存默认列" }).click();
  await expect(page.getByText("已保存")).toBeVisible();
  await closeTypeConfig(page);

  await openItems(page, "项目");
  await createItem(page, "面霜立项");
  await openItems(page, "项目");
  const grid = page.getByRole("grid");
  for (const name of ["角色：NPD", "节点：立项提案", "延期", "预计完成"])
    await expect(grid.getByRole("columnheader", { name })).toBeVisible();
  const row = grid.getByRole("row").filter({ hasText: "面霜立项" });
  await expect(row).toContainText("进行中");
});

test("the list freezes columns, changes row height and sums up columns at the bottom", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `list-summary-${suffix}@example.com`, `汇总行 ${suffix}`);
  await openItems(page, "项目");
  await createItem(page, "面霜立项");
  await openItems(page, "项目");
  await createItem(page, "精华立项");
  await openItems(page, "项目");
  const grid = page.getByRole("grid");
  await expect(grid.getByRole("row").filter({ hasText: "精华立项" })).toBeVisible();

  // 底部汇总：「创建者」列计数、已填写百分比
  const summary = page.getByRole("group", { name: "汇总", exact: true });
  await expect(summary).toContainText("共 2 条");
  await summary.getByRole("button", { name: "创建者的汇总" }).click();
  await page.getByRole("menuitem", { name: "计数" }).click();
  await expect(summary.getByRole("button", { name: "创建者的汇总" })).toHaveText("计数 2");
  await summary.getByRole("button", { name: "创建者的汇总" }).click();
  await expect(page.getByRole("menuitem", { name: "求和" })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "已填写百分比" }).click();
  await expect(summary.getByRole("button", { name: "创建者的汇总" })).toHaveText("已填写百分比 100%");

  // 冻结到第一个显示的列
  await page.getByRole("button", { name: "冻结" }).click();
  await page.getByRole("menuitem").filter({ hasText: "冻结到" }).first().click();
  await expect(page.getByRole("button", { name: "冻结 2 列" })).toBeVisible();
  await expect(grid.locator("thead th.semi-table-cell-fixed-left")).toHaveCount(3);

  // 行高改成「高」
  await page.getByRole("button", { name: "行高：低" }).click();
  await page.getByRole("menuitem", { name: "高", exact: true }).click();
  const row = grid.getByRole("row").filter({ hasText: "面霜立项" });
  await expect.poll(async () => (await row.boundingBox())?.height).toBeGreaterThanOrEqual(70);
});

test("relation columns show linked work items and their fields", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `relation-columns-${suffix}@example.com`, `关联列 ${suffix}`);
  await createRelation(page, { from: "项目", to: "项目", name: "前置项目", reverseName: "后续项目" });
  await openItems(page, "项目");
  for (const name of ["新品 A", "新品 B"]) {
    await createItem(page, name);
    await openItems(page, "项目");
  }
  await page.getByRole("link", { name: "新品 B" }).click();
  const forward = page.getByRole("main").getByRole("region", { name: "前置项目" });
  await choose(forward.getByLabel("添加前置项目"), { label: "新品 A" });
  await expect(forward.getByRole("link", { name: "新品 A" })).toBeVisible();

  // 表头「+」里加上关联列、另一端的关联列和关联字段列
  await openItems(page, "项目");
  for (const name of ["前置项目", "后续项目", "前置项目 · 状态"]) {
    await page.getByRole("button", { name: "添加列" }).click();
    await page.getByRole("checkbox", { name, exact: true }).check();
    await page.keyboard.press("Escape");
  }
  const grid = page.getByRole("grid");
  for (const name of ["前置项目", "后续项目", "前置项目 · 状态"])
    await expect(grid.getByRole("columnheader", { name, exact: true })).toBeVisible();
  // 新品 A 出现两次：自己的名称，和新品 B 的「前置项目」；新品 B 同样出现在新品 A 的「后续项目」里
  await expect(grid.getByRole("link", { name: "新品 A", exact: true })).toHaveCount(2);
  await expect(grid.getByRole("link", { name: "新品 B", exact: true })).toHaveCount(2);
});
