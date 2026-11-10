import { dayInTimeZone, dayToIso, WorkCalendar } from "@fp/engine";
import { expect, test } from "@playwright/test";
import { choose, createItem, oemSpace, openItems, openSettings } from "./helpers";

test("a holiday in the space calendar re-plans its work items", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `calendar-${suffix}@example.com`, `日历 ${suffix}`);
  await createItem(page, "新品 D");

  const startOf = (name: string) => page.getByRole("row", { name, exact: true }).getByLabel("计划开始");
  const today = dayInTimeZone(Date.now(), "Asia/Shanghai");
  const firstDay = new WorkCalendar().onOrAfter(today);
  await page.getByRole("region", { name: "流程" }).getByRole("tab", { name: "甘特图" }).click();
  await expect(startOf("需求立项提案")).toHaveValue(dayToIso(firstDay));

  // 把需求立项提案开始的那天设成假期
  await openSettings(page, "空间信息");
  await page.getByLabel("日历日期").fill(dayToIso(firstDay));
  await choose(page.getByLabel("这天"), "放假");
  await page.getByRole("button", { name: "加入日历" }).click();
  const holidays = page.getByRole("list", { name: "节假日" });
  await expect(holidays).toContainText(dayToIso(firstDay));

  await openItems(page);
  await page.getByRole("link", { name: "新品 D" }).click();
  await page.getByRole("region", { name: "流程" }).getByRole("tab", { name: "甘特图" }).click();
  const withHoliday = new WorkCalendar({ holidays: [firstDay] });
  await expect(startOf("需求立项提案")).toHaveValue(dayToIso(withHoliday.onOrAfter(firstDay + 1)));

  // 移除假期，排期恢复
  await openSettings(page, "空间信息");
  await holidays.getByRole("button", { name: `移除 ${dayToIso(firstDay)}` }).click();
  await expect(page.getByText("没有设置节假日")).toBeVisible();
  await openItems(page);
  await page.getByRole("link", { name: "新品 D" }).click();
  await page.getByRole("region", { name: "流程" }).getByRole("tab", { name: "甘特图" }).click();
  await expect(startOf("需求立项提案")).toHaveValue(dayToIso(firstDay));
});
