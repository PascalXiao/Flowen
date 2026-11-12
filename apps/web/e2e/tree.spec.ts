import { expect, test } from "@playwright/test";
import { choose, createItem, createRelation, demoSpace, openItems } from "./helpers";

test("the tree view nests work items by the chosen hierarchy and expands level by level", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `tree-${suffix}@example.com`, `树形 ${suffix}`);

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

  // 排期管理模式：右边是时间轴，每个工作项一条排期条（节点默认从今天开始排）
  await page.getByRole("group", { name: "显示模式" }).getByRole("button", { name: "排期管理" }).click();
  await expect(tree.getByRole("img", { name: /^新品 A排期 \d{4}-\d{2}-\d{2} ~ / })).toBeVisible();
  await tree.getByRole("button", { name: "展开新品 A" }).click();
  await expect(tree.getByRole("img", { name: /^新品 B排期 / })).toBeVisible();
  // 往后翻远了排期条就不在时间轴上了，点「今天」回来
  for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "往后" }).click();
  await expect(tree.getByRole("img", { name: /^新品 A排期 / })).toHaveCount(0);
  await page.getByRole("button", { name: "今天" }).click();
  await expect(tree.getByRole("img", { name: /^新品 A排期 / })).toBeVisible();
  await choose(page.getByLabel("时间刻度"), "month");
  await expect(tree.getByRole("img", { name: /^新品 A排期 / })).toBeVisible();
  // 回到表格模式
  await page.getByRole("group", { name: "显示模式" }).getByRole("button", { name: "表格" }).click();
  await expect(tree.getByRole("img", { name: /排期/ })).toHaveCount(0);
});
