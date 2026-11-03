import { expect, test } from "@playwright/test";
import { addMember, createItem, oemSpace, openItems, registerColleague } from "./helpers";

test("comment with a mention, and both people get notified", async ({ page, browser }) => {
  const suffix = `${Date.now()}`;
  const linEmail = `lin-comment-${suffix}@example.com`;
  await registerColleague(linEmail, "Lin");
  await oemSpace(page, "Pascal", `comments-${suffix}@example.com`, `评论 ${suffix}`);
  await addMember(page, linEmail, "Lin");
  await openItems(page);
  await createItem(page, "新品 J");

  // Pascal 是需求立项提案的负责人：worker 处理 nodeStarted 事件后给他发通知
  const bell = page.getByRole("button", { name: /^通知/ });
  await expect(bell).toHaveAccessibleName(/未读/, { timeout: 30_000 });
  await bell.click();
  await expect(page.getByRole("list", { name: "通知列表" })).toContainText("「新品 J」的节点「需求立项提案」轮到你了");
  await page.getByRole("button", { name: "全部已读" }).click();
  await expect(bell).toHaveAccessibleName("通知");
  await bell.click();

  // 评论并提及 Lin（评论在详情页签里）
  await page.getByRole("tablist", { name: "详情页签" }).getByRole("tab", { name: /评论/ }).click();
  await page.getByLabel("评论内容").fill("配方先按 A 方案走");
  await page.getByRole("button", { name: "@Lin" }).click();
  await page.getByRole("button", { name: "发表评论" }).click();
  await expect(page.getByRole("list", { name: "评论列表" })).toContainText("配方先按 A 方案走");
  await expect(page.getByLabel("评论内容")).toHaveValue("");

  // Lin 登录后看到提及通知，点开跳到工作项
  const linContext = await browser.newContext();
  const lin = await linContext.newPage();
  await lin.goto("/login");
  await lin.getByLabel("邮箱").fill(linEmail);
  await lin.getByLabel("密码").fill("correct-horse-battery");
  await lin.getByRole("button", { name: "登录", exact: true }).click();
  const linBell = lin.getByRole("button", { name: /^通知/ });
  await expect(linBell).toHaveAccessibleName("通知（1 条未读）", { timeout: 30_000 });
  await linBell.click();
  await lin.getByRole("button", { name: /Pascal 在「新品 J」的评论里提到了你/ }).click();
  await expect(lin.getByRole("heading", { name: "新品 J" })).toBeVisible();
  await lin.getByRole("tablist", { name: "详情页签" }).getByRole("tab", { name: /评论/ }).click();
  await expect(lin.getByRole("list", { name: "评论列表" })).toContainText("配方先按 A 方案走");
  await expect(linBell).toHaveAccessibleName("通知");
  await linContext.close();
});
