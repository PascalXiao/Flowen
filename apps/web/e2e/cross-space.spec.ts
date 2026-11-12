import { expect, test } from "@playwright/test";
import {
  choose,
  createItem,
  createRelation,
  createSpace,
  demoSpace,
  importDemo,
  openItems,
  openSettings,
} from "./helpers";

test("relate work items across two spaces and keep a link rule in the other space", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `cross-${suffix}@example.com`, `研发 ${suffix}`);
  const spaceA = new URL(page.url()).pathname.split("/")[2];
  await createItem(page, "新品 A");

  await page.goto("/");
  await createSpace(page, `SKU ${suffix}`);
  await importDemo(page);
  await createItem(page, "SKU 一号");

  // 回到研发空间，建一条指向 SKU 空间「项目」的跨空间关系
  await page.goto(`/spaces/${spaceA}/project`);
  await createRelation(page, { from: "项目", to: `SKU ${suffix} / 项目`, name: "关联SKU", reverseName: "来源项目" });
  await page.getByRole("link", { name: "高级设置" }).click();
  await expect(page.getByRole("table", { name: "关系列表" }).getByRole("row", { name: /关联SKU/ })).toContainText(
    `项目 ↔ SKU ${suffix} / 项目`,
  );
  await expect(page.getByRole("table", { name: "关系列表" })).toContainText("跨空间");
  await page.getByRole("link", { name: "关闭" }).click();

  // 工作项上关联另一个空间的工作项，对方那一端也看得到
  await openItems(page);
  await page.getByRole("link", { name: "新品 A" }).click();
  const panel = page.getByRole("main");
  await choose(panel.getByRole("region", { name: "关联SKU" }).getByLabel("添加关联SKU"), { label: "SKU 一号" });
  await panel.getByRole("region", { name: "关联SKU" }).getByRole("link", { name: "SKU 一号" }).click();
  await expect(page.getByRole("heading", { name: "SKU 一号" })).toBeVisible();
  await expect(panel.getByRole("region", { name: "来源项目" }).getByRole("link", { name: "新品 A" })).toBeVisible();

  // SKU 空间也能在这条关系上建联动规则
  await openSettings(page, "空间关联");
  await page.getByRole("button", { name: "新建规则" }).click();
  const dialog = page.locator("[role=dialog][aria-modal=true]");
  await dialog.getByRole("textbox", { name: "规则名称" }).fill("立项提案排期同步");
  await choose(dialog.getByRole("combobox", { name: /^关联/ }), { label: `研发 ${suffix} / 项目 → 项目（关联SKU）` });
  await choose(dialog.getByRole("combobox", { name: "规则类型" }), { label: "排期同步" });
  await choose(dialog.getByRole("combobox", { name: "源节点" }), { label: "立项提案" });
  await choose(dialog.getByRole("combobox", { name: "目标节点" }), { label: "立项提案" });
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(
    page.getByRole("table", { name: "联动规则" }).getByRole("row", { name: "立项提案排期同步" }),
  ).toContainText(`研发 ${suffix} / 项目 →（关联SKU）→ 项目`);
});
