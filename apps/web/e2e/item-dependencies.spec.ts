import { dayFromIso } from "@fp/engine";
import { expect, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  createSpace,
  openItems,
  openSettings,
  openTypeConfig,
  signUp,
  typeTab,
} from "./helpers";

test("dependencies added on a work item: wait for a node of another work item, and for one of its own", async ({
  page,
}) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `idep-${suffix}@example.com`);
  await createSpace(page, `工作项依赖 ${suffix}`);
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

  await openItems(page);
  await createItem(page, "面霜 B", { label: "立项名称" });
  await openItems(page);
  await createItem(page, "面霜 A", { label: "立项名称" });

  const card = (name: string) => panel.getByRole("region", { name, exact: true });
  const deps = (name: string) => panel.getByRole("group", { name: `${name}的依赖` });
  const form = panel.getByRole("form", { name: "添加依赖" });

  // 面霜 A 的采购：要等面霜 B 的设计完成才能完成
  await deps("采购").getByRole("button", { name: "添加依赖" }).click();
  await choose(form.getByLabel("依赖的工作项"), "面霜 B");
  await choose(form.getByLabel("依赖的节点"), "设计");
  // 采购已经开始了，只能选「才能完成」
  await expect(form.getByLabel("依赖类型")).toContainText("完成后才能完成");
  await form.getByRole("button", { name: "添加", exact: true }).click();
  await expect(deps("采购").getByRole("note")).toHaveText("要等「面霜 B · 设计」完成才能完成");
  await card("采购").getByRole("button", { name: "完成" }).click();
  await expect(page.getByText("节点「采购」要等「面霜 B · 设计」完成才能完成。")).toBeVisible();

  // 面霜 A 的发货：要等本工作项的设计完成才能开始；排期也跟着排到设计后面
  await node("发货").click();
  await deps("发货").getByRole("button", { name: "添加依赖" }).click();
  await choose(form.getByLabel("依赖的节点"), "设计");
  await form.getByRole("button", { name: "添加", exact: true }).click();
  await expect(deps("发货").getByRole("note")).toHaveText("要等「设计」完成才能开始");
  await page.getByRole("region", { name: "流程" }).getByRole("tab", { name: "甘特图" }).click();
  const day = async (name: string, label: string) =>
    dayFromIso(await page.getByRole("row", { name, exact: true }).getByLabel(label).inputValue());
  expect(await day("发货", "计划开始")).toBeGreaterThan(await day("设计", "计划结束"));
  await page.getByRole("region", { name: "流程" }).getByRole("tab", { name: "节点流程" }).click();

  // 去面霜 B 把设计完成：那边能看到谁在等它
  await deps("采购").getByRole("link", { name: "面霜 B" }).click();
  await expect(page.getByRole("heading", { name: "面霜 B" })).toBeVisible();
  await expect(deps("设计")).toContainText("在等这个节点的：面霜 A");
  await card("设计").getByRole("button", { name: "完成" }).click();
  await expect(card("设计")).toHaveCount(0);

  // 回到面霜 A：采购放行，可以完成了；发货还在等本工作项的设计
  await openItems(page);
  await page.getByRole("link", { name: "面霜 A" }).click();
  await expect(page.getByRole("heading", { name: "面霜 A" })).toBeVisible();
  await expect(deps("采购").getByRole("note")).toHaveCount(0);
  await expect(deps("采购")).toContainText("已完成");
  await card("采购").getByRole("button", { name: "完成" }).click();
  await expect(card("采购")).toHaveCount(0);
  await node("发货").click();
  await expect(deps("发货").getByRole("note")).toHaveText("要等「设计」完成才能开始");

  // 删掉这条依赖：发货马上开始
  await deps("发货").getByRole("button", { name: "删除依赖 设计" }).click();
  await expect(card("发货").getByRole("button", { name: "完成" })).toBeVisible();

  // 动态里记了加和删
  await page.getByRole("tablist", { name: "详情页签" }).getByRole("tab", { name: "动态" }).click();
  const activity = page.getByRole("list", { name: "动态列表" });
  await expect(activity).toContainText("给节点「采购」加了依赖：要等「面霜 B · 设计」完成才能完成");
  await expect(activity).toContainText("删除了节点「发货」对「设计」的依赖");
});
