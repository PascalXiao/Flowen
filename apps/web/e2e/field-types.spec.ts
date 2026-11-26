import { expect, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  createSpace,
  openSettings,
  openTypeConfig,
  selectByName,
  signUp,
  typeTab,
} from "./helpers";

test("number, date, multi-select and people fields can be edited and filtered", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `fields-${suffix}@example.com`);
  await createSpace(page, `字段 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("任务");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "任务");
  const addField = async (name: string, type: string, options = "") => {
    await typeTab(page, "字段");
    await page.getByLabel("新字段名称").fill(name);
    await choose(selectByName(page, "dataType"), type);
    await page.locator("input[name=options]").fill(options);
    await page.getByRole("button", { name: "添加字段" }).click();
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  };
  await addField("工时", "number");
  await addField("截止", "date");
  await addField("标签", "multiSelect", "前端，后端");
  await addField("协作人", "user");
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("任务流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "任务流程" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  await closeTypeConfig(page);
  const nav = page.getByRole("navigation", { name: "主导航" });
  // 新建时填数字和多选
  await nav.getByRole("link", { name: "任务" }).click();
  await createItem(page, "接口联调", {
    label: "任务名称",
    before: async (dialog) => {
      await dialog.getByLabel("工时").fill("8");
      await dialog.getByRole("button", { name: "标签" }).click();
      await page.getByRole("list", { name: "标签的选项" }).getByRole("button", { name: "后端" }).click();
      await page.keyboard.press("Escape");
    },
  });
  const fields = page.getByRole("region", { name: "字段" });
  await expect(fields.getByLabel("工时")).toHaveValue("8");
  await expect(fields.getByRole("button", { name: "标签" })).toContainText("后端");

  // 详情页里改日期和人员
  await fields.getByLabel("截止").fill("2026-11-30");
  await fields.getByRole("button", { name: "协作人" }).click();
  await page.getByRole("list", { name: "协作人的选项" }).getByRole("button", { name: "Pascal" }).click();
  await page.keyboard.press("Escape");
  await expect(fields.getByRole("button", { name: "协作人" })).toContainText("Pascal");
  await page.reload();
  await expect(page.getByRole("region", { name: "字段" }).getByLabel("截止")).toHaveValue("2026-11-30");

  await nav.getByRole("link", { name: "任务" }).click();
  await createItem(page, "写文档", { label: "任务名称" });

  // 条件组筛选：标签属于“后端”
  await nav.getByRole("link", { name: "任务" }).click();
  const rows = page.getByRole("main").getByRole("row");
  await expect(rows.filter({ hasText: "写文档" })).toHaveCount(1);
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await choose(page.getByLabel("条件 1-1 对象"), "标签");
  await page.getByLabel("条件 1-1 值", { exact: true }).click();
  await page.getByRole("list", { name: "条件 1-1 值 选项" }).getByLabel("后端").check();
  await page.getByLabel("条件 1-1 值", { exact: true }).click();
  await page.getByRole("button", { name: "应用" }).click();
  await expect(page.getByRole("button", { name: "筛选 · 1" })).toBeVisible();
  await expect(rows.filter({ hasText: "接口联调" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "写文档" })).toHaveCount(0);

  // 再加一组「或」：工时不少于 10 的也算；改成「所有」条件组时就都不满足
  await page.getByRole("button", { name: "筛选 · 1" }).click();
  await page.getByRole("button", { name: "添加条件组" }).click();
  await choose(page.getByLabel("条件 2-1 对象"), "工时");
  await page.getByLabel("条件 2-1 起").fill("10");
  await page.getByRole("button", { name: "应用" }).click();
  await expect(rows.filter({ hasText: "接口联调" })).toHaveCount(0);
  await page.getByRole("button", { name: "筛选 · 2" }).click();
  await choose(page.getByLabel("条件组之间"), "任一");
  await page.getByRole("button", { name: "应用" }).click();
  await expect(rows.filter({ hasText: "接口联调" })).toHaveCount(1);
  await page.getByRole("button", { name: "筛选 · 2" }).click();
  await page.getByRole("button", { name: "清空条件" }).click();
  await expect(rows.filter({ hasText: "接口联调" })).toHaveCount(1);
});

test("copy a work item, leaving out the fields set in the copy settings", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `copy-${suffix}@example.com`);
  await createSpace(page, `复制 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("任务");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "任务");
  for (const name of ["版本号", "复盘报告"]) {
    await typeTab(page, "字段");
    await page.getByLabel("新字段名称").fill(name);
    await choose(selectByName(page, "dataType"), "text");
    await page.getByRole("button", { name: "添加字段" }).click();
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  }
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("任务流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "任务流程" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await page.goBack();
  // 复制时不带「复盘报告」
  await typeTab(page, "基本信息");
  await page.getByLabel("复制时不带复盘报告").check();
  await page.getByRole("button", { name: "保存复制配置" }).click();
  await closeTypeConfig(page);

  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "任务" }).click();
  await createItem(page, "接口联调", { label: "任务名称" });
  const fields = page.getByRole("region", { name: "字段" });
  for (const [name, value] of [
    ["版本号", "1.0"],
    ["复盘报告", "https://example.com/review"],
  ] as const) {
    await fields.getByLabel(name, { exact: true }).fill(value);
    await fields.getByLabel(name, { exact: true }).blur();
  }
  await expect(fields.getByLabel("复盘报告", { exact: true })).toHaveValue("https://example.com/review");

  await page.getByRole("button", { name: "复制", exact: true }).click();
  const dialog = page.locator("[role=dialog][aria-modal=true]");
  await expect(dialog.getByLabel("新工作项名称")).toHaveValue("接口联调 副本");
  await dialog.getByRole("button", { name: "复制", exact: true }).click();
  await expect(page.getByRole("heading", { name: "接口联调 副本" })).toBeVisible();
  const copied = page.getByRole("region", { name: "字段" });
  await expect(copied.getByLabel("版本号", { exact: true })).toHaveValue("1.0");
  await expect(copied.getByLabel("复盘报告", { exact: true })).toHaveValue("");
});
