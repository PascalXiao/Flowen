import { expect, test } from "@playwright/test";
import { createItem, demoSpace, openItems } from "./helpers";

test("the space gantt shows one bar per work item and expands into its nodes", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `space-gantt-${suffix}@example.com`, `排期总览 ${suffix}`);
  for (const name of ["新品 E", "新品 F"]) {
    await createItem(page, name);
    await openItems(page);
  }

  await page.getByRole("tab", { name: "甘特图" }).click();
  const chart = page.getByRole("img", { name: "甘特图" });
  await expect(chart).toBeVisible();
  const itemE = page.getByRole("button", { name: "新品 E" });
  await expect(itemE).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "新品 F" })).toBeVisible();
  await expect(page.getByTitle("立项提案")).toHaveCount(0);

  await itemE.click();
  await expect(itemE).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTitle("立项提案")).toHaveCount(1);
  await expect(page.getByTitle("财务分析（立项）")).toBeVisible();

  await itemE.click();
  await expect(page.getByTitle("立项提案")).toHaveCount(0);
});
