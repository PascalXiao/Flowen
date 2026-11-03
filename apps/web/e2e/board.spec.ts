import { expect, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  createSpace,
  openSettings,
  openTypeConfig,
  signUp,
  typeTab,
} from "./helpers";

test("the board groups a status-flow type by status, and dragging a card follows its transitions", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `board-${suffix}@example.com`);
  await createSpace(page, `看板 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("任务");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "任务");
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("任务流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "任务流程" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  await closeTypeConfig(page);
  // 从左侧导航进入“任务”类型，建两个工作项
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "任务" }).click();
  await createItem(page, "写周报", { label: "任务名称" });
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "任务" }).click();
  await createItem(page, "整理需求", { label: "任务名称" });
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "任务" }).click();
  await page.getByRole("tab", { name: "看板" }).click();

  const column = (name: string) => page.getByRole("region", { name: `${name}列` });
  const card = (name: string) => page.getByRole("listitem", { name });
  await expect(column("待处理").getByRole("listitem")).toHaveCount(2);
  await expect(column("待处理")).toContainText("2");

  await card("写周报").dragTo(column("处理中"));
  await expect(column("处理中").getByRole("listitem", { name: "写周报" })).toBeVisible();
  await card("写周报").dragTo(column("已完成"));
  await expect(column("已完成").getByRole("listitem", { name: "写周报" })).toBeVisible();

  // 已完成不能直接回到待处理（流程里没有这条流转）
  await card("写周报").dragTo(column("待处理"));
  await expect(page.getByRole("alert")).toContainText("不能从「已完成」流转到「待处理」");
  await expect(column("已完成").getByRole("listitem", { name: "写周报" })).toBeVisible();
});
