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

test("a node with a conclusion and a custom button; the next node sets the status when it starts", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `nodecfg-${suffix}@example.com`);
  await createSpace(page, `节点配置 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("立项");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "立项");
  await typeTab(page, "角色");
  await page.getByLabel("新角色名称").fill("评审人");
  await page.getByRole("button", { name: "添加角色" }).click();
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("立项流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "立项流程" }).click();
  await expect(page.getByText("v1 草稿")).toBeVisible();

  const node = (name: string) => page.locator(".react-flow__node", { hasText: name });
  const panel = page.getByRole("main");
  await node("开始").click();
  await page.getByRole("button", { name: "添加节点" }).click();
  await panel.getByLabel("节点名称").fill("评审");
  await panel.getByLabel("评审人", { exact: true }).check();
  // 完成结论：已通过 / 未通过；自定义按钮「通过」带着「已通过」完成节点
  await panel.getByText("完成结论", { exact: true }).click();
  await panel.getByRole("button", { name: "启用完成结论" }).click();
  await panel.getByText("自定义按钮", { exact: true }).click();
  await panel.getByRole("button", { name: "添加按钮" }).click();
  await panel.getByLabel("按钮名称").fill("通过");
  await choose(panel.getByLabel("通过 的结论"), { label: "结论：已通过" });

  await page.getByRole("button", { name: "添加节点" }).click();
  await panel.getByLabel("节点名称").fill("上线");
  await panel.getByLabel("评审人", { exact: true }).check();
  await panel.getByText("节点到达时", { exact: true }).click();
  await panel.getByRole("button", { name: "改状态" }).first().click();
  await panel.getByLabel("到达时改成的状态").fill("上线中");
  await expect(panel.getByText("没有发现问题，可以发布。")).toBeVisible();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  await closeTypeConfig(page);
  await openItems(page);
  await createItem(page, "面霜立项", { label: "立项名称" });
  const review = panel.getByRole("region", { name: "评审" });
  await review.getByRole("button", { name: "通过" }).click();
  await expect(node("评审")).toContainText("已通过");
  await expect(page.getByRole("heading", { name: "面霜立项" }).locator("..")).toContainText("上线中");
});
