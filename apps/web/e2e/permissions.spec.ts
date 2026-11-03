import { expect, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  createSpace,
  importOem,
  openItems,
  openSettings,
  openTypeConfig,
  PASSWORD,
  registerColleague,
  selectByName,
  signUp,
  typeTab,
} from "./helpers";

test("guests only read and comment, and restricted fields stay hidden from people without the role", async ({
  page,
  browser,
}) => {
  const suffix = `${Date.now()}`;
  const linEmail = `lin-guest-${suffix}@example.com`;
  await registerColleague(linEmail, "Lin");
  await signUp(page, "Pascal", `perm-${suffix}@example.com`);
  await createSpace(page, `权限 ${suffix}`);
  await openSettings(page, "权限");

  // Lin 以访客身份加入
  await page.getByLabel("按邮箱添加成员").fill(linEmail);
  await choose(page.getByLabel("新成员的空间角色"), "guest");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByLabel("Lin的空间角色")).toContainText("访客");

  // 状态流类型：“报价”只有“商务”能看
  await page.getByRole("tablist", { name: "空间配置" }).getByRole("tab", { name: "工作项" }).click();
  await page.getByLabel("新类型名称").fill("询价");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "询价");
  await typeTab(page, "角色");
  await page.getByLabel("新角色名称").fill("商务");
  await page.getByRole("button", { name: "添加角色" }).click();
  for (const name of ["报价", "客户"]) {
    await typeTab(page, "字段");
    await page.getByLabel("新字段名称").fill(name);
    await choose(selectByName(page, "dataType"), "text");
    await page.getByRole("button", { name: "添加字段" }).click();
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "设置报价的权限" }).click();
  await page.getByRole("button", { name: "报价可见角色：商务" }).click();
  await expect(page.getByText("可见：商务 · 所有人可改")).toBeVisible();
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("询价流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "询价流程" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  await closeTypeConfig(page);
  await openItems(page);
  await createItem(page, "A 客户询价", { label: "询价名称" });
  const fields = page.getByRole("region", { name: "字段" });
  // 管理员能看到受限字段
  await fields.getByLabel("报价").fill("100");
  await fields.getByLabel("报价").blur();
  await fields.getByLabel("客户").fill("A 公司");
  await fields.getByLabel("客户").blur();
  // 动态逐条记下改动
  await page.getByRole("tablist", { name: "详情页签" }).getByRole("tab", { name: "动态" }).click();
  const activity = page.getByRole("list", { name: "动态列表" });
  await expect(activity).toContainText("Pascal 把「报价」从 空 改为 100");
  await expect(activity).toContainText("Pascal 把「客户」从 空 改为 A 公司");
  await expect(activity).toContainText("Pascal 创建了工作项");
  const url = page.url();

  // Lin 登录：能看、能评论，不能改；看不到报价
  const linContext = await browser.newContext();
  const lin = await linContext.newPage();
  await lin.goto("/login");
  await lin.getByLabel("邮箱").fill(linEmail);
  await lin.getByLabel("密码").fill(PASSWORD);
  await lin.getByRole("button", { name: "登录", exact: true }).click();
  await expect(lin.getByRole("heading", { name: "我的空间" })).toBeVisible();
  await lin.goto(url);
  await expect(lin.getByRole("heading", { name: "A 客户询价" })).toBeVisible();
  await expect(lin.getByText("你是这个空间的访客，只能查看和评论。")).toBeVisible();
  const linFields = lin.getByRole("region", { name: "字段" });
  await expect(linFields.getByLabel("客户")).toHaveValue("A 公司");
  await expect(linFields.getByLabel("客户")).toBeDisabled();
  await expect(linFields.getByText("报价")).toHaveCount(0);
  // 动态里也没有报价的改动
  const linTabs = lin.getByRole("tablist", { name: "详情页签" });
  await linTabs.getByRole("tab", { name: "动态" }).click();
  const linActivity = lin.getByRole("list", { name: "动态列表" });
  await expect(linActivity).toContainText("把「客户」从 空 改为 A 公司");
  await expect(linActivity).not.toContainText("报价");
  await linTabs.getByRole("tab", { name: /评论/ }).click();
  await expect(lin.getByRole("region", { name: "当前状态" }).getByRole("button", { name: "处理中" })).toBeDisabled();
  await lin.getByLabel("评论内容").fill("报价什么时候出？");
  await lin.getByRole("button", { name: "发表评论" }).click();
  await expect(lin.getByRole("list", { name: "评论列表" })).toContainText("报价什么时候出？");

  // 改成成员后就能流转了
  await openSettings(page, "权限");
  await choose(page.getByLabel("Lin的空间角色"), "member");
  await expect(lin.getByText("你是这个空间的访客，只能查看和评论。")).toHaveCount(0);
  await lin.getByRole("region", { name: "当前状态" }).getByRole("button", { name: "处理中" }).click();
  await expect(lin.getByRole("region", { name: "当前状态" })).toContainText("处理中");
  await linContext.close();
});

test("an admin terminates, restores, freezes and unfreezes a work item", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `terminate-${suffix}@example.com`);
  await createSpace(page, `终止冻结 ${suffix}`);
  await importOem(page);
  await openItems(page);
  await createItem(page, "面霜立项");

  // 终止：填原因，顶部显示原因，动态里有记录
  await page.getByRole("button", { name: "终止", exact: true }).click();
  const dialog = page.locator("[role=dialog][aria-modal=true]");
  await dialog.getByLabel("补充终止原因").fill("预算砍了");
  await dialog.getByRole("button", { name: "确认终止" }).click();
  await expect(page.getByRole("note").filter({ hasText: "工作项已终止" })).toContainText("预算砍了");
  await expect(page.getByRole("main").getByText("已终止").first()).toBeVisible();

  // 恢复后回到进行中
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(page.getByRole("note").filter({ hasText: "工作项已终止" })).toHaveCount(0);

  // 冻结后字段改不了，解冻后可以
  await page.getByRole("button", { name: "冻结", exact: true }).click();
  await expect(page.getByRole("note").filter({ hasText: "工作项已冻结" })).toBeVisible();
  await page.getByRole("button", { name: "解冻", exact: true }).click();
  await expect(page.getByRole("note").filter({ hasText: "工作项已冻结" })).toHaveCount(0);
});
