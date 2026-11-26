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

  // 同步创建：在 SKU 空间新建一个 SKU 并直接关联上
  await page.getByRole("link", { name: "新品 A" }).click();
  await panel.getByRole("button", { name: "新建关联SKU" }).click();
  const createLinked = page.locator("[role=dialog][aria-modal=true]");
  await expect(createLinked).toContainText("新工作项会建在那个空间里");
  await createLinked.getByRole("textbox", { name: "新工作项名称" }).fill("SKU 二号");
  await createLinked.getByRole("button", { name: "创建并关联" }).click();
  await panel.getByRole("region", { name: "关联SKU" }).getByRole("link", { name: "SKU 二号" }).click();
  await expect(page.getByRole("heading", { name: "SKU 二号" })).toBeVisible();
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

  // 层级可以沿跨空间关联走进 SKU 空间：研发空间的项目 →（关联SKU）→ SKU 空间的项目
  await page.goto(`/spaces/${spaceA}/project`);
  await openSettings(page);
  await page.getByRole("link", { name: "高级设置" }).click();
  await page.getByRole("tablist", { name: "高级设置" }).getByRole("tab", { name: "层级管理" }).click();
  await page.getByRole("button", { name: "新建层级" }).click();
  const create = page.locator("[role=dialog][aria-modal=true]");
  await create.getByRole("textbox", { name: "层级名称" }).fill("项目到 SKU");
  await choose(create.getByRole("combobox", { name: /^第一层工作项/ }), { label: "项目" });
  await create.getByRole("button", { name: "确定" }).click();
  const card = page.getByRole("listitem", { name: "项目到 SKU" });
  await card.getByRole("button", { name: "新增下一层级" }).click();
  const form = card.getByRole("form", { name: "新增下一层级" });
  await choose(form.getByLabel("下一层级"), { label: `关联SKU → SKU ${suffix} / 项目` });
  await form.getByRole("button", { name: "添加", exact: true }).click();
  await expect(card.getByRole("list", { name: "项目到 SKU的层级" })).toContainText(`第 2 层SKU ${suffix} / 项目`);
  await page.getByRole("link", { name: "关闭" }).click();

  // 树形视图按这个层级展开，SKU 空间的工作项带着空间名
  await openItems(page, "项目");
  await page.getByRole("tablist", { name: "显示方式" }).getByRole("tab", { name: "树形" }).click();
  await expect(page.getByLabel("层级")).toContainText("项目到 SKU");
  const tree = page.getByRole("table", { name: "工作项树" });
  await tree.getByRole("button", { name: "展开新品 A" }).click();
  const sku = tree.getByRole("row", { name: /SKU 一号/ });
  await expect(sku).toContainText(`SKU ${suffix}`);
  await sku.getByRole("link", { name: "SKU 一号" }).click();
  await expect(page.getByRole("heading", { name: "SKU 一号" })).toBeVisible();

  // 全景视图的树形模式也能按这个层级跨空间展开，每一行带着所属空间
  await page.goto("/panorama");
  await page.getByRole("tablist", { name: "展示模式" }).getByRole("tab", { name: "树形" }).click();
  await choose(page.getByLabel("层级"), { label: `研发 ${suffix} / 项目到 SKU` });
  const panorama = page.getByRole("table", { name: "工作项树" });
  await panorama.getByRole("button", { name: "展开新品 A" }).click();
  await expect(panorama.getByRole("row", { name: /新品 A/ })).toContainText(`研发 ${suffix}`);
  await expect(panorama.getByRole("row", { name: /SKU 一号/ })).toContainText(`SKU ${suffix}`);

  // 列表里勾选后批量同步创建：每个勾选的项目在 SKU 空间建一个同名 SKU 并关联
  await page.goto(`/spaces/${spaceA}/project`);
  await openItems(page, "项目");
  await createItem(page, "新品 B");
  await openItems(page, "项目");
  const grid = page.getByRole("grid");
  await grid.getByRole("row").filter({ hasText: "新品 B" }).getByRole("checkbox").check();
  const bar = page.getByRole("group", { name: "批量操作" });
  await bar.getByRole("button", { name: "同步创建" }).click();
  await choose(page.getByLabel("沿哪个关联新建"), { label: `关联SKU → SKU ${suffix} / 项目` });
  await page.getByRole("button", { name: "创建 1 项" }).click();
  await expect(page.getByText("已同步创建 1 项")).toBeVisible();
  await page.getByRole("link", { name: "新品 B" }).first().click();
  await expect(
    page.getByRole("main").getByRole("region", { name: "关联SKU" }).getByRole("link", { name: "新品 B" }),
  ).toBeVisible();
});
