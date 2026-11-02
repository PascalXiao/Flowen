import { expect, test } from "@playwright/test";
import {
  choose,
  closeTypeConfig,
  createItem,
  createRelation,
  createSpace,
  openItems,
  openSettings,
  openTypeConfig,
  selectByName,
  signUp,
  typeTab,
} from "./helpers";

test("a node's tasks and completion form gate its confirm", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `tasks-${suffix}@example.com`);
  await createSpace(page, `子任务 ${suffix}`);
  await openSettings(page);

  // 类型：一个角色、一个文本字段；流程：开始 → 开发（预置子任务“自测”，完成表单要填版本号）
  await page.getByLabel("新类型名称").fill("需求");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "需求");
  await typeTab(page, "角色");
  await page.getByLabel("新角色名称").fill("开发");
  await page.getByRole("button", { name: "添加角色" }).click();
  await typeTab(page, "字段");
  await page.getByLabel("新字段名称").fill("版本号");
  await choose(selectByName(page, "dataType"), "text");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("cell", { name: "版本号", exact: true })).toBeVisible();
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认流程" }).click();

  const node = (name: string) => page.locator(".react-flow__node", { hasText: name });
  const editor = page.getByRole("main");
  await node("开始").click();
  await page.getByRole("button", { name: "添加节点" }).click();
  await editor.getByLabel("节点名称").fill("开发");
  await editor.getByLabel("开发", { exact: true }).check();
  await choose(editor.getByLabel("添加表单字段"), "版本号");
  await expect(editor.getByLabel("版本号必填")).toBeChecked();
  await editor.getByLabel("预置子任务名称").fill("自测");
  await editor.getByRole("button", { name: "添加", exact: true }).click();
  await expect(node("开发")).toContainText("有表单 · 1 个子任务");
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();

  await closeTypeConfig(page);
  await openItems(page);
  await createItem(page, "导出报表", { label: "需求名称" });
  const current = page.getByRole("main").getByRole("region", { name: "开发" });
  const tasks = current.getByRole("list", { name: "开发的子任务" });
  await expect(tasks.getByText("自测")).toBeVisible();

  // 加一个子任务并指派给自己
  await current.getByLabel("给开发添加子任务").fill("写文档");
  await current.getByLabel("给开发添加子任务").press("Enter");
  await expect(tasks.getByText("写文档")).toBeVisible();
  await current.getByRole("button", { name: "写文档的负责人" }).click();
  await page.getByRole("button", { name: "Pascal" }).click();
  await expect(current.getByRole("button", { name: "写文档的负责人" })).toHaveAttribute("title", "Pascal");
  await page.keyboard.press("Escape");

  // 子任务没做完不能确认
  await current.getByRole("button", { name: "确认完成" }).click();
  await page.locator("[role=dialog][aria-modal=true]").getByLabel("版本号").fill("1.0");
  await page.locator("[role=dialog][aria-modal=true]").getByRole("button", { name: "确认完成" }).click();
  await expect(page.locator("[role=dialog][aria-modal=true]").getByRole("alert")).toContainText(
    "还有 2 个子任务没完成",
  );
  await page.locator("[role=dialog][aria-modal=true]").getByRole("button", { name: "取消" }).click();

  await current.getByLabel("完成子任务：自测").check();
  await current.getByLabel("完成子任务：写文档").check();
  await expect(current.getByText("2/2")).toBeVisible();

  // 填完成表单后节点完成，版本号写进字段
  await current.getByRole("button", { name: "确认完成" }).click();
  await page.locator("[role=dialog][aria-modal=true]").getByLabel("版本号").fill("1.0");
  await page.locator("[role=dialog][aria-modal=true]").getByRole("button", { name: "确认完成" }).click();
  await expect(page.locator("[role=dialog][aria-modal=true]")).toHaveCount(0);
  await expect(page.getByText("流程已走完。")).toBeVisible();
  await expect(page.getByRole("main").getByPlaceholder("未填写")).toHaveValue("1.0");

  // 完成的节点上，子任务只读
  await node("开发").click();
  await expect(page.getByLabel("完成子任务：自测")).toBeDisabled();
});

