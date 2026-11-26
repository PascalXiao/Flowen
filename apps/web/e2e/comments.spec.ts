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
  const editor = page.getByLabel("评论内容");
  await editor.fill("配方先按 A 方案走 ");
  // 输入 @ 弹出成员和字段，选中后变成提及标签
  await editor.pressSequentially("@Li");
  await page.getByRole("listbox", { name: "提及" }).getByRole("option", { name: "Lin" }).click();
  await expect(editor.locator("[data-user]")).toHaveText("@Lin");
  await page.getByRole("button", { name: "发表评论" }).click();
  await expect(page.getByRole("list", { name: "评论列表" })).toContainText("配方先按 A 方案走 @Lin");
  await expect(editor).toHaveText("");

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
  await page.locator("[data-popconfirm]").getByRole("button", { name: "删除" }).click();
  await expect(list).toContainText("该评论已删除");
  await expect(reply).toContainText("包材也一起定");
  await expect(tabs.getByRole("tab", { name: "评论 1" })).toBeVisible();
});

test("rich text, attachments and a comment on a field", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `field-comments-${suffix}@example.com`, `字段评论 ${suffix}`);
  await openItems(page);
  await createItem(page, "新品 F");
  const tabs = page.getByRole("tablist", { name: "详情页签" });

  // 悬停字段，点「评论」：切到评论页签，评论框带上字段和它现在的值
  const field = "是否需要旧型号退市评估";
  const row = page.locator(`[data-field-key="${field}"]`);
  await row.hover();
  await row.getByRole("button", { name: "针对字段评论" }).click();
  await expect(tabs.getByRole("tab", { name: /评论/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(`评论字段 ${field}`)).toBeVisible();

  // 加粗一段文字，@ 字段，再加一个附件
  const editor = page.getByLabel("评论内容");
  await editor.pressSequentially("先确认 ");
  await page.getByRole("button", { name: "加粗" }).click();
  await editor.pressSequentially("老型号的库存");
  await page.getByRole("button", { name: "加粗" }).click();
  await editor.pressSequentially(" 再改 @是否需要旧");
  await page.getByRole("listbox", { name: "提及" }).getByRole("option", { name: field }).click();
  await page.getByLabel("添加评论附件").setInputFiles({
    name: "库存.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("A 型号 120 件"),
  });
  await expect(page.getByRole("list", { name: "评论附件" })).toContainText("库存.txt");
  await page.getByRole("button", { name: "发表评论" }).click();

  const comment = page.getByRole("list", { name: "评论列表" }).getByLabel("Pascal的评论");
  await expect(comment.locator("strong, b")).toHaveText("老型号的库存");
  await expect(comment.getByRole("button", { name: `定位到字段 ${field}` })).toBeVisible();
  await expect(comment.getByRole("list", { name: "评论附件" })).toContainText("库存.txt");

  // 点话题回到字段所在的页签；字段旁显示评论数，点了只看这个字段的评论
  await comment.getByRole("button", { name: `定位到字段 ${field}` }).click();
  const count = row.getByRole("button", { name: "字段评论 1" });
  await expect(count).toBeVisible();
  await count.click();
  await expect(page.getByText(`只看「${field}」的评论`)).toBeVisible();
  await expect(page.getByRole("list", { name: "评论列表" }).getByLabel("Pascal的评论")).toHaveCount(1);
});
