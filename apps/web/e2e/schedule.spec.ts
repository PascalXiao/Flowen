import { expect, test } from "@playwright/test";
import { createItem, demoSpace, openItems } from "./helpers";

test("people schedule lists each owner's planned nodes on a shared timeline", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `schedule-${suffix}@example.com`, `人员排期 ${suffix}`);
  for (const name of ["面霜立项", "精华立项"]) {
    await openItems(page, "项目");
    await createItem(page, name, { roles: ["开发：Pascal"] });
  }

  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "人员排期" }).click();
  const people = page.getByRole("table", { name: "排期人员" });
  const row = people.getByRole("row").filter({ hasText: "Pascal" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("cell").nth(1)).not.toHaveText("0");

  // 甘特图：每人一组，展开是他负责的节点，可以收起
  await expect(page.getByRole("img", { name: "甘特图" })).toBeVisible();
  const group = page.getByRole("button", { name: /Pascal · \d+ 项/ });
  await expect(group).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTitle(/^面霜立项 · /).first()).toBeVisible();
  await expect(page.getByTitle(/^精华立项 · /).first()).toBeVisible();
  await group.click();
  await expect(page.getByTitle(/^面霜立项 · /)).toHaveCount(0);
});
