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

test("a blind vote field: vote with a remark, then reveal the results", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `vote-${suffix}@example.com`);
  await createSpace(page, `投票 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("需求评审");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "需求评审");

  // 不填选项：默认表态（赞成、反对、弃权）
  await typeTab(page, "字段");
  await page.getByLabel("新字段名称").fill("立项评审");
  await choose(selectByName(page, "dataType"), "vote");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("cell", { name: "立项评审", exact: true })).toBeVisible();

  // 设成盲投，赞成 2 分
  await page.getByRole("button", { name: "配置字段 立项评审" }).click();
  const sheet = page.locator(".semi-sidesheet");
  await sheet.getByText("盲投（放榜前只看得到自己的票）").click();
  await sheet.getByLabel("赞成的分值").fill("2");
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet).toBeHidden();

  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await closeTypeConfig(page);

  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "需求评审" }).click();
  await createItem(page, "导出 PDF", { label: "需求评审名称" });

  const vote = page.getByRole("region", { name: "立项评审" });
  await expect(vote.getByText("0 人已投")).toBeVisible();
  await expect(vote.getByText("盲投中，放榜后公布结果")).toBeVisible();
  await vote.getByRole("button", { name: "赞成" }).click();
  await vote.getByLabel("投票备注").fill("用户呼声高");
  await vote.getByRole("button", { name: "投票", exact: true }).click();
  await expect(vote.getByText("1 人已投")).toBeVisible();
  await expect(vote.getByText("我投了")).toBeVisible();
  await expect(vote.getByRole("list", { name: "投票结果" })).toBeHidden();

  // 放榜：看到票数、占比、平均分和投票人
  await vote.getByRole("button", { name: "放榜" }).click();
  await expect(vote.getByText("已放榜")).toBeVisible();
  const results = vote.getByRole("list", { name: "投票结果" });
  await expect(results.getByText("1 票 100%")).toBeVisible();
  await expect(results.getByText("平均分 2.00")).toBeVisible();
  await expect(results.getByText("：用户呼声高")).toBeVisible();
  await vote.getByRole("button", { name: "收起结果" }).click();
  await expect(results).toBeHidden();
});
