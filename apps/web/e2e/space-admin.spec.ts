import { expect, test } from "@playwright/test";
import {
  addMember,
  choose,
  createItem,
  demoSpace,
  openItems,
  openSettings,
  registerColleague,
  signInOrgAdmin,
} from "./helpers";

const dialog = (page: import("@playwright/test").Page) => page.locator("[role=dialog][aria-modal=true]");

test("save a space as a template, create a space from it, copy a space, and see it in the operation log", async ({
  page,
}) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `tpl-${suffix}@example.com`, `模板源 ${suffix}`);
  await createItem(page, "示例新品");

  // 空间信息 → 存为模板，带上实例
  await openSettings(page, "空间信息");
  await page.getByRole("button", { name: "存为模板" }).click();
  await dialog(page).getByLabel("模板名称").fill(`新品模板 ${suffix}`);
  await dialog(page).getByLabel("模板说明").fill("新品开发的标准配置");
  await dialog(page).getByText("工作项实例").click();
  await dialog(page).getByRole("button", { name: "存为模板" }).click();
  await expect(page.getByText(`已存为模板「新品模板 ${suffix}」`)).toBeVisible();

  // 模板中心：我的模板里有它，预览，用它新建空间
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "模板中心" }).click();
  await page.getByRole("tablist", { name: "模板范围" }).getByRole("tab", { name: "我的模板" }).click();
  const card = page.getByRole("listitem", { name: `新品模板 ${suffix}` });
  await expect(card).toContainText("1 个实例");
  await card.getByRole("button", { name: `预览 新品模板 ${suffix}` }).click();
  await expect(dialog(page).getByRole("cell", { name: "项目" })).toBeVisible();
  await dialog(page).getByRole("button", { name: "使用模板" }).click();
  await dialog(page).getByLabel("空间名称").fill(`模板新建 ${suffix}`);
  await dialog(page).getByRole("button", { name: "创建" }).click();
  // 进了新空间：类型和实例都来自模板
  await expect(page.getByRole("button", { name: "切换空间" })).toContainText(`模板新建 ${suffix}`, { timeout: 30_000 });
  await openItems(page, "项目");
  await expect(page.getByRole("grid").getByRole("link", { name: "示例新品" })).toBeVisible();

  // 空间信息 → 复制空间：只复制配置
  await openSettings(page, "空间信息");
  await page.getByRole("button", { name: "复制空间" }).click();
  await expect(dialog(page).getByRole("tab", { name: "复制空间" })).toHaveAttribute("aria-selected", "true");
  await dialog(page).getByLabel("空间名称").fill(`复制出来 ${suffix}`);
  await dialog(page).getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("button", { name: "切换空间" })).toContainText(`复制出来 ${suffix}`, { timeout: 30_000 });
  await openItems(page, "项目");
  await expect(page.getByText("没有符合条件的工作项").or(page.getByText("还没有"))).toBeVisible();

  // 操作记录：复制空间记在新空间里
  await openSettings(page, "操作记录");
  const log = page.getByRole("table", { name: "审计日志" });
  await expect(log).toContainText("复制空间");
  await expect(log).toContainText(`复制出来 ${suffix}`);
});

test("teams: build a team tree and filter work items by team", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await registerColleague(`lin-team-${suffix}@example.com`, `Lin${suffix}`);
  await demoSpace(page, "Pascal", `team-${suffix}@example.com`, `团队 ${suffix}`);
  await addMember(page, `lin-team-${suffix}@example.com`, `Lin${suffix}`);
  await openItems(page);
  await createItem(page, "我自己的");
  await openItems(page);
  await createItem(page, "Lin 参与的", { roles: [`开发：Lin${suffix}`] });

  // 团队：建「研发」，再建挂在它下面的「前端」，Lin 在前端
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "团队", exact: true }).click();
  await page.getByRole("button", { name: "新建团队" }).first().click();
  await dialog(page).getByLabel("团队名称").fill(`研发 ${suffix}`);
  await dialog(page).getByRole("button", { name: "创建" }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole("button", { name: "新建团队" }).first().click();
  await dialog(page).getByLabel("团队名称").fill(`前端 ${suffix}`);
  await dialog(page).getByRole("group", { name: "上级团队" }).getByText(`研发 ${suffix}`).click();
  await dialog(page).getByRole("button", { name: "选择成员" }).click();
  await page
    .getByRole("list", { name: "选择成员 候选" })
    .getByRole("button", { name: new RegExp(`Lin${suffix}`) })
    .click();
  await page.keyboard.press("Escape");
  await dialog(page).getByRole("button", { name: "创建" }).click();
  await expect(dialog(page)).toHaveCount(0);
  const tree = page.getByRole("complementary", { name: "团队树" });
  await expect(tree.getByRole("button", { name: new RegExp(`^前端 ${suffix}`) })).toHaveCount(1);
  // 研发的成员含下级团队时有 Lin
  await tree.getByRole("button", { name: new RegExp(`^研发 ${suffix}`) }).click();
  await page.getByRole("tab", { name: /含下级团队/ }).click();
  await expect(page.getByRole("list", { name: "成员列表" })).toContainText(`Lin${suffix}`);

  // 列表按团队筛选：参与人属于「研发」（含下级团队）
  await page.goto("/");
  await page.getByRole("link", { name: `团队 ${suffix}` }).click();
  await openItems(page);
  const rows = page.getByRole("main").getByRole("row");
  await expect(rows.filter({ hasText: "我自己的" })).toHaveCount(1);
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await choose(page.getByLabel("条件 1-1 对象"), "参与人");
  await page.getByLabel("条件 1-1 值", { exact: true }).click();
  await page.getByRole("list", { name: "条件 1-1 值 选项" }).getByLabel(`团队：研发 ${suffix}`).check();
  await page.getByLabel("条件 1-1 值", { exact: true }).click();
  await page.getByRole("button", { name: "应用" }).click();
  await expect(rows.filter({ hasText: "Lin 参与的" })).toHaveCount(1);
  await expect(rows.filter({ hasText: "我自己的" })).toHaveCount(0);
});

test("org admins see every space's audit log and manage org admins", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await registerColleague(`helper-${suffix}@example.com`, `助手${suffix}`);
  await signInOrgAdmin(page);
  await page.getByRole("button", { name: "账号" }).click();
  await page.getByRole("menuitem", { name: "企业管理" }).click();
  const members = page.getByRole("list", { name: "企业成员" });
  await page.getByLabel("搜索成员").fill(`助手${suffix}`);
  await members.getByRole("button", { name: `设 助手${suffix} 为企业管理员` }).click();
  await expect(members.getByText("企业管理员")).toBeVisible();
  await members.getByRole("button", { name: `取消 助手${suffix} 的企业管理员` }).click();
  await expect(members.getByText("企业管理员")).toHaveCount(0);

  await page.getByRole("tablist", { name: "企业管理" }).getByRole("tab", { name: "审计日志" }).click();
  const log = page.getByRole("table", { name: "审计日志" });
  await expect(log).toContainText("设置企业管理员");
  await choose(page.getByLabel("分类"), "企业");
  await expect(log.getByRole("row").filter({ hasText: "注册" })).toHaveCount(0);
  await expect(log).toContainText(`助手${suffix}`);
});
