import { expect, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  createRelation,
  createSpace,
  openItems,
  openSettings,
  openTypeConfig,
  signUp,
  typeTab,
} from "./helpers";

test("a space link rule: the target node can only complete after the related source node", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `link-${suffix}@example.com`);
  await createSpace(page, `空间关联 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("立项");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "立项");
  await typeTab(page, "角色");
  await page.getByLabel("新角色名称").fill("负责人");
  await page.getByRole("button", { name: "添加角色" }).click();
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("立项流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "立项流程" }).click();
  await expect(page.getByText("v1 草稿")).toBeVisible();

  const node = (name: string) => page.locator(".react-flow__node", { hasText: name });
  const panel = page.getByRole("main");
  // 开始 → 设计、采购并行；采购 → 发货
  for (const [from, name] of [
    ["开始", "设计"],
    ["开始", "采购"],
    ["采购", "发货"],
  ] as const) {
    await node(from).click();
    await page.getByRole("button", { name: "添加节点" }).click();
    await panel.getByLabel("节点名称").fill(name);
    await panel.getByLabel("负责人", { exact: true }).check();
    await panel.getByLabel("预估工期（工作日）").fill("2");
  }
  await expect(panel.getByText("没有发现问题，可以发布。")).toBeVisible();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await closeTypeConfig(page);

  const card = (name: string) => panel.getByRole("region", { name, exact: true });
  const deps = (name: string) => panel.getByRole("group", { name: `${name}的依赖` });
  await createRelation(page, { from: "立项", to: "立项", name: "关联立项" });

  // 空间关联：沿「关联立项」，源头的设计完成后，对方的采购才允许完成
  await openSettings(page, "空间关联");
  await page.getByRole("button", { name: "新建规则" }).click();
  const dialog = page.locator("[role=dialog][aria-modal=true]");
  await dialog.getByRole("textbox", { name: "规则名称" }).fill("设计放行采购");
  await choose(dialog.getByRole("combobox", { name: "规则类型" }), { label: "节点驱动" });
  await choose(dialog.getByRole("combobox", { name: "源节点" }), { label: "设计" });
  await choose(dialog.getByRole("combobox", { name: "目标节点" }), { label: "采购" });
  await expect(dialog.getByRole("combobox", { name: "驱动方式" })).toContainText("才允许完成");
  await dialog.getByRole("button", { name: "确定" }).click();
  const row = page.getByRole("table", { name: "联动规则" }).getByRole("row", { name: "设计放行采购" });
  await expect(row).toContainText("「设计」完成后，「采购」才允许完成");
  await expect(row).toContainText("立项 →（关联立项）→ 立项");

  await openItems(page);
  await createItem(page, "面霜 B", { label: "立项名称" });
  await openItems(page);
  await createItem(page, "面霜 A", { label: "立项名称" });
  await choose(panel.getByRole("region", { name: "关联立项" }).getByLabel("添加关联立项"), { label: "面霜 B" });

  // 面霜 B 的采购要等面霜 A 的设计
  await panel.getByRole("region", { name: "关联立项" }).getByRole("link", { name: "面霜 B" }).click();
  await expect(page.getByRole("heading", { name: "面霜 B" })).toBeVisible();
  await expect(deps("采购").getByRole("note")).toHaveText("要等「面霜 A · 设计」完成才能完成");
  await expect(deps("采购")).toContainText("空间关联");
  await card("采购").getByRole("button", { name: "完成" }).click();
  await expect(page.getByText("节点「采购」要等「面霜 A · 设计」完成才能完成。")).toBeVisible();

  // 面霜 A 的设计完成后，面霜 B 的采购可以完成了
  await openItems(page);
  await page.getByRole("link", { name: "面霜 A" }).click();
  await card("设计").getByRole("button", { name: "完成" }).click();
  await expect(card("设计")).toHaveCount(0);
  await openItems(page);
  await page.getByRole("link", { name: "面霜 B" }).click();
  await expect(deps("采购").getByRole("note")).toHaveCount(0);
  await card("采购").getByRole("button", { name: "完成" }).click();
  await expect(card("采购")).toHaveCount(0);
});
