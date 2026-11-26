import { expect, test } from "@playwright/test";
import { choose, createItem, createRelation, demoSpace, openAutomations, openItems } from "./helpers";

test("a rule syncs a field to related items, calls an external API and runs by hand", async ({ page }) => {
  const suffix = `${Date.now()}`;
  await demoSpace(page, "Pascal", `automation-related-${suffix}@example.com`, `自动化关联 ${suffix}`);
  await createItem(page, "新品 A");
  await openItems(page);
  await createItem(page, "新品 B");
  await createRelation(page, { from: "项目", to: "项目", name: "后续项目", reverseName: "前置项目" });

  // 新品 A 的后续项目是新品 B
  await openItems(page);
  await page.getByRole("link", { name: "新品 A" }).click();
  const panel = page.getByRole("main");
  await choose(panel.getByRole("region", { name: "后续项目" }).getByLabel("添加后续项目"), { label: "新品 B" });
  await expect(panel.getByRole("region", { name: "后续项目" }).getByRole("link", { name: "新品 B" })).toBeVisible();

  // 规则：关联型号变化时，同步给后续项目，并调用外部接口
  await openAutomations(page);
  await page.getByLabel("规则名称").fill("型号同步给后续项目");
  await choose(page.getByLabel("触发时机"), "字段变化时");
  await choose(page.getByLabel("触发字段"), "关联型号");
  await page.getByRole("button", { name: "添加动作", exact: true }).click();
  const sync = page.getByRole("group", { name: "动作 1" });
  await choose(sync.getByLabel("作用于"), "关联「后续项目」的工作项");
  await choose(sync.getByRole("combobox", { name: "字段", exact: true }), "关联型号");
  await choose(sync.getByLabel("取值方式"), "同步为别的工作项的字段");
  await choose(sync.getByLabel("来源字段"), "关联型号");
  await page.getByRole("button", { name: "添加动作", exact: true }).click();
  const api = page.getByRole("group", { name: "动作 2" });
  await choose(api.getByLabel("动作类型"), "调用外部接口");
  await api.getByLabel("接口地址（POST）").fill("http://127.0.0.1:9/erp");
  await api.getByRole("button", { name: "+ 请求头" }).click();
  await api.getByLabel("请求头 1 名称").fill("Authorization");
  await api.getByLabel("请求头 1 的值").fill("Bearer demo-token");
  await page.getByRole("button", { name: "保存规则" }).click();
  const rule = page.getByRole("region", { name: "型号同步给后续项目" });
  await expect(rule).toContainText(
    "对关联「后续项目」的工作项把「关联型号」同步为触发工作项的「关联型号」；调用外部接口 http://127.0.0.1:9/erp",
  );

  // 改新品 A 的关联型号：新品 B 跟着变，新品 A 自己的前置项目不受影响
  await openItems(page);
  await page.getByRole("link", { name: "新品 A" }).click();
  await panel.getByLabel("关联型号").fill("SKU-SYNC");
  await panel.getByLabel("关联型号").blur();
  await panel.getByRole("region", { name: "后续项目" }).getByRole("link", { name: "新品 B" }).click();
  await expect(page.getByRole("heading", { name: "新品 B" })).toBeVisible();
  await expect(panel.getByLabel("关联型号")).toHaveValue("SKU-SYNC", { timeout: 30_000 });

  // 接口调用记录：默认不允许调用内网地址，记为失败
  await openAutomations(page);
  await expect(rule.getByRole("list", { name: "执行记录" })).toContainText("成功");
  const calls = rule.getByRole("list", { name: "接口调用记录" });
  await expect(calls).toContainText("新品 A");
  await expect(calls).toContainText("失败", { timeout: 20_000 });
  await expect(calls).toContainText("内网");

  // 手动运行的规则：在规则列表里选一个工作项运行
  await page.getByLabel("规则名称").fill("手动补评论");
  await choose(page.getByLabel("触发时机"), "手动运行");
  await page.getByRole("button", { name: "添加动作", exact: true }).click();
  const comment = page.getByRole("group", { name: "动作 1" });
  await choose(comment.getByLabel("动作类型"), "添加评论");
  await comment.getByLabel("评论内容").fill("「{{name}}」型号 {{field:关联型号}} 已核对");
  await page.getByRole("button", { name: "保存规则" }).click();
  const manual = page.getByRole("region", { name: "手动补评论" });
  await expect(manual).toContainText("手动运行时");
  await choose(manual.getByLabel("对哪个工作项运行"), "新品 B");
  await manual.getByRole("button", { name: "运行" }).click();
  await expect(manual.getByRole("list", { name: "执行记录" })).toContainText("成功", { timeout: 30_000 });
  await expect(manual.getByRole("list", { name: "执行记录" })).toContainText("新品 B");
});
