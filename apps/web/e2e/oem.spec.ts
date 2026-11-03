import { expect, test } from "@playwright/test";
import { addMember, createItem, oemSpace, openItems, registerColleague } from "./helpers";

test("sign up, import OEM, create a project and see its flow", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await oemSpace(page, "Pascal", `pascal-${suffix}@example.com`, `OEM 验收 ${suffix}`);

  await createItem(page, "新品 A");
  await expect(page.getByText("概念阶段")).toBeVisible();
  const panel = page.getByRole("main");
  const proposal = panel.getByRole("region", { name: "需求立项提案" });
  await expect(proposal).toBeVisible();
  await expect(proposal.getByText("Pascal", { exact: true })).toBeVisible();

  // 卡点：关联需求 SKU 没填时不能确认
  await proposal.getByRole("button", { name: "确认完成" }).click();
  await expect(page.getByRole("alert")).toContainText("流转条件还没满足");
  await panel.getByLabel("关联需求SKU流程").fill("SKU-001");
  await panel.getByLabel("关联需求SKU流程").blur();
  await proposal.getByRole("button", { name: "确认完成" }).click();
  await expect(panel.getByRole("region", { name: "财务分析（需求立项）" })).toBeVisible();
  await expect(proposal).toHaveCount(0);

  // 在流程图上选中已完成的节点，回滚到它
  await page.locator(".react-flow__node", { hasText: "需求立项提案" }).click();
  await panel.getByRole("button", { name: "回滚到此节点" }).click();
  await expect(proposal).toBeVisible();
  await expect(panel.getByRole("region", { name: "财务分析（需求立项）" })).toHaveCount(0);

  // 刷新后数据仍在：来自服务端，而不只是浏览器里的乐观写入
  await page.reload();
  await expect(proposal).toBeVisible();
  await openItems(page);
  await expect(page.getByRole("link", { name: "新品 A" })).toBeVisible();
});

test("add a colleague to the space and assign them a role", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await registerColleague(`lin-${suffix}@example.com`, "Lin");
  await oemSpace(page, "Pascal", `pascal-${suffix}@example.com`, `OEM 验收 ${suffix}`);
  await addMember(page, `lin-${suffix}@example.com`, "Lin");
  await openItems(page);

  await createItem(page, "新品 B", { roles: ["开发：Pascal", "开发：Lin"] });
  const panel = page.getByRole("main");
  const proposal = panel.getByRole("region", { name: "需求立项提案" });
  await expect(proposal.getByText("Pascal", { exact: true })).toBeVisible();
  await expect(proposal.getByText("Lin", { exact: true })).toBeVisible();

  // 在工作项上把开发换回 Pascal，进行中的节点负责人跟着变
  await panel.getByRole("button", { name: "设置开发" }).click();
  await page.getByRole("button", { name: "开发：Lin" }).click();
  await expect(page.getByRole("button", { name: "开发：Lin" })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(proposal.getByText("Lin", { exact: true })).toHaveCount(0);
  await expect(proposal.getByText("Pascal", { exact: true })).toBeVisible();
});
