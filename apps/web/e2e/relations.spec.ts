import { expect, test } from "@playwright/test";
import { choose, createItem, createRelation, oemSpace, openItems } from "./helpers";

test("define a relation on a type and link two work items with it", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `relations-${suffix}@example.com`, `关联 ${suffix}`);

  // 在“项目”类型上定义“前置项目”：可以关联多个项目
  await createRelation(page, { from: "项目", to: "项目", name: "前置项目" });

  await openItems(page);
  for (const name of ["新品 A", "新品 B"]) {
    await createItem(page, name);
    await openItems(page);
  }

  // 新品 B 的前置项目选新品 A
  await page.getByRole("link", { name: "新品 B" }).click();
  const group = page.getByRole("main").getByRole("region", { name: "前置项目" });
  await choose(group.getByLabel("添加前置项目"), { label: "新品 A" });
  await expect(group.getByRole("link", { name: "新品 A" })).toBeVisible();

  // 新品 A 上能看到反向关联，点回新品 B 后取消关联
  await group.getByRole("link", { name: "新品 A" }).click();
  await expect(page.getByRole("heading", { name: "新品 A" })).toBeVisible();
  const backlinks = page.getByRole("main").getByRole("region", { name: "被关联" });
  await expect(backlinks).toContainText("新品 B（前置项目）");
  await backlinks.getByRole("link", { name: "新品 B" }).click();
  await expect(page.getByRole("heading", { name: "新品 B" })).toBeVisible();
  await group.getByRole("button", { name: "取消关联 新品 A" }).click();
  await expect(group.getByRole("link", { name: "新品 A" })).toHaveCount(0);

  // 刷新后仍然是取消后的状态：服务端也执行了
  await page.reload();
  await expect(group.getByLabel("添加前置项目")).toBeVisible();
  await expect(group.getByRole("link", { name: "新品 A" })).toHaveCount(0);
});
