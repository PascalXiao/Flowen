import { expect, test } from "@playwright/test";
import { createItem, oemSpace, openItems, openSettings } from "./helpers";

test("delete work items into the recycle bin, recover one and purge another", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `recycle-${suffix}@example.com`, `回收站 ${suffix}`);
  for (const name of ["面霜立项", "精华立项", "乳液立项"]) {
    await openItems(page, "项目");
    await createItem(page, name);
  }

  // 详情页里删除：回到列表，列表里没有了
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.locator(".semi-popconfirm").getByRole("button", { name: "删除" }).click();
  await expect(page.getByText("已删除「乳液立项」，可以在回收站里恢复")).toBeVisible();
  const grid = page.getByRole("grid");
  await expect(grid.getByRole("row").filter({ hasText: "精华立项" })).toBeVisible();
  await expect(grid.getByRole("row").filter({ hasText: "乳液立项" })).toHaveCount(0);

  // 列表里勾选批量删除
  await grid.getByRole("row").filter({ hasText: "精华立项" }).getByRole("checkbox").check();
  await page.getByRole("group", { name: "批量操作" }).getByRole("button", { name: "删除" }).click();
  await page.locator(".semi-popconfirm").getByRole("button", { name: "删除" }).click();
  await expect(page.getByText("已删除 1 项")).toBeVisible();
  await expect(grid.getByRole("row").filter({ hasText: "精华立项" })).toHaveCount(0);
  await expect(grid.getByRole("row").filter({ hasText: "面霜立项" })).toBeVisible();

  // 回收站：恢复一个，彻底删除另一个
  await openSettings(page, "回收站");
  const bin = page.getByRole("table", { name: "回收站" });
  await expect(bin.getByRole("row")).toHaveCount(3);
  await expect(bin.getByRole("row").filter({ hasText: "乳液立项" })).toContainText("Pascal");
  await bin.getByRole("button", { name: "恢复 乳液立项" }).click();
  await expect(page.getByText("已恢复「乳液立项」")).toBeVisible();
  await bin.getByRole("button", { name: "彻底删除 精华立项" }).click();
  await page.locator(".semi-popconfirm").getByRole("button", { name: "彻底删除" }).click();
  await expect(page.getByText("已彻底删除「精华立项」")).toBeVisible();
  await expect(page.getByText("回收站是空的")).toBeVisible();

  await openItems(page, "项目");
  await expect(grid.getByRole("row").filter({ hasText: "乳液立项" })).toBeVisible();
  await expect(grid.getByRole("row").filter({ hasText: "精华立项" })).toHaveCount(0);
});
