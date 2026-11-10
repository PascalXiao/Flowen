import { dayInTimeZone, dayToIso, WorkCalendar } from "@fp/engine";
import { expect, test } from "@playwright/test";
import { createItem, oemSpace } from "./helpers";

test("plan table: critical path, save a baseline, see the slip after a delay, delete it", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `plan-${suffix}@example.com`, `计划表 ${suffix}`);
  await createItem(page, "新品 P");

  await page.getByRole("region", { name: "流程" }).getByRole("tab", { name: "甘特图" }).click();
  const toolbar = page.getByRole("toolbar", { name: "甘特图工具栏" });
  const row = (name: string) => page.getByRole("row", { name, exact: true });

  // 关键路径默认打开：至少有一个节点标「关键」，它的余量是 0 天
  const critical = page.locator("details tbody tr").filter({ hasText: "关键" });
  await expect(critical.first()).toBeVisible();
  await expect(critical.first().getByLabel("余量")).toHaveText("0 天");
  await toolbar.getByLabel("显示关键路径").click();
  await expect(critical).toHaveCount(0);
  await toolbar.getByLabel("显示关键路径").click();

  // 存为基线，自动选中它对比：现在和基线持平
  await toolbar.getByRole("button", { name: "存为基线" }).click();
  await toolbar.getByLabel("基线名称").fill("立项");
  await toolbar.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已存为基线「立项」")).toBeVisible();
  await expect(toolbar.getByLabel("对比基线")).toContainText("立项");
  await expect(toolbar.getByLabel("整体偏差")).toContainText("持平");

  // 需求立项提案往后推两个月：它和后面的节点比基线晚，整体也晚
  const calendar = new WorkCalendar();
  const later = calendar.onOrAfter(dayInTimeZone(Date.now(), "Asia/Shanghai") + 60);
  await row("需求立项提案").getByLabel("计划开始").fill(dayToIso(later));
  await expect(row("需求立项提案").getByLabel("偏差")).toContainText("晚");
  await expect(toolbar.getByLabel("整体偏差")).toContainText("晚");

  // 删除基线：回到不对比
  await toolbar.getByRole("button", { name: "删除基线" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByText("已删除基线")).toBeVisible();
  await expect(toolbar.getByLabel("对比基线")).toContainText("不对比");
  await expect(toolbar.getByLabel("整体偏差")).toHaveCount(0);

  // 动态里记了存和删
  await page.getByRole("tablist", { name: "详情页签" }).getByRole("tab", { name: "动态" }).click();
  const activity = page.getByRole("list", { name: "动态列表" });
  await expect(activity).toContainText("Pascal 存了计划基线「立项」");
  await expect(activity).toContainText("Pascal 删除了计划基线「立项」");
});
