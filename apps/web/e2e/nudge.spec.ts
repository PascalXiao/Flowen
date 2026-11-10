import { expect, test } from "@playwright/test";
import { addMember, createItem, oemSpace, openItems, registerColleague } from "./helpers";

test("flow diagram shows delays on hover and you can nudge a node's other owners", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await registerColleague(`lin-nudge-${suffix}@example.com`, "Lin");
  await oemSpace(page, "Pascal", `nudge-${suffix}@example.com`, `催办 ${suffix}`);
  await addMember(page, `lin-nudge-${suffix}@example.com`, "Lin");
  await openItems(page);
  await createItem(page, "新品 N", { roles: ["开发：Pascal", "开发：Lin"] });

  // 把进行中的需求立项提案排到过去，流程图上就显示延期
  const flow = page.getByRole("region", { name: "流程" });
  await flow.getByRole("tab", { name: "计划表" }).click();
  const row = page.getByRole("row", { name: "需求立项提案", exact: true });
  await row.getByLabel("计划开始").fill("2026-10-19");
  await row.getByLabel("计划结束").fill("2026-10-20");
  await expect(row.getByLabel("计划结束")).toHaveValue("2026-10-20");
  await flow.getByRole("tab", { name: "节点流程" }).click();
  const node = page.locator(".react-flow__node", { hasText: "需求立项提案" });
  await expect(node.getByText(/^延期 \d+ 天$/)).toBeVisible();

  // 悬停节点看到状态、负责人、计划和延期
  await node.getByText("需求立项提案", { exact: true }).hover();
  const card = page.locator(".semi-tooltip-content");
  await expect(card).toContainText("进行中");
  await expect(card).toContainText("Lin");
  await expect(card).toContainText("2026-10-19 → 2026-10-20");
  await expect(card).toContainText(/已延期 \d+ 天/);

  // 催一催：提醒其他负责人；10 分钟内再催会被拦下
  const current = page.getByRole("main").getByRole("region", { name: "需求立项提案" });
  await current.getByRole("button", { name: "催一催" }).click();
  await expect(page.getByText("已提醒负责人")).toBeVisible();
  await current.getByRole("button", { name: "催一催" }).click();
  await expect(page.getByText("10 分钟内已经催过了")).toBeVisible();
});
