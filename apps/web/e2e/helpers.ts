import { expect, type Locator, type Page, request } from "@playwright/test";

export const API_URL = process.env.API_URL ?? "http://localhost:3000";
export const PASSWORD = "correct-horse-battery";

/** 用接口注册一个同事账号（不影响当前页面的登录态）。 */
export async function registerColleague(email: string, name: string) {
  const api = await request.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: { origin: process.env.WEB_URL ?? "http://localhost:5173" },
  });
  const res = await api.post("/api/auth/sign-up/email", { data: { email, password: PASSWORD, name } });
  expect(res.ok()).toBe(true);
}

/** 在登录页注册并登录，停在“我的空间”。 */
export async function signUp(page: Page, name: string, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: "没有账号？注册" }).click();
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.getByRole("heading", { name: "我的空间" })).toBeVisible();
}

/** 新建空间并进入它的仪表盘。等自己的管理员身份同步下来，否则客户端会先以为自己不是管理员。 */
export async function createSpace(page: Page, name: string) {
  await page.getByRole("button", { name: "新建空间" }).first().click();
  await page.locator("[role=dialog][aria-modal=true]").getByLabel("空间名称").fill(name);
  await page.locator("[role=dialog][aria-modal=true]").getByRole("button", { name: "创建" }).click();
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("button", { name: "导入 OEM 模板" })).toBeVisible();
}

/** 导入 OEM 模板，等「项目」出现在左侧导航的工作项里。 */
export async function importOem(page: Page) {
  await page.getByRole("button", { name: "导入 OEM 模板" }).click();
  await expect(workItemNav(page).getByRole("link", { name: "项目", exact: true })).toBeVisible();
  await openItems(page, "项目");
}

/** 注册、建空间、导入 OEM，一步到位。 */
export async function oemSpace(page: Page, user: string, email: string, space: string) {
  await signUp(page, user, email);
  await createSpace(page, space);
  await importOem(page);
}

