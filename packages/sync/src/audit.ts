/*
 * 审计日志的分类和操作名称。服务端按它决定哪些写操作要记，页面按它显示中文。
 * 记什么：空间、成员与权限、工作项配置、视图与度量、自动化、团队、模板、企业管理员、账号，
 * 以及工作项的删除和恢复。工作项上的日常改动记在工作项自己的操作记录里，不进审计日志。
 */

export const AUDIT_CATEGORIES = {
  space: "空间",
  member: "成员与权限",
  config: "工作项配置",
  view: "视图与度量",
  automation: "自动化",
  item: "工作项",
  team: "团队",
  template: "模板",
  org: "企业",
  account: "账号",
} as const;
export type AuditCategory = keyof typeof AUDIT_CATEGORIES;

/** 操作 → [分类, 名称]。mutator 用它的名字（namespace.name），接口动作自己起名。 */
export const AUDIT_ACTIONS: Record<string, readonly [AuditCategory, string]> = {
  // 空间
  "space.create": ["space", "新建空间"],
  "space.createFromTemplate": ["space", "从模板新建空间"],
  "space.copy": ["space", "复制空间"],
  "space.rename": ["space", "修改空间名称"],
  "space.setCalendar": ["space", "修改工作日历"],
  "space.setBusinessLines": ["space", "修改业务线"],
  "space.importDemo": ["space", "导入示例模板"],
  // 成员与权限
  "space.addMember": ["member", "添加成员"],
  "space.setMemberRole": ["member", "修改成员角色"],
  "space.removeMember": ["member", "移除成员"],
  "space.handover": ["member", "工作交接"],
  "userGroup.create": ["member", "新建用户组"],
  "userGroup.rename": ["member", "重命名用户组"],
  "userGroup.delete": ["member", "删除用户组"],
  "userGroup.setMembers": ["member", "修改用户组成员"],
  "workItemType.setPermissions": ["member", "修改工作项权限"],
  // 工作项配置
  "workItemType.create": ["config", "新建工作项类型"],
  "workItemType.setLayout": ["config", "修改页面布局"],
  "workItemType.setDefaultDisplay": ["config", "修改默认列表显示"],
  "workItemType.setSettings": ["config", "修改工作项设置"],
  "fieldDef.create": ["config", "新建字段"],
  "fieldDef.update": ["config", "修改字段"],
  "fieldDef.setAccess": ["config", "修改字段权限"],
  "fieldDef.setFormula": ["config", "修改公式"],
  "fieldDef.reuseOptions": ["config", "复用字段选项"],
  "fieldDef.copyTo": ["config", "复制字段到其他工作项"],
  "roleDef.create": ["config", "新建角色"],
  "roleDef.update": ["config", "修改角色"],
  "roleDef.reorder": ["config", "调整角色顺序"],
  "flowTemplate.create": ["config", "新建流程模板"],
  "flowTemplate.saveDraft": ["config", "保存流程草稿"],
  "flowTemplate.publish": ["config", "发布流程模板"],
  "relationDef.create": ["config", "新建关联关系"],
  "relationDef.delete": ["config", "删除关联关系"],
  "linkRule.create": ["config", "新建联动规则"],
  "linkRule.setEnabled": ["config", "启停联动规则"],
  "linkRule.delete": ["config", "删除联动规则"],
  "hierarchy.create": ["config", "新建层级"],
  "hierarchy.update": ["config", "修改层级"],
  "hierarchy.delete": ["config", "删除层级"],
  // 视图与度量
  "view.create": ["view", "新建视图"],
  "view.update": ["view", "修改视图"],
  "view.delete": ["view", "删除视图"],
  "view.setMembers": ["view", "修改视图协作者"],
  "chart.create": ["view", "新建图表"],
  "chart.update": ["view", "修改图表"],
  "chart.delete": ["view", "删除图表"],
  // 自动化
  "automation.create": ["automation", "新建自动化规则"],
  "automation.update": ["automation", "修改自动化规则"],
  "automation.delete": ["automation", "删除自动化规则"],
  "webhook.create": ["automation", "新建 Webhook"],
  "webhook.update": ["automation", "修改 Webhook"],
  "webhook.delete": ["automation", "删除 Webhook"],
  // 工作项
  "workItem.delete": ["item", "删除工作项"],
  "workItem.recover": ["item", "从回收站恢复工作项"],
  "workItem.purge": ["item", "彻底删除工作项"],
  // 团队
  "team.create": ["team", "新建团队"],
  "team.update": ["team", "修改团队"],
  "team.setMembers": ["team", "修改团队成员"],
  "team.delete": ["team", "删除团队"],
  // 模板
  "spaceTemplate.create": ["template", "存为空间模板"],
  "spaceTemplate.update": ["template", "修改空间模板"],
  "spaceTemplate.delete": ["template", "删除空间模板"],
  // 企业
  "org.setAdmin": ["org", "设置企业管理员"],
  // 账号
  "account.signUp": ["account", "注册"],
  "account.login": ["account", "登录"],
  "account.createToken": ["account", "新建开放接口令牌"],
  "account.deleteToken": ["account", "删除开放接口令牌"],
};

export const auditActionLabel = (action: string) => AUDIT_ACTIONS[action]?.[1] ?? action;

/** 审计日志保留多少天。 */
export const AUDIT_RETENTION_DAYS = 180;

/** 一条审计日志（接口返回给页面的样子）。 */
export interface AuditEntry {
  id: number;
  at: string;
  actor: string | null;
  actorName: string | null;
  spaceId: string | null;
  spaceName: string | null;
  category: string;
  action: string;
  targetId: string | null;
  targetName: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
}
