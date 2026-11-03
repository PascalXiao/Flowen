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

test("admins lay out the detail page in tabs and sections, with hints and a separate create page", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `layout-${suffix}@example.com`);
  await createSpace(page, `布局 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("缺陷");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "缺陷");
  for (const name of ["严重程度", "复现步骤", "预计工时", "内部备注"]) {
    await typeTab(page, "字段");
    await page.getByLabel("新字段名称").fill(name);
    await choose(selectByName(page, "dataType"), "text");
    await page.getByRole("button", { name: "添加字段" }).click();
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  }
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await page.goBack();
  await typeTab(page, "页面布局");

  const editor = page.getByRole("group").filter({ has: page.getByRole("button", { name: "保存布局" }) });
  // 默认「基本信息」页签里有一组「字段」：改名为「缺陷信息」，加一句提示，复现步骤挪到最前
  const fieldsSection = editor.getByRole("region", { name: "分组 字段" });
  await fieldsSection.getByLabel("分组名称").fill("缺陷信息");
  const section = editor.getByRole("region", { name: "分组 缺陷信息" });
  await section.getByRole("button", { name: "上移复现步骤" }).click();
  await choose(section.getByLabel("添加字段或控件"), "text:");
  await section.getByLabel("提示文字内容").fill("线上问题请先写复现步骤");
  // 内部备注不显示；新加一个「排期」页签放预计工时
  await choose(editor.getByLabel("设为不显示"), { label: "内部备注" });
  await section.getByRole("button", { name: "移除 预计工时" }).click();
  await editor.getByRole("button", { name: "添加页签" }).click();
  const newTab = editor.getByRole("region", { name: /^页签 页签/ });
  await newTab.getByLabel("页签名称").fill("排期");
  await choose(editor.getByRole("region", { name: "分组 分组 1" }).getByLabel("添加字段或控件"), {
    label: "预计工时",
  });
  await editor.getByRole("button", { name: "保存布局" }).click();
  await expect(editor.getByRole("button", { name: "保存布局" })).toBeDisabled();

  // 新建页：内部备注不出现，提示文字出现
  await closeTypeConfig(page);
  await openItems(page);
  await createItem(page, "登录页白屏", {
    label: "缺陷名称",
    before: async (dialog) => {
      await expect(dialog.getByLabel("内部备注")).toHaveCount(0);
      await expect(dialog.getByText("线上问题请先写复现步骤")).toBeVisible();
      await dialog.getByLabel("严重程度").fill("高");
    },
  });

  // 详情页：基本信息页签里是缺陷信息分组，排期页签里是预计工时
  const basic = page.getByRole("region", { name: "缺陷信息" });
  await expect(basic.getByRole("textbox").first()).toHaveAccessibleName("复现步骤");
  await expect(basic.getByLabel("严重程度")).toHaveValue("高");
  await expect(basic.getByText("线上问题请先写复现步骤")).toBeVisible();
  await expect(page.getByLabel("内部备注")).toHaveCount(0);
  await expect(page.getByLabel("预计工时")).toHaveCount(0);
  await page.getByRole("tablist", { name: "详情页签" }).getByRole("tab", { name: "排期" }).click();
  await expect(page.getByLabel("预计工时")).toBeVisible();
});

test("a related-info control shows a field of the linked work item", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `related-info-${suffix}@example.com`);
  await createSpace(page, `关联信息 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("评审");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await createRelation(page, { from: "评审", to: "评审", name: "关联项目" });
  await openTypeConfig(page, "评审");
  await typeTab(page, "字段");
  await page.getByLabel("新字段名称").fill("品牌");
  await choose(selectByName(page, "dataType"), "text");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("cell", { name: "品牌", exact: true })).toBeVisible();
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await page.goBack();

  // 布局里加一个关联信息：关联项目的品牌
  await typeTab(page, "页面布局");
  const editor = page.getByRole("group").filter({ has: page.getByRole("button", { name: "保存布局" }) });
  const section = editor.getByRole("region", { name: "分组 字段" });
  await choose(section.getByLabel("添加字段或控件"), { label: "关联信息：关联项目" });
  await section.getByLabel("对端字段（字段名）").fill("品牌");
  await section.getByLabel("显示名").fill("项目品牌");
  await editor.getByRole("button", { name: "保存布局" }).click();
  await expect(editor.getByRole("button", { name: "保存布局" })).toBeDisabled();
  await closeTypeConfig(page);

  await openItems(page);
  await createItem(page, "面霜项目", { label: "评审名称" });
  const fields = page.getByRole("region", { name: "字段" });
  await fields.getByLabel("品牌", { exact: true }).fill("ddg");
  await fields.getByLabel("品牌", { exact: true }).blur();
  await openItems(page);
  await createItem(page, "面霜需求评审", { label: "评审名称" });
  await expect(page.getByLabel("项目品牌")).toHaveText("—");
  const group = page.getByRole("main").getByRole("region", { name: "关联项目" });
  await choose(group.getByLabel("添加关联项目"), { label: "面霜项目" });
  await expect(page.getByLabel("项目品牌")).toHaveText("ddg");
});

