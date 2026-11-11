import { expect, test } from "@playwright/test";
import { addMember, createItem, demoSpace, openItems, registerColleague } from "./helpers";

test("comment with a mention, and both people get notified", async ({ page, browser }) => {
  const suffix = `${Date.now()}`;
  const linEmail = `lin-comment-${suffix}@example.com`;
  await registerColleague(linEmail, "Lin");
  await demoSpace(page, "Pascal", `comments-${suffix}@example.com`, `评论 ${suffix}`);
  await addMember(page, linEmail, "Lin");
  await openItems(page);
  await createItem(page, "新品 J");

  // Pascal 是立项提案的负责人：worker 处理 nodeStarted 事件后给他发通知
  const bell = page.getByRole("button", { name: /^通知/ });
  await expect(bell).toHaveAccessibleName(/未读/, { timeout: 30_000 });
  await bell.click();
  await expect(page.getByRole("list", { name: "通知列表" })).toContainText("「新品 J」的节点「立项提案」轮到你了");
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

test("reply in a thread, edit and delete your own comment", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `threads-${suffix}@example.com`, `楼中楼 ${suffix}`);
  await openItems(page);
  await createItem(page, "新品 R");
  const tabs = page.getByRole("tablist", { name: "详情页签" });
  await tabs.getByRole("tab", { name: /评论/ }).click();
  await page.getByLabel("评论内容").fill("配方先按 A 方案走");
  await page.getByRole("button", { name: "发表评论" }).click();
  const list = page.getByRole("list", { name: "评论列表" });
  const root = list.getByLabel("Pascal的评论");
  await expect(root).toContainText("配方先按 A 方案走");
  await expect(tabs.getByRole("tab", { name: "评论 1" })).toBeVisible();

  // 回复：出现在这条评论下面的楼里
  await root.hover();
  await root.getByRole("button", { name: "回复" }).click();
  await page.getByLabel("回复内容").fill("包材也一起定");
  await page.getByRole("button", { name: "回复", exact: true }).last().click();
  const reply = list.getByLabel("回复").getByLabel("Pascal的回复");
  await expect(reply).toContainText("回复 Pascal");
  await expect(reply).toContainText("包材也一起定");
  await expect(page.getByLabel("回复内容")).toHaveCount(0);

  // 编辑一级评论
  await root.hover();
  await root.getByRole("button", { name: "编辑" }).first().click();
  await page.getByLabel("编辑评论").fill("配方按 B 方案走");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(root).toContainText("配方按 B 方案走");
  await expect(root).toContainText("已编辑");

  // 删除一级评论：留下占位，回复还在
  await root.hover();
  await root.getByRole("button", { name: "删除" }).first().click();
  await page.locator(".semi-popconfirm").getByRole("button", { name: "删除" }).click();
  await expect(list).toContainText("该评论已删除");
  await expect(reply).toContainText("包材也一起定");
  await expect(tabs.getByRole("tab", { name: "评论 1" })).toBeVisible();
});
