import { expect, test } from "@playwright/test";
import { createItem, oemSpace, openItems } from "./helpers";

test("global search finds work items by name and by comment text", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `search-${suffix}@example.com`, `搜索 ${suffix}`);
  await createItem(page, `面霜 ${suffix}`);
  await openItems(page);
  await createItem(page, `精华 ${suffix}`);
  await page.getByRole("tablist", { name: "详情页签" }).getByRole("tab", { name: /评论/ }).click();
  await page.getByLabel("评论内容").fill(`包材供应商定为 Acme${suffix}`);
  await page.getByRole("button", { name: "发表评论" }).click();
  await expect(page.getByRole("list", { name: "评论列表" })).toContainText(`Acme${suffix}`);

  // 按名称
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "搜索工作项" });
  await dialog.getByLabel("搜索关键字").fill(`面霜 ${suffix}`);
  const results = dialog.getByRole("list", { name: "搜索结果" });
  await expect(results.getByRole("button")).toHaveCount(1);
  await expect(results).toContainText(`面霜 ${suffix}`);
  await expect(results).toContainText(`搜索 ${suffix} · 项目`);

  // 按评论里的文字，回车打开
  await dialog.getByLabel("搜索关键字").fill(`acme${suffix}`);
  await expect(results).toContainText(`精华 ${suffix}`);
  await expect(results).toContainText(`评论：包材供应商定为 Acme${suffix}`);
  await dialog.getByLabel("搜索关键字").press("Enter");
  await expect(page.getByRole("heading", { name: `精华 ${suffix}` })).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // 没有结果
  await page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name: /搜索/ }).click();
  await dialog.getByLabel("搜索关键字").fill(`不存在的东西 ${suffix}`);
  await expect(dialog).toContainText("没有找到相关的工作项。");
});
