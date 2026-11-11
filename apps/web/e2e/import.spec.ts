import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import {
  choose,
  closeTypeConfig,
  demoSpace,
  openItems,
  openSettings,
  openTypeConfig,
  selectByName,
  typeTab,
} from "./helpers";

async function xlsx(rows: string[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("工作项");
  for (const r of rows) sheet.addRow(r);
  return Buffer.from(await book.xlsx.writeBuffer());
}

test("import work items from Excel with a pre-check", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `import-${suffix}@example.com`, `导入 ${suffix}`);
  await openSettings(page);
  await openTypeConfig(page, "项目");
  await typeTab(page, "字段");
  await page.getByLabel("新字段名称").fill("批次");
  await choose(selectByName(page, "dataType"), "text");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("button", { name: "配置字段 批次" })).toBeVisible();
  await typeTab(page, "列");
  await page.getByRole("checkbox", { name: "显示列 批次" }).check();
  await page.getByRole("button", { name: "保存默认列" }).click();
  await expect(page.getByText("已保存")).toBeVisible();
  await closeTypeConfig(page);

  await openItems(page, "项目");
  await page.getByRole("button", { name: "导入" }).click();
  const dialog = page.getByRole("dialog");

  // 模板：表头有名称、新加的字段和角色
  const [template] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "下载导入模板" }).click(),
  ]);
  expect(template.suggestedFilename()).toBe(`导入 ${suffix}-项目-导入模板.xlsx`);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(await template.path());
  const headers = (book.worksheets[0]?.getRow(1).values as unknown[]).slice(1);
  expect(headers[0]).toBe("名称");
  expect(headers).toContain("批次");
  expect(headers).toContain("开发");

  await dialog.getByLabel("选择 Excel 文件").setInputFiles({
    name: "立项清单.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: await xlsx([
      ["名称", "批次", "开发", "备注"],
      ["面霜导入", "第一批", "Pascal", "不导入的列"],
      ["", "第一批", "", ""],
      ["精华导入", "第二批", "Nobody", ""],
      ["乳液导入", "第二批", "", ""],
    ]),
  });
  await expect(dialog).toContainText("共 4 行");
  await expect(dialog).toContainText("2 行可以导入");
  await expect(dialog.getByLabel("「备注」导入到")).toContainText("不导入");
  const check = dialog.getByRole("region", { name: "预检结果" });
  await expect(check.getByRole("row").filter({ hasText: "名称没填" })).toContainText("3");
  await expect(check.getByRole("row").filter({ hasText: "精华导入" })).toContainText(
    "「开发」里的「Nobody」不是空间成员。",
  );

  await dialog.getByRole("button", { name: "导入 2 条" }).click();
  await expect(dialog).toContainText("已导入 2 条项目，2 行没有导入");
  await dialog.getByRole("button", { name: "完成" }).click();

  const grid = page.getByRole("grid");
  await expect(grid.getByRole("row").filter({ hasText: "面霜导入" }).locator('[data-cell="批次"]')).toHaveText(
    "第一批",
  );
  await expect(grid.getByRole("row").filter({ hasText: "乳液导入" }).locator('[data-cell="批次"]')).toHaveText(
    "第二批",
  );
  await expect(grid.getByRole("row").filter({ hasText: "精华导入" })).toHaveCount(0);
});
