import { expect, type Page, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  createRelation,
  createSpace,
  openItems,
  openSettings,
  openTypeConfig,
  signUp,
  typeTab,
} from "./helpers";

/** 建一个状态流类型，发布默认流程。 */
async function stateType(page: Page, name: string) {
  await page.getByLabel("新类型名称").fill(name);
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await expect(page.getByRole("list", { name: "工作项类型" })).toContainText(name);
  await openTypeConfig(page, name);
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await page.goBack();
  await closeTypeConfig(page);
}

test("configure a hierarchy across relations and expand the tree view by it", async ({ page }) => {
  test.setTimeout(90_000);
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `hier-${suffix}@example.com`);
  await createSpace(page, `层级 ${suffix}`);
  await openSettings(page);
  for (const name of ["项目", "需求", "任务"]) await stateType(page, name);
  // 项目 → 需求；任务 → 需求（从需求往下找任务是反方向）；需求 → 需求（子需求）
  await createRelation(page, { from: "项目", to: "需求", name: "包含需求" });
  await createRelation(page, { from: "任务", to: "需求", name: "所属需求" });
  await createRelation(page, { from: "需求", to: "需求", name: "子需求" });

  // 层级管理：项目 → 需求 → 子需求（循环）→ 任务
  await page.getByRole("link", { name: "高级设置" }).click();
  await page.getByRole("tablist", { name: "高级设置" }).getByRole("tab", { name: "层级管理" }).click();
  await page.getByRole("button", { name: "新建层级" }).click();
  const dialog = page.locator("[role=dialog][aria-modal=true]");
  await dialog.getByRole("textbox", { name: "层级名称" }).fill("项目拆解");
  await choose(dialog.getByRole("combobox", { name: /^第一层工作项/ }), { label: "项目" });
  await dialog.getByRole("button", { name: "确定" }).click();
  const card = page.getByRole("listitem", { name: "项目拆解" });
  const form = card.getByRole("form", { name: "新增下一层级" });
  for (const [option, loop] of [
    ["包含需求 → 需求", false],
    ["子需求 → 需求", true],
    ["所属需求（反向） → 任务", false],
  ] as const) {
    await card.getByRole("button", { name: "新增下一层级" }).click();
    await choose(form.getByLabel("下一层级"), { label: option });
    if (loop) await form.getByLabel("层级循环").click();
    await form.getByRole("button", { name: "添加", exact: true }).click();
    await expect(form).toHaveCount(0);
  }
  const layers = card.getByRole("list", { name: "项目拆解的层级" });
  await expect(layers).toContainText("第 4 层任务");
  await expect(layers).toContainText("循环");
  // 层级里用到的关系不能删
  await page.getByRole("tablist", { name: "高级设置" }).getByRole("tab", { name: "关系管理" }).click();
  await page.getByRole("button", { name: "删除关系 所属需求" }).click();
  await expect(page.getByText("层级「项目拆解」用到了这条关系")).toBeVisible();
  await page.getByRole("link", { name: "关闭" }).click();

  // 数据：项目 P 包含需求 S1，S1 的子需求 S2，任务 T 属于 S2
  await openItems(page, "需求");
  await createItem(page, "需求 S2", { label: "需求名称" });
  await openItems(page, "需求");
  await createItem(page, "需求 S1", { label: "需求名称" });
  await choose(page.getByRole("main").getByRole("region", { name: "子需求" }).getByLabel("添加子需求"), {
    label: "需求 S2",
  });
  await openItems(page, "任务");
  await createItem(page, "任务 T", { label: "任务名称" });
  await choose(page.getByRole("main").getByRole("region", { name: "所属需求" }).getByLabel("添加所属需求"), {
    label: "需求 S2",
  });
  await openItems(page, "项目");
  await createItem(page, "项目 P", { label: "项目名称" });
  const contains = page.getByRole("main").getByRole("region", { name: "包含需求" });
  await choose(contains.getByLabel("添加包含需求"), { label: "需求 S1" });
  await expect(contains.getByRole("link", { name: "需求 S1" })).toBeVisible();

  // 树形视图默认按「项目拆解」：项目 P → 需求 S1 → 需求 S2 → 任务 T
  await openItems(page, "项目");
  await page.getByRole("tablist", { name: "显示方式" }).getByRole("tab", { name: "树形" }).click();
  await expect(page.getByLabel("层级")).toContainText("项目拆解");
  const tree = page.getByRole("table", { name: "工作项树" });
  await expect(tree.getByRole("link")).toHaveCount(1);
  await tree.getByRole("button", { name: "展开项目 P" }).click();
  await tree.getByRole("button", { name: "展开需求 S1" }).click();
  await tree.getByRole("button", { name: "展开需求 S2" }).click();
  await expect(tree.getByRole("link", { name: "任务 T" })).toBeVisible();
  await expect(tree.getByRole("link")).toHaveCount(4);
  await tree.getByRole("button", { name: "收起项目 P" }).click();
  await expect(tree.getByRole("link")).toHaveCount(1);
});
