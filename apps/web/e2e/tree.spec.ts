import { expect, test } from "@playwright/test";
import { choose, createItem, createRelation, oemSpace, openItems } from "./helpers";

test("the tree view nests work items by the chosen hierarchy and expands level by level", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `tree-${suffix}@example.com`, `树形 ${suffix}`);

  // “项目”上的“子项目”关联：新品 A → 新品 B → 新品 C
  await createRelation(page, { from: "项目", to: "项目", name: "子项目" });

  await openItems(page);
  for (const name of ["新品 A", "新品 B", "新品 C"]) {
    await createItem(page, name);
    await openItems(page);
  }
  for (const [from, to] of [
    ["新品 A", "新品 B"],
    ["新品 B", "新品 C"],
  ]) {
    await page.getByRole("link", { name: from }).click();
    const group = page.getByRole("main").getByRole("region", { name: "子项目" });
    await choose(group.getByLabel("添加子项目"), { label: to });
    await expect(group.getByRole("link", { name: to })).toBeVisible();
    await openItems(page);
  }

  await page.getByRole("tablist", { name: "显示方式" }).getByRole("tab", { name: "树形" }).click();
  const tree = page.getByRole("table", { name: "工作项树" });
  // 按子工作项分层时三个都是第一层
  await expect(tree.getByRole("link", { name: /^新品 [ABC]$/ })).toHaveCount(3);

  await choose(page.getByLabel("层级"), { label: "项目 → 项目（子项目）" });
  await expect(tree.getByRole("link", { name: /^新品 [ABC]$/ })).toHaveCount(1);
  await expect(tree.getByRole("link", { name: "新品 A" })).toBeVisible();
  await tree.getByRole("button", { name: "展开新品 A" }).click();
  await expect(tree.getByRole("link", { name: "新品 B" })).toBeVisible();
  await tree.getByRole("button", { name: "展开新品 B" }).click();
  await expect(tree.getByRole("link", { name: "新品 C" })).toBeVisible();
  await tree.getByRole("button", { name: "收起新品 A" }).click();
  await expect(tree.getByRole("link", { name: /^新品 [ABC]$/ })).toHaveCount(1);
});
