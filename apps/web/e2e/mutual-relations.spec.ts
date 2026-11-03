import { expect, test } from "@playwright/test";
import { choose, createItem, createRelation, oemSpace, openItems } from "./helpers";

test("a mutual relation has a field on both work items, editable from either side", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `mutual-${suffix}@example.com`, `互相关联 ${suffix}`);

  // 关联「前置项目」，另一端叫「后续项目」，另一端一个项目最多被一个项目当作后续
  await createRelation(page, { from: "项目", to: "项目", name: "前置项目", reverseName: "后续项目" });

  await openItems(page);
  for (const name of ["新品 A", "新品 B"]) {
    await createItem(page, name);
    await openItems(page);
  }

  // 在新品 B 上把前置项目设成新品 A
  await page.getByRole("link", { name: "新品 B" }).click();
  const forward = page.getByRole("main").getByRole("region", { name: "前置项目" });
  await choose(forward.getByLabel("添加前置项目"), { label: "新品 A" });
  await expect(forward.getByRole("link", { name: "新品 A" })).toBeVisible();

  // 新品 A 上出现「后续项目」字段，里面是新品 B
  await forward.getByRole("link", { name: "新品 A" }).click();
  await expect(page.getByRole("heading", { name: "新品 A" })).toBeVisible();
  const reverse = page.getByRole("main").getByRole("region", { name: "后续项目" });
  await expect(reverse.getByRole("link", { name: "新品 B" })).toBeVisible();

  // 从新品 A 这一端取消，新品 B 的前置项目也空了
  await reverse.getByRole("button", { name: "取消关联 新品 B" }).click();
  await expect(reverse.getByRole("link", { name: "新品 B" })).toHaveCount(0);
  await openItems(page);
  await page.getByRole("link", { name: "新品 B" }).click();
  await expect(
    page.getByRole("main").getByRole("region", { name: "前置项目" }).getByRole("link", { name: "新品 A" }),
  ).toHaveCount(0);
});
