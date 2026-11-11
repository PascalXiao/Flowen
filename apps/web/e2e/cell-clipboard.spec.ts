import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  demoSpace,
  openItems,
  openSettings,
  openTypeConfig,
  selectByName,
  typeTab,
} from "./helpers";

/** 在当前焦点上派发剪贴板事件：粘贴给定文本，或复制并返回写进剪贴板的文本。 */
function clipboard(page: Page, kind: "copy" | "paste", text = "") {
  return page.evaluate(
    ([kind, text]) => {
      const data = new DataTransfer();
      if (kind === "paste") data.setData("text/plain", text);
      document.activeElement?.dispatchEvent(new ClipboardEvent(kind, { clipboardData: data, bubbles: true }));
      return data.getData("text/plain");
    },
    [kind, text] as const,
  );
}

test("list cells copy and paste like a spreadsheet", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `clipboard-${suffix}@example.com`, `复制粘贴 ${suffix}`);
  await openSettings(page);
  await openTypeConfig(page, "项目");
  await typeTab(page, "字段");
  await page.getByLabel("新字段名称").fill("粘贴备注");
  await choose(selectByName(page, "dataType"), "text");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("button", { name: "配置字段 粘贴备注" })).toBeVisible();
  await typeTab(page, "列");
  await page.getByRole("checkbox", { name: "显示列 粘贴备注" }).check();
  await page.getByRole("button", { name: "保存默认列" }).click();
  await expect(page.getByText("已保存")).toBeVisible();
  await closeTypeConfig(page);

  await openItems(page, "项目");
  await createItem(page, "面霜立项");
  await openItems(page, "项目");
  await createItem(page, "精华立项");
  await openItems(page, "项目");
  const grid = page.getByRole("grid");
  const cell = (name: string): Locator =>
    grid.getByRole("row").filter({ hasText: name }).locator('[data-cell="粘贴备注"]');

  // 选中一个单元格粘贴文本
  await cell("面霜立项").click();
  await expect(cell("面霜立项")).toHaveAttribute("data-selected", "true");
  await clipboard(page, "paste", "首批试产");
  await expect(cell("面霜立项")).toHaveText("首批试产");

  // 复制出来的是单元格的文本
  expect(await clipboard(page, "copy")).toBe("首批试产");

  // Shift 点选扩成两行，粘贴一个值填满选区
  await cell("精华立项").click({ modifiers: ["Shift"] });
  await expect(cell("精华立项")).toHaveAttribute("data-selected", "true");
  await clipboard(page, "paste", "统一排产");
  await expect(cell("面霜立项")).toHaveText("统一排产");
  await expect(cell("精华立项")).toHaveText("统一排产");

  // 不能粘贴的列跳过
  await grid.getByRole("row").filter({ hasText: "面霜立项" }).locator('[data-cell="创建者"]').click();
  await clipboard(page, "paste", "别人");
  await expect(page.getByText("1 个不能粘贴的单元格跳过了")).toBeVisible();
});
