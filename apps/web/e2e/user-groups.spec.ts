import { expect, type Page, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  createSpace,
  importDemo,
  openItems,
  openSettings,
  openTypeConfig,
  PASSWORD,
  registerColleague,
  signUp,
  typeTab,
} from "./helpers";

async function logIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的空间" })).toBeVisible();
}

test("user groups and type permissions decide who sees and creates work items", async ({ page, browser }) => {
  const suffix = `${Date.now()}`;
  const linEmail = `lin-group-${suffix}@example.com`;
  const wangEmail = `wang-group-${suffix}@example.com`;
  await registerColleague(linEmail, "Lin");
  await registerColleague(wangEmail, "Wang");
  await signUp(page, "Pascal", `groups-${suffix}@example.com`);
  await createSpace(page, `用户组 ${suffix}`);
  await importDemo(page);
  await createItem(page, "面霜立项");
  const itemUrl = page.url();

  // 两个成员，Lin 进「质量组」
  await openSettings(page, "权限");
  for (const email of [linEmail, wangEmail]) {
    await page.getByLabel("按邮箱添加成员").fill(email);
    await page.getByRole("button", { name: "添加", exact: true }).click();
  }
  await expect(page.getByLabel("Wang的空间角色")).toBeVisible();
  await page.getByLabel("新用户组名称").fill("质量组");
  await page.getByRole("button", { name: "新建用户组" }).click();
  await page.getByRole("checkbox", { name: "Lin 加入 质量组" }).check();
  await expect(page.getByRole("list", { name: "用户组列表" })).toContainText("Lin");

  // 项目：空间成员只能看自己参与的，质量组看全部；只有质量组能新建
  await openSettings(page);
  await openTypeConfig(page, "项目");
  await typeTab(page, "权限");
  await choose(page.getByLabel("空间成员 查看工作项"), "involved");
  await choose(page.getByLabel("质量组 查看工作项"), "all");
  await choose(page.getByLabel("空间成员 新建"), "deny");
  await choose(page.getByLabel("质量组 新建"), "allow");
  await page.getByRole("button", { name: "保存权限" }).click();
  await expect(page.getByText("已保存")).toBeVisible();
  await closeTypeConfig(page);

  // Lin（质量组）看得到面霜立项；Wang 看不到
  const linContext = await browser.newContext();
  const lin = await linContext.newPage();
  await logIn(lin, linEmail);
  await lin.goto(itemUrl);
  await expect(lin.getByRole("heading", { name: "面霜立项" })).toBeVisible();
  await linContext.close();

  const wangContext = await browser.newContext();
  const wang = await wangContext.newPage();
  await logIn(wang, wangEmail);
  await wang.goto(itemUrl);
  await expect(wang.getByText("工作项不存在或没有权限")).toBeVisible();
  await wangContext.close();

  // 空间成员不可见时，导航里也没有「项目」；管理员照常
  await openSettings(page);
  await openTypeConfig(page, "项目");
  await typeTab(page, "权限");
  await choose(page.getByLabel("空间成员 查看工作项"), "none");
  await page.getByRole("button", { name: "保存权限" }).click();
  await expect(page.getByText("已保存")).toBeVisible();
  await closeTypeConfig(page);
  await openItems(page, "项目");
  await expect(page.getByRole("link", { name: "面霜立项" })).toBeVisible();

  const wang2Context = await browser.newContext();
  const wang2 = await wang2Context.newPage();
  await logIn(wang2, wangEmail);
  await wang2.getByText(`用户组 ${suffix}`).click();
  await expect(wang2.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "空间配置" })).toBeVisible();
  await expect(
    wang2.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "项目", exact: true }),
  ).toHaveCount(0);
  await wang2Context.close();
});
