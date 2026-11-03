import { expect, test } from "@playwright/test";
import { addMember, choose, createItem, oemSpace, openItems, registerColleague } from "./helpers";

test("filter the work item list and save the filter as a view", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await registerColleague(`lin-view-${suffix}@example.com`, "Lin");
  await oemSpace(page, "Pascal", `views-${suffix}@example.com`, `视图 ${suffix}`);
  await addMember(page, `lin-view-${suffix}@example.com`, "Lin");
  await openItems(page);

  // 新品 H 只有 Pascal；新品 I 的开发加上 Lin
  await createItem(page, "新品 H");
  await openItems(page);
  await createItem(page, "新品 I", { roles: ["开发：Lin"] });
  await openItems(page);

  const table = page.getByRole("grid");
  await expect(table.getByRole("link", { name: "新品 H" })).toBeVisible();
  await expect(table.getByRole("link", { name: "新品 I" })).toBeVisible();

  await choose(page.getByLabel("按参与人筛选"), "Lin");
  await expect(table.getByRole("link", { name: "新品 H" })).toHaveCount(0);
  await expect(table.getByRole("link", { name: "新品 I" })).toBeVisible();

  await page.getByLabel("视图名称").fill("Lin 参与的");
  await page.getByRole("button", { name: "保存为视图" }).click();
  const views = page.getByRole("tablist", { name: "视图" });
  await expect(views.getByRole("tab", { name: "Lin 参与的" })).toHaveAttribute("aria-selected", "true");

  await views.getByRole("tab", { name: "全部" }).click();
  await expect(table.getByRole("link", { name: "新品 H" })).toBeVisible();
  await views.getByRole("tab", { name: "Lin 参与的" }).click();
  await expect(table.getByRole("link", { name: "新品 H" })).toHaveCount(0);
  await expect(page.getByLabel("按参与人筛选")).not.toContainText("全部参与人");

  // 状态筛选：没有已完成的工作项
  await choose(page.getByLabel("按状态筛选"), "已完成");
  await expect(page.getByText("没有符合条件的工作项")).toBeVisible();

  await views.getByRole("button", { name: "删除视图 Lin 参与的" }).click({ force: true });
  await expect(views.getByRole("tab", { name: "Lin 参与的" })).toHaveCount(0);
});