test("a node-info control shows a node's owners and lets you plan it", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `node-info-ctl-${suffix}@example.com`);
  await createSpace(page, `节点信息 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("素材");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "素材");
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认流程" }).click();
  const node = (name: string) => page.locator(".react-flow__node", { hasText: name });
  await node("开始").click();
  await page.getByRole("button", { name: "添加节点" }).click();
  await page.getByRole("main").getByLabel("节点名称").fill("提交初稿");
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await page.goBack();

  await typeTab(page, "页面布局");
  const editor = page.getByRole("group").filter({ has: page.getByRole("button", { name: "保存布局" }) });
  // 没有字段的类型，默认布局里第一组是「角色」
  const section = editor.getByRole("region", { name: "分组 角色" });
  await choose(section.getByLabel("添加字段或控件"), "nodeInfo:");
  await section.getByLabel("节点（节点名或键）").fill("提交初稿");
  await editor.getByRole("button", { name: "保存布局" }).click();
  await expect(editor.getByRole("button", { name: "保存布局" })).toBeDisabled();
  await closeTypeConfig(page);

  await openItems(page);
  await createItem(page, "618 海报", { label: "素材名称" });
  const info = page.getByRole("group", { name: "节点信息 提交初稿" });
  await expect(info).toContainText("负责人");
  await info.getByLabel("提交初稿计划开始").fill("2026-11-02");
  await info.getByLabel("提交初稿计划结束").fill("2026-11-06");
  await expect(info.getByLabel("提交初稿计划结束")).toHaveValue("2026-11-06");
  await page.reload();
  await expect(page.getByRole("group", { name: "节点信息 提交初稿" }).getByLabel("提交初稿计划结束")).toHaveValue(
    "2026-11-06",
  );
});

test("a related-items view lists linked work items and edits their fields in place", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `relation-table-${suffix}@example.com`);
  await createSpace(page, `关联视图 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("项目");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await createRelation(page, { from: "项目", to: "项目", name: "关联SKU" });
  await openTypeConfig(page, "项目");
  await typeTab(page, "字段");
  await page.getByLabel("新字段名称").fill("首月销量");
  await choose(selectByName(page, "dataType"), "number");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("cell", { name: "首月销量", exact: true })).toBeVisible();
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await page.goBack();

  await typeTab(page, "页面布局");
  const editor = page.getByRole("group").filter({ has: page.getByRole("button", { name: "保存布局" }) });
  const section = editor.getByRole("region", { name: "分组 字段" });
  await choose(section.getByLabel("添加字段或控件"), { label: "关联工作项视图：关联SKU" });
  await section.getByLabel("列（对端字段名，逗号分隔）").fill("名称, 首月销量");
  await section.getByLabel("标题").fill("SKU 销量预估");
  await editor.getByRole("button", { name: "保存布局" }).click();
  await expect(editor.getByRole("button", { name: "保存布局" })).toBeDisabled();
  await closeTypeConfig(page);

  await openItems(page);
  await createItem(page, "50ml 装", { label: "项目名称" });
  await openItems(page);
  await createItem(page, "面霜项目", { label: "项目名称" });
  const group = page.getByRole("main").getByRole("region", { name: "关联SKU" });
  await choose(group.getByLabel("添加关联SKU"), { label: "50ml 装" });
  const table = page.getByRole("table", { name: "SKU 销量预估" });
  await expect(table.getByRole("link", { name: "50ml 装" })).toBeVisible();
  await table.getByLabel("50ml 装 首月销量").fill("1200");
  await table.getByLabel("50ml 装 首月销量").blur();
  await page.reload();
  await expect(page.getByRole("table", { name: "SKU 销量预估" }).getByLabel("50ml 装 首月销量")).toHaveValue("1200");
});

test("a multi-node view lists chosen nodes with their state and owners", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `node-table-${suffix}@example.com`);
  await createSpace(page, `多节点视图 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("评审");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "评审");
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("需求评审");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "需求评审" }).click();
  const node = (name: string) => page.locator(".react-flow__node", { hasText: name });
  await node("开始").click();
  await page.getByRole("button", { name: "添加节点" }).click();
  await page.getByRole("main").getByLabel("节点名称").fill("NPD资料预审");
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await page.goBack();

  await typeTab(page, "页面布局");
  const editor = page.getByRole("group").filter({ has: page.getByRole("button", { name: "保存布局" }) });
  const section = editor.getByRole("region", { name: "分组 角色" });
  await choose(section.getByLabel("添加字段或控件"), "nodeTable:");
  await section.getByLabel("节点（节点名，逗号分隔）").fill("开始, NPD资料预审");
  await section.getByLabel("只在这个流程类型上显示").fill("需求评审");
  await section.getByLabel("标题").fill("预审结果");
  await editor.getByRole("button", { name: "保存布局" }).click();
  await expect(editor.getByRole("button", { name: "保存布局" })).toBeDisabled();
  await closeTypeConfig(page);

  await openItems(page);
  await createItem(page, "面霜需求评审", { label: "评审名称" });
  const table = page.getByRole("table", { name: "预审结果" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByRole("row", { name: /NPD资料预审/ })).toContainText("进行中");
});
