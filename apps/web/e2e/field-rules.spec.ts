import { expect, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createSpace,
  openSettings,
  openTypeConfig,
  selectByName,
  signUp,
  typeTab,
} from "./helpers";

test("new field types and field rules: default value, conditional required, help text", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `rules-${suffix}@example.com`);
  await createSpace(page, `规则 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("备案");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "备案");
  const addField = async (name: string, type: string, options = "") => {
    await typeTab(page, "字段");
    await page.getByLabel("新字段名称").fill(name);
    await choose(selectByName(page, "dataType"), type);
    if (options) await page.locator("input[name=options]").fill(options);
    await page.getByRole("button", { name: "添加字段" }).click();
    await expect(page.getByRole("button", { name: `配置字段 ${name}` })).toBeVisible();
  };
  await addField("优先级", "radio", "P0，P1");
  await addField("备案号", "text");
  await addField("说明", "textarea");
  await addField("区域", "cascadeSelect", "华东/上海，华东/杭州，华北");

  // 优先级默认 P1
  await page.getByRole("button", { name: "配置字段 优先级" }).click();
  const sheet = page.locator(".semi-sidesheet");
  await sheet.getByRole("tablist", { name: "默认值" }).getByRole("tab", { name: "统一默认" }).click();
  await sheet.getByRole("radio", { name: "P1" }).check();
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet).toBeHidden();

  // 备案号：优先级为 P0 时必填，带帮助说明
  await page.getByRole("button", { name: "配置字段 备案号" }).click();
  await sheet.getByRole("tablist", { name: "必填" }).getByRole("tab", { name: "条件必填" }).click();
  await choose(sheet.getByLabel("字段", { exact: true }), "优先级");
  await choose(sheet.getByLabel("判断", { exact: true }), "equal");
  await choose(sheet.getByLabel("值", { exact: true }), "P0");
  await sheet.getByLabel("帮助说明").fill("药监局备案编号");
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("条件必填")).toBeVisible();

  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("备案流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "备案流程" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  await closeTypeConfig(page);
  const nav = page.getByRole("navigation", { name: "主导航" });
  await nav.getByRole("link", { name: "备案" }).click();
  await page.getByRole("button", { name: /^新建/ }).click();
  const dialog = page.locator("[role=dialog][aria-modal=true]");
  await dialog.getByLabel("备案名称").fill("面霜备案");
  // 默认选中 P1；改成 P0 后备案号变成必填
  await expect(dialog.getByRole("radio", { name: "P1" })).toBeChecked();
  await dialog.getByRole("radio", { name: "P0" }).check();
  await expect(dialog.getByLabel("备案号的说明：药监局备案编号")).toBeVisible();
  await dialog.getByRole("button", { name: "创建" }).click();
  await expect(dialog.getByText("请填写必填字段：备案号。")).toBeVisible();
  await dialog.getByLabel("备案号", { exact: true }).fill("国妆备 2026001");
  await dialog.getByLabel("说明", { exact: true }).fill("第一行\n第二行");
  await dialog.getByRole("button", { name: "创建" }).click();

  const fields = page.getByRole("region", { name: "字段" });
  await expect(fields.getByLabel("备案号", { exact: true })).toHaveValue("国妆备 2026001");
  await expect(fields.getByRole("radio", { name: "P0" })).toBeChecked();
  await expect(fields.getByLabel("说明", { exact: true })).toHaveValue("第一行\n第二行");
});
