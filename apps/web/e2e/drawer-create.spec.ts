import { expect, test } from "@playwright/test";
import { demoSpace, openItems } from "./helpers";

test("create several items in a row, then step through them in the drawer", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `drawer-${suffix}@example.com`, `抽屉 ${suffix}`);
  await openItems(page);

  // 连续新建：建完留在表单里，名称清空
  await page.getByRole("button", { name: /^新建/ }).click();
  const dialog = page.locator("[role=dialog][aria-modal=true]");
  await dialog.getByText("连续新建").click();
  for (const name of ["新品 D1", "新品 D2", "新品 D3"]) {
    await dialog.getByLabel("项目名称").fill(name);
    await dialog.getByRole("button", { name: "创建" }).click();
    await expect(page.getByText(`已创建「${name}」`)).toBeVisible();
    await expect(dialog.getByLabel("项目名称")).toHaveValue("");
  }
  await dialog.getByRole("button", { name: "取消" }).click();

  // 列表按创建时间倒序：D3、D2、D1；点开 D3，在抽屉里往下翻
  const grid = page.getByRole("grid");
  await expect(grid.getByRole("row").filter({ hasText: "新品 D" })).toHaveCount(3);
  await grid.getByRole("link", { name: "新品 D3" }).click();
  const sheet = page.locator(".semi-sidesheet");
  await expect(sheet.getByRole("heading", { name: "新品 D3" })).toBeVisible();
  await expect(sheet.getByText("1 / 3")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "上一条" })).toBeDisabled();
  await sheet.getByRole("button", { name: "下一条" }).click();
  await expect(sheet.getByRole("heading", { name: "新品 D2" })).toBeVisible();
  await sheet.getByRole("button", { name: "下一条" }).click();
  await expect(sheet.getByRole("heading", { name: "新品 D1" })).toBeVisible();
  await expect(sheet.getByText("3 / 3")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "下一条" })).toBeDisabled();
  await sheet.getByRole("button", { name: "上一条" }).click();
  await expect(sheet.getByRole("heading", { name: "新品 D2" })).toBeVisible();
});
