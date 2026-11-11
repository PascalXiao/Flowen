import { expect, test } from "@playwright/test";
import {
  addMember,
  choose,
  closeTypeConfig,
  createItem,
  createSpace,
  demoSpace,
  openItems,
  openSettings,
  openTypeConfig,
  registerColleague,
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

test("board swimlanes by role and extra fields on cards", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await registerColleague(`lin-lanes-${suffix}@example.com`, "Lin");
  await demoSpace(page, "Pascal", `lanes-${suffix}@example.com`, `泳道 ${suffix}`);
  await addMember(page, `lin-lanes-${suffix}@example.com`, "Lin");
  await openItems(page);
  await createItem(page, "新品 L1", { roles: ["开发：Lin"] });
  await openItems(page);
  await createItem(page, "新品 L2");
  await openItems(page);
  await page.getByRole("tab", { name: "看板" }).click();

  await choose(page.getByLabel("泳道"), { label: "角色：开发" });
  const lane = (name: string) => page.getByRole("region", { name: `泳道 ${name}` });
  await expect(lane("Lin").getByRole("listitem", { name: "新品 L1" })).toBeVisible();
  await expect(lane("Lin").getByRole("listitem", { name: "新品 L2" })).toHaveCount(0);
  await expect(lane("Pascal").getByRole("listitem", { name: "新品 L2" })).toBeVisible();

  // 折叠泳道
  await lane("Pascal")
    .getByRole("button", { name: /Pascal/ })
    .click();
  await expect(lane("Pascal").getByRole("listitem")).toHaveCount(0);

  // 卡片上加字段
  await page.getByRole("button", { name: "卡片字段" }).click();
  await page.getByRole("group", { name: "卡片字段" }).getByRole("checkbox", { name: "是否需要认证" }).check();
  await expect(lane("Lin").getByRole("listitem", { name: "新品 L1" })).toContainText("是否需要认证");

  // 设置记在本机：刷新后还在
  await page.reload();
  await page.getByRole("tab", { name: "看板" }).click();
  await expect(lane("Lin").getByRole("listitem", { name: "新品 L1" })).toContainText("是否需要认证");
});
