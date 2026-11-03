import { expect, test } from "@playwright/test";
import { createItem, oemSpace } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("upload, download and delete work item attachments", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `attach-${suffix}@example.com`, `附件 ${suffix}`);
  await createItem(page, "新品 F");

  const card = page.getByRole("region", { name: "附件" });
  await card.getByLabel("选择附件").setInputFiles([
    { name: "spec-v1.txt", mimeType: "text/plain", buffer: Buffer.from("净含量 50ml") },
    { name: "包装.png", mimeType: "image/png", buffer: PNG },
  ]);
  const list = card.getByRole("list", { name: "附件列表" });
  await expect(list.getByRole("link", { name: "spec-v1.txt" })).toBeVisible();
  await expect(list.getByRole("link", { name: "包装.png" })).toBeVisible();
  await expect(list).toContainText("14 B · Pascal");
  await expect(list.locator("img")).toHaveJSProperty("naturalWidth", 1);

  // 文件名靠 Content-Disposition；无界面的 Chromium 不认中文文件名，这里用英文名验证
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    list.getByRole("link", { name: "spec-v1.txt" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("spec-v1.txt");

  const tabs = page.getByRole("tablist", { name: "详情页签" });
  await tabs.getByRole("tab", { name: "动态" }).click();
  await expect(page.getByRole("list", { name: "动态列表" })).toContainText("Pascal 上传了附件「spec-v1.txt」");

  await tabs.getByRole("tab", { name: "基本信息" }).click();
  await list.getByRole("listitem").filter({ hasText: "spec-v1.txt" }).hover();
  await list.getByRole("button", { name: "删除附件 spec-v1.txt" }).click();
  await expect(list.getByRole("link", { name: "spec-v1.txt" })).toHaveCount(0);
  await tabs.getByRole("tab", { name: "动态" }).click();
  await expect(page.getByRole("list", { name: "动态列表" })).toContainText("Pascal 删除了附件「spec-v1.txt」");

  // 刷新后仍在：列表来自服务端
  await page.reload();
  await expect(page.getByRole("region", { name: "附件" }).getByRole("link", { name: "包装.png" })).toBeVisible();
});
