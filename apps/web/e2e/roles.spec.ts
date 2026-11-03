import { expect, test } from "@playwright/test";
import {
  addMember,
  choose,
  closeTypeConfig,
  createSpace,
  openSettings,
  openTypeConfig,
  registerColleague,
  selectByName,
  signUp,
  typeTab,
} from "./helpers";

test("business lines drive which roles appear and who is assigned by default", async ({ page }) => {
  const suffix = `${Date.now()}`;
  const linEmail = `lin-roles-${suffix}@example.com`;
  await registerColleague(linEmail, "Lin");
  await signUp(page, "Pascal", `roles-${suffix}@example.com`);
  await createSpace(page, `角色 ${suffix}`);
  await addMember(page, linEmail, "Lin");
  await openSettings(page, "空间信息");

  // 业务线树：KIMTRUE / 且初，ONCUR
  const lines = page.getByLabel("新业务线");
  await lines.fill("KIMTRUE/且初");
  await lines.press("Enter");
  await lines.fill("ONCUR");
  await lines.press("Enter");
  await page.getByRole("button", { name: "保存业务线" }).click();
  await expect(page.getByRole("button", { name: "保存业务线" })).toBeDisabled();

  await page.getByRole("tablist", { name: "空间配置" }).getByRole("tab", { name: "工作项" }).click();
  await page.getByLabel("新类型名称").fill("立项");
  await choose(page.getByLabel("流程方式"), "state");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "立项");

  await typeTab(page, "字段");
  await page.getByLabel("新字段名称").fill("业务线");
  await choose(selectByName(page, "dataType"), "businessLine");
  await page.getByRole("button", { name: "添加字段" }).click();
  for (const name of ["NPD", "风控审核"]) {
    await typeTab(page, "角色");
    await page.getByLabel("新角色名称").fill(name);
    await page.getByRole("button", { name: "添加角色" }).click();
    await expect(page.getByRole("button", { name: `配置角色 ${name}` })).toBeVisible();
  }
  const sheet = page.locator(".semi-sidesheet");

  // NPD：业务线是 KIMTRUE（含下级）时默认是 Lin，单人
  await page.getByRole("button", { name: "配置角色 NPD" }).click();
  await sheet.getByLabel("限制为单人").check();
  await sheet.getByRole("tablist", { name: "成员分配" }).getByRole("tab", { name: "按条件默认分配" }).click();
  await choose(sheet.getByLabel("判断", { exact: true }), "equal");
  await choose(sheet.getByLabel("值", { exact: true }), { label: "KIMTRUE" });
  await choose(sheet.getByLabel("给条件组 1 的成员加人"), { label: "Lin" });
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("按条件分配（1 组）")).toBeVisible();

  // 风控审核：只有业务线是 ONCUR 时出现
  await page.getByRole("button", { name: "配置角色 风控审核" }).click();
  await sheet.getByRole("tablist", { name: "出现方式" }).getByRole("tab", { name: "满足条件出现" }).click();
  await choose(sheet.getByLabel("判断", { exact: true }), "equal");
  await choose(sheet.getByLabel("值", { exact: true }), { label: "ONCUR" });
  await sheet.getByRole("button", { name: "保存" }).click();
  await expect(sheet).toBeHidden();

  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("立项流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "立项流程" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  await closeTypeConfig(page);
  const nav = page.getByRole("navigation", { name: "主导航" });
  await nav.getByRole("link", { name: "立项" }).click();
  await page.getByRole("button", { name: /^新建/ }).click();
  const dialog = page.locator("[role=dialog][aria-modal=true]");
  await dialog.getByLabel("立项名称").fill("且初精华");
  // 选「KIMTRUE / 且初」：Semi 级联选择
  await dialog.getByRole("combobox", { name: "业务线" }).click();
  await page.locator(".semi-cascader-option").filter({ hasText: "KIMTRUE" }).click();
  await page.locator(".semi-cascader-option").filter({ hasText: "且初" }).click();
  await expect(dialog.getByRole("combobox", { name: "业务线" })).toContainText("且初");
  await dialog.getByText("角色和负责人").click();
  const npd = dialog.locator("dl > div").filter({ hasText: "NPD" });
  await expect(npd).toContainText("Lin");
  await expect(dialog.locator("dl > div").filter({ hasText: "风控审核" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "创建" }).click();

  const roles = page.getByRole("region", { name: "角色", exact: true });
  await expect(roles.locator("dl > div").filter({ hasText: "NPD" })).toContainText("Lin");
  await expect(roles.getByText("风控审核")).toHaveCount(0);
  // 手动添加默认不出现的角色
  await roles.getByText("添加角色").click();
  await page.getByRole("button", { name: "添加角色 风控审核" }).click();
  await expect(roles.getByText("风控审核")).toBeVisible();
});
