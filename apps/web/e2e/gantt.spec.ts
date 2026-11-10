import { dayFromIso, dayInTimeZone, dayToIso, WorkCalendar } from "@fp/engine";
import { expect, test } from "@playwright/test";
import { createItem, oemSpace } from "./helpers";

test("plan nodes on the gantt chart: auto schedule, set dates by hand, drag a bar, back to auto", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `gantt-${suffix}@example.com`, `排期 ${suffix}`);
  await createItem(page, "新品 C");

  await page.getByRole("region", { name: "流程" }).getByRole("tab", { name: "甘特图" }).click();
  const row = (name: string) => page.getByRole("row", { name, exact: true });
  const startOf = (name: string) => row(name).getByLabel("计划开始");

  // 自动排期：开始节点是今天，需求立项提案从今天（或之后第一个工作日）开始
  const calendar = new WorkCalendar();
  const today = dayInTimeZone(Date.now(), "Asia/Shanghai");
  await expect(startOf("开始")).toHaveValue(dayToIso(today));
  await expect(startOf("需求立项提案")).toHaveValue(dayToIso(calendar.onOrAfter(today)));

  // 手动把需求立项提案定到 12 月 1 日（周二），财务分析顺延到 12 月 2 日
  await startOf("需求立项提案").fill("2026-12-01");
  await expect(row("需求立项提案").getByRole("button", { name: "恢复自动" })).toBeVisible();
  await expect(startOf("财务分析（需求立项）")).toHaveValue("2026-12-02");

  // 在甘特图上把财务分析的横条往后拖两天
  const canvas = page.getByRole("img", { name: "甘特图" });
  const first = Number(await canvas.getAttribute("data-first-day"));
  const barLeft = (dayFromIso("2026-12-02") - first) * 26;
  // 把横条所在的位置滚进可视区
  await canvas.evaluate((el, left) => {
    const scroller = el.closest(".overflow-auto") as HTMLElement;
    scroller.scrollLeft = left - 200;
  }, barLeft);
  const rows = page.locator("details tbody tr");
  const index = await rows.evaluateAll((trs) =>
    trs.findIndex((tr) => tr.getAttribute("aria-label") === "财务分析（需求立项）"),
  );
  const box = await canvas.boundingBox();
  if (!box) throw new Error("甘特图没有渲染");
  const x = box.x + barLeft + 13;
  const y = box.y + index * 30 + 15;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 26, y, { steps: 3 });
  await page.mouse.move(x + 52, y, { steps: 3 });
  await page.mouse.up();
  await expect(startOf("财务分析（需求立项）")).toHaveValue("2026-12-04");

  // 恢复自动排期
  await row("需求立项提案").getByRole("button", { name: "恢复自动" }).click();
  await expect(startOf("需求立项提案")).toHaveValue(dayToIso(calendar.onOrAfter(today)));
});
