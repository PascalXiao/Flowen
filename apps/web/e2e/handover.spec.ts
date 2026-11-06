import { expect, test } from "@playwright/test";
import { addMember, choose, createItem, oemSpace, openItems, openSettings, registerColleague } from "./helpers";

test("an admin hands over a member's work to someone else", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await registerColleague(`lin-h-${suffix}@example.com`, "Lin");
  await oemSpace(page, "Pascal", `handover-${suffix}@example.com`, `移交 ${suffix}`);
  await addMember(page, `lin-h-${suffix}@example.com`, "Lin");
  for (const name of ["面霜立项", "精华立项"]) {
    await openItems(page, "项目");
    await createItem(page, name, { roles: ["开发：Pascal"] });
  }
  await openItems(page, "项目");
  const grid = page.getByRole("grid");
  await expect(grid.getByRole("row").filter({ hasText: "面霜立项" })).toContainText("Pascal");

  await openSettings(page, "权限");
  const card = page
    .locator("div")
    .filter({ has: page.getByText("工作移交", { exact: true }) })
    .last();
  await choose(page.getByLabel("移交人"), { label: "Pascal" });
  await expect(page.getByText("Pascal 在 2 个进行中的工作项里担任角色")).toBeVisible();
  await choose(page.getByLabel("接手人"), { label: "Lin" });
  await page.getByRole("button", { name: "移交", exact: true }).click();
  await page.locator(".semi-popconfirm").getByRole("button", { name: "移交" }).click();
  await expect(page.getByText("已把 Pascal 的工作移交给 Lin")).toBeVisible();

  await openItems(page, "项目");
  for (const name of ["面霜立项", "精华立项"]) {
    const row = grid.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("Lin");
    await expect(row.locator('[data-cell="当前负责人"]')).not.toContainText("Pascal");
  }
});
