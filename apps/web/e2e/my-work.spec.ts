import { expect, test } from "@playwright/test";
import { createItem, oemSpace } from "./helpers";

test("my work lists the nodes I own and the tasks assigned to me, grouped by due date", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `mywork-${suffix}@example.com`, `我的工作 ${suffix}`);
  await createItem(page, "新品 W");

  // 在进行中的节点上加一个已经过了截止日期的子任务，指派给自己
  const current = page.getByRole("main").getByRole("region", { name: "需求立项提案" });
  await current.getByLabel("给需求立项提案添加子任务").fill("准备立项材料");
  await current.getByLabel("给需求立项提案添加子任务").press("Enter");
  await current.getByLabel("准备立项材料的截止日期").fill("2020-01-02");
  await current.getByRole("button", { name: "准备立项材料的负责人" }).click();
  await page.getByRole("button", { name: "Pascal" }).click();
  await page.keyboard.press("Escape");

  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "我的工作" }).click();
  await expect(page.getByRole("heading", { name: "我的工作" })).toBeVisible();
  const node = page.getByRole("listitem", { name: "需求立项提案" });
  await expect(node).toContainText("新品 W");
  await expect(node).toContainText("节点");
  const overdue = page.getByRole("list", { name: "已逾期" });
  await expect(overdue.getByRole("listitem", { name: "准备立项材料" })).toContainText("2020-01-02");

  await page.getByRole("tab", { name: "子任务" }).click();
  await expect(node).toHaveCount(0);

  // 勾掉子任务后它从列表里消失；节点还在
  await overdue.getByLabel("完成子任务：准备立项材料").click();
  await expect(page.getByRole("listitem", { name: "准备立项材料" })).toHaveCount(0);
  await page.getByRole("tab", { name: "全部" }).click();
  await expect(node).toBeVisible();

  await node.getByRole("link", { name: /新品 W/ }).click();
  await expect(page.getByRole("heading", { name: "新品 W" })).toBeVisible();
});