test("a node shows related info from the linked work item", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `node-info-${suffix}@example.com`);
  await createSpace(page, `节点关联信息 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("评审");
  await page.getByRole("button", { name: "新建类型" }).click();
  await createRelation(page, { from: "评审", to: "评审", name: "关联项目" });
  await openTypeConfig(page, "评审");
  await typeTab(page, "字段");
  await page.getByLabel("新字段名称").fill("品牌");
  await choose(selectByName(page, "dataType"), "text");
  await page.getByRole("button", { name: "添加字段" }).click();
  await expect(page.getByRole("cell", { name: "品牌", exact: true })).toBeVisible();
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认流程" }).click();

  const node = (name: string) => page.locator(".react-flow__node", { hasText: name });
  const editor = page.getByRole("main");
  await node("开始").click();
  await page.getByRole("button", { name: "添加节点" }).click();
  await editor.getByLabel("节点名称").fill("预审");
  await editor.getByLabel("关联名").fill("关联项目");
  await editor.getByLabel("对端字段").fill("品牌");
  await editor.getByRole("button", { name: "添加关联信息" }).click();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await closeTypeConfig(page);

  await openItems(page);
  await createItem(page, "面霜项目", { label: "评审名称" });
  const fields = page.getByRole("region", { name: "字段" });
  await fields.getByLabel("品牌", { exact: true }).fill("ddg");
  await fields.getByLabel("品牌", { exact: true }).blur();
  await openItems(page);
  await createItem(page, "面霜需求评审", { label: "评审名称" });
  const info = page.getByRole("main").getByRole("region", { name: "预审" }).getByLabel("预审的关联信息");
  await expect(info.getByLabel("品牌")).toHaveText("—");
  const group = page.getByRole("main").getByRole("region", { name: "关联项目" });
  await choose(group.getByLabel("添加关联项目"), { label: "面霜项目" });
  await expect(info.getByLabel("品牌")).toHaveText("ddg");
});

test("a node asks for estimate and actual hours, and hours are required to complete it", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await signUp(page, "Pascal", `effort-${suffix}@example.com`);
  await createSpace(page, `估分工时 ${suffix}`);
  await openSettings(page);
  await page.getByLabel("新类型名称").fill("需求");
  await page.getByRole("button", { name: "新建类型" }).click();
  await openTypeConfig(page, "需求");
  await typeTab(page, "流程");
  await page.getByLabel("新模板名称").fill("默认流程");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("link", { name: "默认流程" }).click();
  const node = (name: string) => page.locator(".react-flow__node", { hasText: name });
  const editor = page.getByRole("main");
  await node("开始").click();
  await page.getByRole("button", { name: "添加节点" }).click();
  await editor.getByLabel("节点名称").fill("财务分析");
  await editor.getByText("节点设置", { exact: true }).click();
  await editor.getByLabel("显示估分").check();
  await editor.getByLabel("显示实际工时").check();
  await editor.getByLabel("完成时实际工时必填").check();
  await page.getByRole("button", { name: "发布" }).click();
  await expect(page.getByText("v1 已发布（当前版本）")).toBeVisible();
  await closeTypeConfig(page);

  await openItems(page);
  await createItem(page, "面霜立项", { label: "需求名称" });
  const current = page.getByRole("main").getByRole("region", { name: "财务分析" });
  await current.getByLabel("财务分析估分").fill("3");
  await current.getByLabel("财务分析估分").blur();
  // 没填实际工时不能完成
  await current.getByRole("button", { name: "确认完成" }).click();
  await expect(page.getByRole("alert")).toContainText("要先填实际工时才能完成");
  await current.getByLabel("财务分析实际工时").fill("6");
  await current.getByLabel("财务分析实际工时").blur();
  await page.reload();
  const again = page.getByRole("main").getByRole("region", { name: "财务分析" });
  await expect(again.getByLabel("财务分析估分")).toHaveValue("3");
  await expect(again.getByLabel("财务分析实际工时")).toHaveValue("6");
  await again.getByRole("button", { name: "确认完成" }).click();
  await expect(page.getByText("流程已走完。")).toBeVisible();
});
