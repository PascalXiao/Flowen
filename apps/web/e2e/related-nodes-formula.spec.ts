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
  selectByName,
  signUp,
  typeTab,
} from "./helpers";

test("a formula reads the flow type and node state of related work items", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `nodes-${suffix}@example.com`);
  await createSpace(page, `关联项的节点 ${suffix}`);
  await openSettings(page);
  for (const [name, mode] of [
    ["资料", "node"],
    ["总项", "state"],
  ] as const) {
    await page.getByLabel("新类型名称").fill(name);
    await choose(page.getByLabel("流程方式"), mode);
    await page.getByRole("button", { name: "新建类型" }).click();
    await expect(page.getByRole("list", { name: "工作项类型" })).toContainText(name);
  }

  // 资料：角色「开发」，流程 开始 → 产品手册（开发负责）
  await openTypeConfig(page, "资料");
  await typeTab(page, "角色");
  await page.getByLabel("新角色名称").fill("开发");
  await page.getByRole("button", { name: "添加角色" }).click();
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("手册流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "手册流程" }).click();
  const node = (name: string) => page.locator(".react-flow__node", { hasText: name });
  const editor = page.getByRole("main");
  await node("开始").click();
  await page.getByRole("button", { name: "添加节点" }).click();
  await editor.getByLabel("节点名称").fill("产品手册");
  await editor.getByLabel("开发", { exact: true }).check();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await closeTypeConfig(page);

  // 总项：状态流默认流程，加一个公式字段看关联资料里「产品手册」节点有没有完成
  await openTypeConfig(page, "总项");
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await page.goBack();
  await typeTab(page, "字段");
  await page.getByLabel("新字段名称").fill("手册是否完成");
  await choose(selectByName(page, "dataType"), "formula");
  await page
    .getByLabel("公式", { exact: true })
    .fill(
      'IF(COUNTIF(FILTER(RELATED("关联资料").节点, each.名称 = "产品手册"), each.状态 = "completed") > 0, "是", "否")',
    );
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("cell", { name: "手册是否完成", exact: true })).toBeVisible();
  await closeTypeConfig(page);
  await createRelation(page, { from: "总项", to: "资料", name: "关联资料" });

  // 建一个资料、一个总项，把资料关联到总项
  await openItems(page, "资料");
  await createItem(page, "资料 A", { label: "资料名称" });
  await openItems(page, "总项");
  await createItem(page, "总项 A", { label: "总项名称" });
  const group = page.getByRole("main").getByRole("region", { name: "关联资料" });
  await choose(group.getByLabel("添加关联资料"), { label: "资料 A" });
  const flag = page.getByRole("region", { name: "字段" }).getByLabel("手册是否完成");
  await expect(flag).toHaveValue("否");

  // 资料 A 的「产品手册」节点完成后，总项 A 的公式变成「是」
  await openItems(page, "资料");
  await page.getByRole("link", { name: "资料 A" }).click();
  await page
    .getByRole("main")
    .getByRole("region", { name: "产品手册" })
    .getByRole("button", { name: "确认完成" })
    .click();
  await expect(page.getByText("流程已走完。")).toBeVisible();
  await openItems(page, "总项");
  await page.getByRole("link", { name: "总项 A" }).click();
  await expect(page.getByRole("region", { name: "字段" }).getByLabel("手册是否完成")).toHaveValue("是", {
    timeout: 15_000,
  });
});
