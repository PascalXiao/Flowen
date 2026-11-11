import { expect, test } from "@playwright/test";
import { choose, createItem, createSpace, demoSpace, importDemo, openItems } from "./helpers";

test("panorama puts work items from several spaces together, as a table or a chart", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const [a, b] = [`全景甲 ${suffix}`, `全景乙 ${suffix}`];
  await demoSpace(page, "Pascal", `panorama-${suffix}@example.com`, a);
  await openItems(page, "项目");
  await createItem(page, "面霜立项");
  await page.goto("/");
  await createSpace(page, b);
  await importDemo(page);
  await createItem(page, "精华立项");

  await page.getByRole("link", { name: "全景视图" }).click();
  const table = page.getByRole("table", { name: "全景" });
  await expect(table.getByRole("link", { name: "面霜立项" })).toBeVisible();
  await expect(table.getByRole("link", { name: "精华立项" })).toBeVisible();

  // 按所属空间分组
  await choose(page.getByLabel("分组", { exact: true }), { label: "所属空间" });
  await expect(table.getByRole("rowheader", { name: `${a} 1` })).toBeVisible();
  await expect(table.getByRole("rowheader", { name: `${b} 1` })).toBeVisible();

  // 度量模式：默认按空间计数
  await page.getByRole("tab", { name: "度量" }).click();
  const chart = page.getByRole("figure", { name: "全景图表" });
  await expect(chart.getByRole("button", { name: `${a}：计数 1` })).toBeVisible();
  await expect(chart.getByRole("button", { name: `${b}：计数 1` })).toBeVisible();

  // 数据源去掉乙空间
  await page.getByRole("button", { name: "数据源" }).click();
  await page.getByRole("checkbox", { name: `空间 ${b}` }).click();
  await page.getByRole("button", { name: "确定" }).click();
  await expect(chart.getByRole("button", { name: `${b}：计数 1` })).toHaveCount(0);
  await page.getByRole("tab", { name: "表格" }).click();
  await expect(table.getByRole("link", { name: "面霜立项" })).toBeVisible();
  await expect(table.getByRole("link", { name: "精华立项" })).toHaveCount(0);
});
