import { dayFromIso, dayToIso, WorkCalendar } from "@fp/engine";
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

test("a node waits for a parallel node through a dependency and a schedule rule", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `deps-${suffix}@example.com`);
  await createSpace(page, `依赖 ${suffix}`);
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
  // 开始后面并行两个节点：设计、采购
  for (const name of ["设计", "采购"]) {
    await node("开始").click();
    await page.getByRole("button", { name: "添加节点" }).click();
    await panel.getByLabel("节点名称").fill(name);
    await panel.getByLabel("负责人", { exact: true }).check();
    await panel.getByLabel("预估工期（工作日）").fill("2");
  }
  // 采购：要等设计完成才能开始，并且在设计结束后 1 个工作日开始
  await panel.getByText("依赖和排期规则").click();
  await panel.getByRole("button", { name: "添加依赖" }).click();
  await choose(panel.getByLabel("依赖的节点"), "设计");
  await panel.getByRole("button", { name: "添加排期规则" }).click();
  await choose(panel.getByLabel("排期规则的节点"), "设计");
  await panel.getByLabel("排期规则间隔的工作日").fill("1");
  await expect(panel.getByText("没有发现问题，可以发布。")).toBeVisible();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  await closeTypeConfig(page);
  await openItems(page);
  await createItem(page, "面霜立项", { label: "立项名称" });

  // 排期：采购在设计结束后隔 1 个工作日开始
  await page.getByRole("region", { name: "流程" }).getByRole("tab", { name: "甘特图" }).click();
  const startOf = (name: string) => page.getByRole("row", { name, exact: true }).getByLabel("计划开始");
  const endOf = (name: string) => page.getByRole("row", { name, exact: true }).getByLabel("计划结束");
  const designEnd = dayFromIso(await endOf("设计").inputValue());
  await expect(startOf("采购")).toHaveValue(dayToIso(new WorkCalendar().addWorkdays(designEnd, 2)));
  // 甘特图上设计和采购都在关键路径上
  await expect(page.getByRole("row", { name: "采购", exact: true })).toContainText("关键");

  // 流程：采购没开始，提示在等设计；设计完成后采购开始
  await page.getByRole("region", { name: "流程" }).getByRole("tab", { name: "节点流程" }).click();
  await node("采购").click();
  await expect(panel.getByRole("note").filter({ hasText: "要等「设计」完成才能开始" })).toBeVisible();
  await panel.getByRole("region", { name: "设计" }).getByRole("button", { name: "完成" }).click();
  await expect(panel.getByRole("region", { name: "采购" }).getByRole("button", { name: "完成" })).toBeVisible();
});
