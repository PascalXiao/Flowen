import { expect, test } from "@playwright/test";
import { choose, createItem, oemSpace, openItems } from "./helpers";

test("build metric charts: preview while editing, save, drill down, switch style, delete", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `metrics-${suffix}@example.com`, `度量 ${suffix}`);
  for (const name of ["面霜立项", "精华立项"]) {
    await openItems(page, "项目");
    await createItem(page, name);
  }

  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "度量" }).click();
  await expect(page.getByText("还没有图表")).toBeVisible();

  // 按阶段分组的柱状图：编辑时实时预览
  await page.getByRole("button", { name: "新建图表" }).first().click();
  const dialog = page.locator("[role=dialog][aria-modal=true]");
  await dialog.getByLabel("图表名称").fill("项目阶段分布");
  await choose(dialog.getByLabel("数据来源"), { label: "项目" });
  await choose(dialog.getByLabel("分组维度"), "stage");
  const preview = dialog.getByRole("figure", { name: "项目阶段分布预览" });
  await expect(preview.getByRole("button", { name: /计数 2$/ })).toBeVisible();
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toBeHidden();

  const card = page.getByRole("region", { name: "项目阶段分布" });
  await expect(card.getByText("项目 · 计数")).toBeVisible();
  await expect(
    card.getByRole("figure", { name: "项目阶段分布" }).getByRole("button", { name: /计数 2$/ }),
  ).toBeVisible();

  // 钻取：点柱子看构成它的工作项
  await card
    .getByRole("figure", { name: "项目阶段分布" })
    .getByRole("button", { name: /计数 2$/ })
    .click();
  const detail = page.getByRole("table", { name: "明细" });
  await expect(detail.getByRole("link", { name: "面霜立项" })).toBeVisible();
  await expect(detail.getByRole("link", { name: "精华立项" })).toBeVisible();
  await expect(dialog.getByText("共 2 个工作项")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();

  // 指标卡
  await page.getByRole("button", { name: "新建图表" }).first().click();
  await dialog.getByLabel("图表名称").fill("项目总数");
  await choose(dialog.getByLabel("数据来源"), { label: "项目" });
  await dialog.getByRole("tab", { name: "指标卡" }).click();
  await dialog.getByRole("button", { name: "保存" }).click();
  const total = page.getByRole("region", { name: "项目总数" });
  await expect(total.getByText("共 2 个工作项")).toBeVisible();

  // 改成按状态的环形图
  await card.hover();
  await card.getByRole("button", { name: "编辑图表 项目阶段分布" }).click();
  await dialog.getByRole("tab", { name: "环形图" }).click();
  await choose(dialog.getByLabel("分组维度"), "status");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(card.getByRole("list", { name: "图例" }).getByText("进行中")).toBeVisible();

  // 删除
  await total.hover();
  await total.getByRole("button", { name: "删除图表 项目总数" }).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(total).toBeHidden();
});