/** 打开新建工作项的弹窗，填名称（和可选的角色），创建后停在工作项页。 */
export async function createItem(
  page: Page,
  name: string,
  options: { label?: string; roles?: string[]; before?: (dialog: ReturnType<Page["getByRole"]>) => Promise<void> } = {},
) {
  await page.getByRole("button", { name: /^新建/ }).click();
  const dialog = page.locator("[role=dialog][aria-modal=true]");
  await dialog.getByLabel(options.label ?? "项目名称").fill(name);
  if (options.roles?.length) {
    await dialog.getByText("角色和负责人").click();
    for (const role of options.roles) {
      const [roleName] = role.split("：");
      await dialog.getByRole("button", { name: `设置${roleName}` }).click();
      await page.getByRole("button", { name: role }).click();
      await page.keyboard.press("Escape");
    }
  }
  await options.before?.(dialog);
  await dialog.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

/** 在空间配置的「权限」页签里按邮箱加成员。 */
export async function addMember(page: Page, email: string, name: string) {
  await openSettings(page, "权限");
  await page.getByLabel("按邮箱添加成员").fill(email);
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(page.getByRole("list", { name: "成员列表" }).getByText(name, { exact: true })).toBeVisible();
}

const nav = (page: Page) => page.getByRole("navigation", { name: "主导航" });
/** 左侧导航里每个工作项一个入口。 */
const workItemNav = (page: Page) => nav(page).getByRole("region", { name: "工作项" });

/** 左侧导航进某个工作项的主页（不指定时进第一个），停在「工作项列表」。 */
export async function openItems(page: Page, typeName?: string) {
  const nav = workItemNav(page);
  await (typeName ? nav.getByRole("link", { name: typeName, exact: true }) : nav.getByRole("link").first()).click();
  await expect(page.getByRole("tab", { name: "工作项列表" })).toHaveAttribute("aria-selected", "true");
}

type SettingTab = "空间信息" | "工作项" | "权限" | "关联" | "自动化" | "回收站";
/** 左侧导航进空间配置，切到某个页签（默认「工作项」）。 */
export async function openSettings(page: Page, tab: SettingTab = "工作项") {
  await nav(page).getByRole("link", { name: "空间配置" }).click();
  await expect(page.getByRole("heading", { name: "空间配置" })).toBeVisible();
  await page.getByRole("tablist", { name: "空间配置" }).getByRole("tab", { name: tab }).click();
}
export async function openAutomations(page: Page) {
  await openSettings(page, "自动化");
}

/** 空间配置 → 工作项 → 点进某个工作项的配置页。 */
export async function openTypeConfig(page: Page, typeName: string) {
  await page
    .getByRole("list", { name: "工作项类型" })
    .getByRole("link", { name: new RegExp(`^${typeName}`) })
    .click();
  await expect(page.getByRole("tablist", { name: "工作项配置" })).toBeVisible();
}

/** 工作项配置页里切页签：基本信息、字段、页面布局、流程、角色、列。 */
export async function typeTab(page: Page, tab: "基本信息" | "字段" | "页面布局" | "流程" | "角色" | "列" | "权限") {
  await page.getByRole("tablist", { name: "工作项配置" }).getByRole("tab", { name: tab }).click();
}

/** 空间配置 → 工作项 → 高级设置 → 关系管理里新建一条关系，两端各有一个字段。 */
export async function createRelation(
  page: Page,
  relation: { from: string; to: string; name: string; reverseName?: string; cardinality?: "one" | "many" },
) {
  await openSettings(page);
  await page.getByRole("link", { name: "高级设置" }).click();
  await page.getByRole("button", { name: "新建关系" }).click();
  const dialog = page.locator("[role=dialog][aria-modal=true]");
  await choose(dialog.getByRole("combobox", { name: "本端工作项", exact: true }), { label: relation.from });
  await choose(dialog.getByRole("combobox", { name: "对端工作项", exact: true }), { label: relation.to });
  await dialog.getByRole("textbox", { name: /^本端字段名称/ }).fill(relation.name);
  if (relation.reverseName) await dialog.getByRole("textbox", { name: /^对端字段名称/ }).fill(relation.reverseName);
  if (relation.cardinality === "one")
    await choose(dialog.getByRole("combobox", { name: "本端字段数量", exact: true }), "one");
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(page.getByRole("table", { name: "关系列表" })).toContainText(relation.name);
  await page.getByRole("link", { name: "关闭" }).click();
  await expect(page.getByRole("heading", { name: "空间配置" })).toBeVisible();
}

/** 工作项配置页右上角关闭（流程编辑器里点面包屑），回到空间配置。 */
export async function closeTypeConfig(page: Page) {
  const close = page.getByRole("link", { name: "关闭" });
  if (await close.count()) await close.click();
  else await page.getByRole("navigation", { name: "位置" }).getByRole("link", { name: "空间配置" }).click();
  await expect(page.getByRole("heading", { name: "空间配置" })).toBeVisible();
}

/**
 * 在下拉框（Semi Select）里选一项：先点开，再点选项。
 * 传字符串时按选项的值或文字找，传 { label } 时只按文字找。
 */
export async function choose(select: Locator, option: string | { label: string }) {
  const page = select.page();
  const combobox = (await select.getAttribute("role")) === "combobox" ? select : select.getByRole("combobox");
  await combobox.click();
  const options = page.locator(".semi-select-option:visible");
  const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  const target =
    typeof option === "string"
      ? options.filter({ has: page.locator(`[data-value="${option}"]`) }).or(options.filter({ hasText: exact(option) }))
      : options.filter({ hasText: exact(option.label) });
  await target.first().click();
  // 等下拉收起，选中值才算落定
  await expect(options).toHaveCount(0);
}

/** 按 name 找表单里的下拉框。 */
export function selectByName(page: Page | Locator, name: string) {
  return page.locator(`span:has(> input[name="${name}"])`).getByRole("combobox");
}
