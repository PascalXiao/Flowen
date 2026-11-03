import { expect, test } from "@playwright/test";
import { choose, createItem, oemSpace, openAutomations, openItems } from "./helpers";

test("an automation rule fills a field on new work items through the Temporal worker", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `automation-${suffix}@example.com`, `自动化 ${suffix}`);

  // 新建规则：工作项创建后，把“关联需求SKU流程”填成 SKU-AUTO
  await openAutomations(page);
  await expect(page.getByText("还没有自动化规则。")).toBeVisible();
  await page.getByLabel("规则名称").fill("创建后填 SKU");
  await choose(page.getByLabel("触发时机"), "工作项创建后");
  await page.getByRole("button", { name: "添加动作" }).click();
  const action = page.getByRole("group", { name: "动作 1" });
  await choose(action.getByLabel("动作类型"), "修改字段");
  await choose(action.getByRole("combobox", { name: "字段", exact: true }), "关联需求SKU流程");
  await action.getByLabel("设为").fill("SKU-AUTO");
  await page.getByRole("button", { name: "保存规则" }).click();
  const rule = page.getByRole("region", { name: "创建后填 SKU" });
  await expect(rule).toContainText("工作项创建后，把「关联需求SKU流程」设为 SKU-AUTO");

  // 创建工作项：事件经 Outbox → Temporal → worker 执行规则，字段值同步回页面
  await openItems(page);
  await createItem(page, "新品 G");
  await expect(page.getByLabel("关联需求SKU流程")).toHaveValue("SKU-AUTO", { timeout: 30_000 });

  // 执行记录
  await openAutomations(page);
  await expect(rule.getByRole("list", { name: "执行记录" })).toContainText("成功");
  await expect(rule.getByRole("list", { name: "执行记录" })).toContainText("新品 G");

  // 停用后新的工作项不再被修改
  await rule.getByLabel("启用").uncheck();
  await expect(rule.getByLabel("启用")).not.toBeChecked();
});

test("a comment triggers a reply comment and a notification, and a rule can be edited", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `automation-comment-${suffix}@example.com`, `自动化评论 ${suffix}`);

  await openAutomations(page);
  await page.getByLabel("规则名称").fill("评论后回复");
  await choose(page.getByLabel("触发时机"), "有新评论时");
  await page.getByRole("button", { name: "添加动作" }).click();
  const reply = page.getByRole("group", { name: "动作 1" });
  await choose(reply.getByLabel("动作类型"), "添加评论");
  await reply.getByLabel("评论内容").fill("已收到「{{name}}」的评论");
  await page.getByRole("button", { name: "添加动作" }).click();
  const notice = page.getByRole("group", { name: "动作 2" });
  await choose(notice.getByLabel("动作类型"), "发送通知");
  await notice.getByLabel("通知内容").fill("「{{name}}」有新评论");
  await notice.getByLabel("通知 触发人").check();
  await page.getByRole("button", { name: "保存规则" }).click();
  const rule = page.getByRole("region", { name: "评论后回复" });
  await expect(rule).toContainText("有新评论时，评论「已收到「{{name}}」的评论」；通知触发人：「{{name}}」有新评论");

  // 编辑：只改名称
  await rule.getByRole("button", { name: "编辑" }).click();
  await rule.getByLabel("规则名称").fill("评论后自动回复");
  await rule.getByRole("button", { name: "保存规则" }).click();
  const renamed = page.getByRole("region", { name: "评论后自动回复" });
  await expect(renamed).toContainText("通知触发人");

  await openItems(page);
  await createItem(page, "新品 R");
  const bell = page.getByRole("button", { name: /^通知/ });
  // 先清掉节点轮到自己的通知
  await expect(bell).toHaveAccessibleName(/未读/, { timeout: 30_000 });
  await bell.click();
  await page.getByRole("button", { name: "全部已读" }).click();
  await bell.click();

  await page.getByRole("tablist", { name: "详情页签" }).getByRole("tab", { name: /评论/ }).click();
  await page.getByLabel("评论内容").fill("什么时候能打样？");
  await page.getByRole("button", { name: "发表评论" }).click();
  await expect(page.getByRole("list", { name: "评论列表" })).toContainText("已收到「新品 R」的评论", {
    timeout: 30_000,
  });
  await expect(bell).toHaveAccessibleName(/未读/, { timeout: 30_000 });
  await bell.click();
  await expect(page.getByRole("list", { name: "通知列表" })).toContainText("「新品 R」有新评论");
});

test("schedule and due-date triggers with a condition branch are configured and described", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await oemSpace(page, "Pascal", `automation-timed-${suffix}@example.com`, `定时自动化 ${suffix}`);
  await openAutomations(page);

  // 每周一、周五 10 点：满足条件发通知，否则评论
  await page.getByLabel("规则名称").fill("每周巡检");
  await choose(page.getByLabel("触发时机"), "定时触发");
  await choose(page.getByLabel("频率"), "每周");
  await page.getByRole("group", { name: "每周哪几天" }).getByLabel("周五").check();
  await choose(page.getByRole("combobox", { name: "时间" }), "10:00");
  await page
    .getByRole("group", { name: "执行条件（不加表示总是执行）" })
    .getByRole("button", { name: "+ 添加条件" })
    .click();
  await choose(page.getByLabel("判断"), "不为空");
  await page.getByRole("button", { name: "添加动作", exact: true }).click();
  const main = page.getByRole("group", { name: "动作 1" });
  await choose(main.getByLabel("动作类型"), "发送通知");
  await main.getByLabel("通知内容").fill("「{{name}}」本周要巡检");
  await main.getByLabel("通知 创建人").check();
  await page.getByRole("button", { name: "添加分支" }).click();
  const branch = page.getByRole("region", { name: "分支 1" });
  await branch.getByRole("button", { name: "给分支 1 添加动作" }).click();
  const branchAction = branch.getByRole("group", { name: "分支 1 动作 1" });
  await choose(branchAction.getByLabel("动作类型"), "添加评论");
  await branchAction.getByLabel("评论内容").fill("请补充信息");
  await page.getByRole("button", { name: "保存规则" }).click();
  const weekly = page.getByRole("region", { name: "每周巡检" });
  await expect(weekly).toContainText("每周一、周五 10:00");
  await expect(weekly).toContainText("通知创建人：「{{name}}」本周要巡检；否则评论「请补充信息」");

  // 节点计划完成日前 2 天 9 点提醒
  await page.getByLabel("规则名称").fill("到期提醒");
  await choose(page.getByLabel("触发时机"), "日期临近、到期或超期时");
  await choose(page.getByLabel("按哪个日期"), "节点「需求立项提案」计划完成");
  await page.getByLabel("天数").fill("2");
  await page.getByRole("button", { name: "添加动作", exact: true }).click();
  const remind = page.getByRole("group", { name: "动作 1" });
  await choose(remind.getByLabel("动作类型"), "添加评论");
  await remind.getByLabel("评论内容").fill("快到期了");
  await page.getByRole("button", { name: "保存规则" }).click();
  await expect(page.getByRole("region", { name: "到期提醒" })).toContainText(
    "「需求立项提案」计划完成日前 2 天 09:00，评论「快到期了」",
  );
});
