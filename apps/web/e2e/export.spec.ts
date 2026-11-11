import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { createItem, demoSpace, openItems } from "./helpers";

test("export the list to Excel with the shown columns", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `export-${suffix}@example.com`, `导出 ${suffix}`);
  for (const name of ["面霜立项", "精华立项"]) {
    await openItems(page, "项目");
    await createItem(page, name);
  }
  await openItems(page, "项目");
  await expect(page.getByRole("grid").getByRole("row").filter({ hasText: "精华立项" })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^导出 ${suffix}-项目-\\d{4}-\\d{2}-\\d{2}\\.xlsx$`));
  await expect(page.getByText("已导出 2 条")).toBeVisible();

  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(await download.path());
  const sheet = book.getWorksheet("工作项");
  if (!sheet) throw new Error("没有「工作项」工作表");
  const header = (sheet.getRow(1).values as unknown[]).slice(1);
  expect(header[0]).toBe("名称");
  expect(header.length).toBeGreaterThan(1);
  const names = [2, 3].map((r) => sheet.getRow(r).getCell(1).value);
  expect(names.sort()).toEqual(["精华立项", "面霜立项"].sort());
});
