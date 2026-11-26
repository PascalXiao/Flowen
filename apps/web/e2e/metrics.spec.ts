import { expect, test } from "@playwright/test";
import { choose, createItem, demoSpace, openItems } from "./helpers";

test("build metric charts: preview while editing, save, drill down, pin to dashboard, switch style, delete", async ({
  page,
}) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `metrics-${suffix}@example.com`, `度量 ${suffix}`);
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

  // 放到仪表盘：仪表盘上出现同一张图
  await card.hover();
  await card.getByRole("button", { name: "放到仪表盘 项目阶段分布" }).click();
  await expect(card.getByRole("button", { name: "移出仪表盘 项目阶段分布" })).toBeVisible();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "仪表盘" }).click();
  const pinned = page.getByRole("region", { name: "度量图表" }).getByRole("region", { name: "项目阶段分布" });
  await expect(pinned.getByRole("button", { name: /计数 2$/ })).toBeVisible();
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "度量" }).click();

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

test("advanced metrics: several metrics, metric formula, calculated field, node metrics, pivot and compare card", async ({
  page,
}) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `metrics-adv-${suffix}@example.com`, `度量进阶 ${suffix}`);
  for (const name of ["面霜立项", "精华立项", "眼霜立项"]) {
    await openItems(page, "项目");
    await createItem(page, name);
  }
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "度量" }).click();
  const dialog = page.locator("[role=dialog][aria-modal=true]");

  // 两个指标：工作项数 + 指标公式（进行中占比），每个指标一个系列
  await page.getByRole("button", { name: "新建图表" }).first().click();
  await dialog.getByLabel("图表名称").fill("阶段与进行中占比");
  await choose(dialog.getByLabel("数据来源"), { label: "项目" });
  await choose(dialog.getByLabel("分组维度"), "stage");
  await dialog.getByRole("button", { name: "添加指标" }).click();
  await choose(dialog.getByLabel("指标 2", { exact: true }), "formula");
  await dialog.getByLabel("指标 2 公式").fill('ROUND(COUNTIF({状态} = "进行中") / COUNT() * 100)');
  await dialog.getByLabel("指标 2 名称").fill("进行中占比");
  const preview = dialog.getByRole("figure", { name: "阶段与进行中占比预览" });
  await expect(preview.getByRole("button", { name: /计数 3，进行中占比 100$/ })).toBeVisible();
  // 公式写错时给出原因，不能保存
  await dialog.getByLabel("指标 2 公式").fill("{状态} * 2");
  await expect(dialog.getByText(/汇总函数/).first()).toBeVisible();
  await dialog.getByLabel("指标 2 公式").fill('ROUND(COUNTIF({状态} = "进行中") / COUNT() * 100)');
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toBeHidden();
  const multi = page.getByRole("region", { name: "阶段与进行中占比" });
  await expect(multi.getByText("项目 · 计数、进行中占比")).toBeVisible();
  await expect(multi.getByRole("list", { name: "图例" }).getByText("进行中占比")).toBeVisible();

  // 计算字段当维度：按名称长度分组的透视表，列是状态
  await page.getByRole("button", { name: "新建图表" }).first().click();
  await dialog.getByLabel("图表名称").fill("透视");
  await choose(dialog.getByLabel("数据来源"), { label: "项目" });
  await dialog.getByRole("tab", { name: "透视表" }).click();
  await dialog.getByRole("button", { name: "添加计算字段" }).click();
  await dialog.getByLabel("计算字段 1 名称").fill("规模");
  await dialog.getByLabel("计算字段 1 公式").fill('IF({类型} = "项目", "标准", "其他")');
  await choose(dialog.getByLabel("行维度"), { label: "规模" });
  await choose(dialog.getByLabel("列维度"), "status");
  const pivot = dialog.getByRole("table", { name: "透视预览" });
  await expect(pivot.getByRole("row", { name: /标准/ })).toContainText("3");
  await dialog.getByRole("button", { name: "保存" }).click();
  const pivotCard = page.getByRole("region", { name: "透视" });
  await pivotCard.getByRole("button", { name: "查看明细：标准 进行中 3" }).click();
  await expect(page.getByRole("table", { name: "明细" }).getByRole("link", { name: "眼霜立项" })).toBeVisible();
  await page.keyboard.press("Escape");

  // 按节点度量：每个节点一行，按节点分组
  await page.getByRole("button", { name: "新建图表" }).first().click();
  await dialog.getByLabel("图表名称").fill("节点分布");
  await choose(dialog.getByLabel("数据来源"), { label: "项目" });
  await dialog.getByRole("tablist", { name: "度量对象" }).getByRole("tab", { name: "节点" }).click();
  await choose(dialog.getByLabel("分组维度"), "nodeState");
  await dialog.getByRole("tab", { name: "条形图" }).click();
  await expect(
    dialog.getByRole("list", { name: "节点分布预览" }).getByRole("button", { name: /^进行中：计数 3$/ }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("region", { name: "节点分布" }).getByText("项目 · 按节点 · 计数")).toBeVisible();

  // 指标对比卡：本月新建数和上月比
  await page.getByRole("button", { name: "新建图表" }).first().click();
  await dialog.getByLabel("图表名称").fill("本月新建");
  await choose(dialog.getByLabel("数据来源"), { label: "项目" });
  await dialog.getByRole("tab", { name: "指标对比卡" }).click();
  await dialog.getByLabel("目标值").fill("6");
  await dialog.getByRole("button", { name: "保存" }).click();
  const compare = page.getByRole("region", { name: "本月新建" });
  await expect(compare.getByRole("button", { name: "查看明细：3" })).toBeVisible();
  await expect(compare.getByRole("table", { name: "对比" }).getByRole("row", { name: /目标/ })).toContainText("50%");
});
