import { expect, test } from "@playwright/test";
import { addMember, choose, createItem, demoSpace, openItems, registerColleague } from "./helpers";

test("filter the work item list and save the filter as a view", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await registerColleague(`lin-view-${suffix}@example.com`, "Lin");
  await demoSpace(page, "Pascal", `views-${suffix}@example.com`, `视图 ${suffix}`);
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

  await page.getByRole("button", { name: "保存为视图" }).click();
  await page.getByLabel("视图名称").fill("Lin 参与的");
  await page.getByLabel("说明").fill("Lin 在做的新品");
  await page.getByRole("button", { name: "保存", exact: true }).click();
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

  await views.getByRole("tab", { name: "Lin 参与的" }).click();
  await expect(page.getByText("Lin 在做的新品")).toBeVisible();
  await views.getByRole("button", { name: "视图操作 Lin 参与的" }).click();
  await page.getByRole("menuitem", { name: "删除视图 Lin 参与的" }).click();
  await expect(views.getByRole("tab", { name: "Lin 参与的" })).toHaveCount(0);

  // 固定视图：把当前列表的工作项放进去，之后不随条件变化，可以批量移出
  await views.getByRole("tab", { name: "全部" }).click();
  await page.getByRole("button", { name: "保存为视图" }).click();
  await page.getByLabel("视图名称").fill("我的清单");
  await choose(page.getByLabel("可见范围"), "个人视图");
  await choose(page.getByLabel("视图类型"), "固定视图");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const fixed = views.getByRole("tab", { name: /我的清单/ });
  await expect(fixed).toHaveAttribute("aria-selected", "true");
  await expect(fixed.getByLabel("个人视图")).toBeVisible();
  await expect(table.getByRole("link", { name: "新品 H" })).toBeVisible();
  await table.getByRole("row").filter({ hasText: "新品 H" }).getByRole("checkbox").check();
  await page.getByRole("group", { name: "批量操作" }).getByRole("button", { name: "移出视图" }).click();
  await expect(table.getByRole("link", { name: "新品 H" })).toHaveCount(0);
  await expect(table.getByRole("link", { name: "新品 I" })).toBeVisible();
});
