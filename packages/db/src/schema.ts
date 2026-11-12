import type {
  AutomationAction,
  AutomationBranch,
  AutomationTrigger,
  CalendarConfig,
  ChartConfig,
  Condition,
  DetailLayout,
  FieldConfig,
  FieldDataType,
  FlowDefinition,
  NodeState,
  RoleConfig,
  RoleOverrides,
  StatusFlowDefinition,
  WorkItemStatus,
} from "@fp/engine";
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

/**
 * 存任意 JSON 值的列（字段值可以是字符串、数字、数组……）。
 * postgres.js 读出 jsonb 时已经解析过一次，drizzle 自带的 jsonb 会对字符串再 JSON.parse 一次，
 * 把文本 "1.0" 读成数字 1、"true" 读成布尔值。这里读出时原样返回。
 */
const jsonValue = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => "jsonb",
  toDriver: (value) => JSON.stringify(value),
  fromDriver: (value) => value,
});

/*
 * 表结构对应设计文档「核心概念与数据模型」：配置层描述一类工作项长什么样、怎么流转，实例层记录工作项走到哪了。
 * 业务表的主键是客户端生成的文本 id（UUIDv7），这样 Zero 的乐观写入不用等服务端分配。
 * 事件流水和 Outbox 用自增 bigint，顺序就是发生顺序。
 */

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export type FlowMode = "node" | "state";
export type { FieldDataType };
export type Cardinality = "one" | "many";
export type RoleMemberSource = "manual" | "inherited";

/** 角色继承：沿 relationFieldKey 找到关联工作项，复制它的 parentRoleKey 角色成员。 */
export interface RoleInheritance {
  relationFieldKey: string;
  parentRoleKey: string;
}

/** 不同步给前端的内部表放在 infra schema；Zero 的 publication 只包含 public schema。 */
export const infra = pgSchema("infra");

// ───────────── 登录（Better Auth 的核心表） ─────────────

/** 用户要显示名字和头像，放在 public 同步给前端；会话、凭据放在 infra，不进 Zero。 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = infra.table("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const account = infra.table("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: "date" }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: "date" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verification = infra.table("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────── 配置层 ─────────────

export const space = pgTable("space", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  /** 工作日历：节假日和调休，排期按它数工作日。 */
  calendar: jsonb("calendar").$type<CalendarConfig>().notNull().default({ holidays: [], extraWorkdays: [] }),
  createdAt: createdAt(),
});

/** 空间的业务线树。工作项的「业务线」字段从这里选，角色的出现和默认成员可以按业务线判断。 */
export const businessLine = pgTable(
  "business_line",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    /** 业务线管理员（用户 id）。 */
    admins: jsonb("admins").$type<string[]>(),
    /** 停用的业务线不能再选，已经选了的保留。 */
    disabled: boolean("disabled").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("business_line_space").on(t.spaceId)],
);

export type SpaceRole = "admin" | "member" | "guest";

export const spaceMember = pgTable(
  "space_member",
  {
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** 空间角色：管理员能改配置和管理成员；成员能建、改工作项；访客只能查看和评论。 */
    role: text("role").$type<SpaceRole>().notNull().default("member"),
  },
  (t) => [primaryKey({ columns: [t.spaceId, t.userId] })],
);

/**
 * 空间的自定义用户组：一组人，本身没有权限，
 * 在工作项类型的「权限」里授权给它。
 */
export const userGroup = pgTable("user_group", {
  id: text("id").primaryKey(),
  spaceId: text("space_id")
    .notNull()
    .references(() => space.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const userGroupMember = pgTable(
  "user_group_member",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => userGroup.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

/** 查看工作项的范围：全部、仅自己参与的（创建、担任角色、关注）、不可见。 */
export type ViewLevel = "all" | "involved" | "none";
/** 按类型授权的操作。 */
export type PermissionOp = "create" | "terminate" | "freeze" | "upgrade" | "delete";
/** 授权对象：空间成员（兜底）、用户组、工作项上的角色。 */
export type Grantee = "members" | `group:${string}` | `role:${string}`;

/**
 * 工作项类型的权限。
 * view：每个授权对象能看到的范围，取最大；空间管理员和工作项上担任角色的人总能看到。
 * ops：每种操作对每个授权对象「允许」或「禁止」；禁止优先，其次允许，都没有就不能做；
 * 某种操作一条都没配时按默认（新建：所有成员；终止、冻结、升级模板：工作项负责人）。
 */
export interface TypePermissions {
  view?: Partial<Record<Grantee, ViewLevel>>;
  ops?: Partial<Record<PermissionOp, Partial<Record<Grantee, "allow" | "deny">>>>;
}

/** 工作项类型的设置。 */
export interface TypeSettings {
  /** 复制工作项时不带过去的字段（字段键或关联名）。 */
  copyExcludeFields?: string[];
  /** 复制工作项时不带过去的角色。 */
  copyExcludeRoles?: string[];
}

export const workItemType = pgTable(
  "work_item_type",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    flowMode: text("flow_mode").$type<FlowMode>().notNull().default("node"),
    /** 详情页布局：字段怎么分组、哪些不显示；为空时所有字段放在一组。 */
    detailLayout: jsonb("detail_layout").$type<DetailLayout>(),
    /** 列表的默认显示（列和顺序、排序、分组、行着色）：管理员在「列」页签里配置，成员打开列表时的起点。 */
    defaultDisplay: jsonb("default_display").$type<ViewDisplay>(),
    /** 类型的其他设置：复制工作项时不带过去的字段和角色等。 */
    settings: jsonb("settings").$type<TypeSettings>(),
    /** 权限：查看范围和操作授权。 */
    permissions: jsonb("permissions").$type<TypePermissions>(),
    /** 空间成员（不算用户组）能看到的范围，由 permissions.view.members 得出；查询按它过滤。 */
    viewBase: text("view_base").$type<ViewLevel>().notNull().default("all"),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("work_item_type_space_key").on(t.spaceId, t.key)],
);

export const fieldDef = pgTable(
  "field_def",
  {
    id: text("id").primaryKey(),
    typeId: text("type_id")
      .notNull()
      .references(() => workItemType.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    dataType: text("data_type").$type<FieldDataType>().notNull(),
    /** 选项类字段的候选值；级联字段的选项用 parent 指向上级。 */
    options:
      jsonb("options").$type<{ value: string; label: string; color?: string; parent?: string; disabled?: boolean }[]>(),
    /** 非空即公式字段，值由公式引擎计算后缓存在 field_value。 */
    formula: text("formula"),
    required: boolean("required").notNull().default(false),
    /** 帮助说明、对接标识、有效性、条件显示和必填、默认值、数字格式等（见 engine 的 FieldConfig）。 */
    config: jsonb("config").$type<FieldConfig>(),
    /** 能看到这个字段的工作项角色（角色键）；为空时所有人可见。空间管理员总是可见。 */
    viewRoles: jsonb("view_roles").$type<string[]>(),
    /** 能修改这个字段的工作项角色；为空时能改工作项的人都能改。空间管理员总是可以。 */
    editRoles: jsonb("edit_roles").$type<string[]>(),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("field_def_type_key").on(t.typeId, t.key)],
);

export const roleDef = pgTable(
  "role_def",
  {
    id: text("id").primaryKey(),
    typeId: text("type_id")
      .notNull()
      .references(() => workItemType.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    inheritFrom: jsonb("inherit_from").$type<RoleInheritance>(),
    /** 出现方式、成员分配、单人、负责人、成员编辑权限（见 engine 的 RoleConfig）。 */
    config: jsonb("config").$type<RoleConfig>(),
    /** 顺序：角色列表和新建表单里按它排。 */
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("role_def_type_key").on(t.typeId, t.key)],
);

export const relationDef = pgTable("relation_def", {
  id: text("id").primaryKey(),
  spaceId: text("space_id")
    .notNull()
    .references(() => space.id),
  fromTypeId: text("from_type_id")
    .notNull()
    .references(() => workItemType.id),
  toTypeId: text("to_type_id")
    .notNull()
    .references(() => workItemType.id),
  /** to 类型所在的空间。和 spaceId 不同时是跨空间关联，两个空间都能看到、都能用。 */
  toSpaceId: text("to_space_id")
    .notNull()
    .references(() => space.id),
  /** 在 from 类型上承载这条关联的字段键，如“关联项目”。 */
  fieldKey: text("field_key").notNull(),
  name: text("name").notNull(),
  cardinality: text("cardinality").$type<Cardinality>().notNull(),
  /** 互相关联：另一端（to 类型）上这条关联的字段名，如「关联项目」；为空时另一端只显示只读的反向关联。 */
  reverseName: text("reverse_name"),
  /** 另一端的字段能选几个（一个 to 工作项最多被几个 from 工作项关联）。 */
  reverseCardinality: text("reverse_cardinality").$type<Cardinality>(),
  createdAt: createdAt(),
});

export const flowTemplate = pgTable(
  "flow_template",
  {
    id: text("id").primaryKey(),
    typeId: text("type_id")
      .notNull()
      .references(() => workItemType.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** 新建工作项默认用的版本。为空表示还没有发布过。 */
    currentVersionId: text("current_version_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("flow_template_type_key").on(t.typeId, t.key)],
);

/** 流程模板的不可变快照。整张图存在 definition 里，整体校验、整体发布。 */
export const flowVersion = pgTable(
  "flow_version",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id")
      .notNull()
      .references(() => flowTemplate.id),
    version: integer("version").notNull(),
    /** 节点流（FlowDefinition）或状态流（StatusFlowDefinition，mode 为 "state"），看类型的 flowMode。 */
    definition: jsonb("definition").$type<FlowDefinition | StatusFlowDefinition>().notNull(),
    /** 为空表示草稿；发布后不可再改。 */
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    publishedBy: text("published_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("flow_version_template_version").on(t.templateId, t.version)],
);

export const automationRule = pgTable("automation_rule", {
  id: text("id").primaryKey(),
  spaceId: text("space_id")
    .notNull()
    .references(() => space.id),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
  /** 触发后按工作项字段求值的条件，为空表示不加条件。 */
  conditions: jsonb("conditions").$type<Condition | null>(),
  actions: jsonb("actions").$type<AutomationAction[]>().notNull(),
  /** 条件分支：主条件不满足时按顺序找第一个满足的分支执行。 */
  branches: jsonb("branches").$type<AutomationBranch[] | null>(),
  /** 规则以创建人的身份执行动作，权限和他手动操作一样。 */
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * 空间关联的一条联动规则：挂在一条关系上，源头一端的变化同步给另一端关联的工作项。
 * - field：源字段改了，关联工作项的目标字段跟着改（建立关联时也同步一次）；
 * - nodeDrive：源节点完成后，关联工作项的目标节点「即完成」(complete) 或「才允许完成」(allow)；
 * - nodeSchedule：源节点排期改了，目标节点排期跟着改。
 */
export type LinkRuleConfig =
  | { kind: "field"; sourceField: string; targetField: string }
  | {
      kind: "nodeDrive";
      sourceNode: string;
      sourceNodeName: string;
      targetNode: string;
      mode: "complete" | "allow";
    }
  | { kind: "nodeSchedule"; sourceNode: string; targetNode: string };

export const linkRule = pgTable(
  "link_rule",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    relationDefId: text("relation_def_id")
      .notNull()
      .references(() => relationDef.id, { onDelete: "cascade" }),
    /** 源头在关系的哪一端：from（本端）或 to（对端）。 */
    sourceSide: text("source_side").$type<"from" | "to">().notNull(),
    config: jsonb("config").$type<LinkRuleConfig>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** 联动以创建人（空间管理员）的身份改关联的工作项。 */
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("link_rule_space").on(t.spaceId), index("link_rule_relation").on(t.relationDefId)],
);

/**
 * Webhook：空间里发生的事件推送到外部地址。空间管理员配置。
 * 请求体用 secret 做 HMAC-SHA256 签名，接收方据此确认请求来自这里。
 */
export const webhook = pgTable(
  "webhook",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    /** 要推送的事件类型；为空表示全部。 */
    events: jsonb("events").$type<string[]>(),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_space").on(t.spaceId)],
);

export type WebhookDeliveryStatus = "pending" | "succeeded" | "failed";

/** 一个事件推送给一个 Webhook 的记录，id 是 `<webhookId>:<eventId>`。失败会按退避重试几次。 */
export const webhookDelivery = pgTable(
  "webhook_delivery",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhook.id, { onDelete: "cascade" }),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => eventLog.id),
    kind: text("kind").notNull(),
    status: text("status").$type<WebhookDeliveryStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** 最近一次请求的 HTTP 状态码；没连上时为空。 */
    responseStatus: integer("response_status"),
    error: text("error"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("webhook_delivery_webhook").on(t.webhookId, t.createdAt)],
);

/** 工作项列表的筛选条件。各项之间是“且”，同一项里的多个值是“或”；为空表示不限。 */
export interface WorkItemFilter {
  typeIds?: string[];
  statuses?: WorkItemStatus[];
  stages?: string[];
  /** 在任一角色里的成员。 */
  memberIds?: string[];
  /** 按字段值筛选，多个条件同时满足。 */
  fields?: FieldFilter[];
}

/**
 * 按字段值筛选：in 用于单选、多选、人员、是否（任一值命中）；range 用于数字和日期（YYYY-MM-DD）；
 * contains 用于文本和链接（不区分大小写）。
 */
export type FieldFilter =
  | { field: string; op: "in"; values: string[] }
  | { field: string; op: "range"; min?: number | string; max?: number | string }
  | { field: string; op: "contains"; text: string };

/** 保存下来的工作项视图：空间成员都能看到和使用。 */
/** 列表视图的显示设置：列、排序、分组、行着色。 */
export interface ViewDisplay {
  /** 显示的列（列键，见前端的列定义）和列宽，按顺序。 */
  columns?: { key: string; width?: number }[];
  sort?: { key: string; desc?: boolean }[];
  groupBy?: string | null;
  /** 行着色：满足条件的行用这个颜色。 */
  colors?: { when: Condition; color: string }[];
  /** 名称列之外再冻结前几列（横向滚动时固定在左边）。 */
  frozen?: number;
  /** 行高：低、中、高、超高。 */
  rowHeight?: "low" | "medium" | "high" | "xhigh";
  /** 底部汇总行：列键 → 统计方式。 */
  summary?: Record<string, SummaryKind>;
  /** 看板：泳道（creator、role:角色键、field:字段键）和卡片上显示的字段。 */
  board?: { lanes?: string | null; cardFields?: string[] };
}
/** 汇总行的统计方式：计数、已填写、未填写、已填写百分比、求和、平均、最大、最小。 */
export type SummaryKind = "count" | "filled" | "empty" | "filledPct" | "sum" | "avg" | "max" | "min";

export const savedView = pgTable("saved_view", {
  id: text("id").primaryKey(),
  spaceId: text("space_id")
    .notNull()
    .references(() => space.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  filter: jsonb("filter").$type<WorkItemFilter>().notNull(),
  display: jsonb("display").$type<ViewDisplay>(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: createdAt(),
});

/**
 * 度量图表：空间里保存的一张图。数据源是筛选条件（和视图同一套），config 是维度、指标和样式。
 * 图表数据在前端用同步下来的工作项（已按权限过滤）计算，见 engine 的 computeChart。
 */
export const metricChart = pgTable("metric_chart", {
  id: text("id").primaryKey(),
  spaceId: text("space_id")
    .notNull()
    .references(() => space.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  filter: jsonb("filter").$type<WorkItemFilter>().notNull(),
  config: jsonb("config").$type<ChartConfig>().notNull(),
  /** 在度量页上的顺序。 */
  sort: integer("sort").notNull().default(0),
  /** 放到空间仪表盘上展示。 */
  onDashboard: boolean("on_dashboard").notNull().default(false),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: createdAt(),
});

// ───────────── 实例层 ─────────────

export const workItem = pgTable(
  "work_item",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id),
    typeId: text("type_id")
      .notNull()
      .references(() => workItemType.id),
    /** 创建时锁定的流程版本（节点流或状态流）。 */
    flowVersionId: text("flow_version_id").references(() => flowVersion.id),
    name: text("name").notNull(),
    /** 节点流：当前阶段；状态流：当前状态的名称（列表、筛选、视图按它显示）。 */
    stage: text("stage"),
    /** 状态流的当前状态键。节点流为空。 */
    flowStatus: text("flow_status"),
    status: text("status").$type<WorkItemStatus | "terminated">().notNull().default("inProgress"),
    /** 终止原因（终止时填，恢复后清空）。 */
    terminateReason: text("terminate_reason"),
    /** 冻结：字段、节点、状态都不能再改，直到解冻。 */
    frozen: boolean("frozen").notNull().default(false),
    /** 用户手动加上、删掉的角色（之后不再跟着角色的出现规则变）。 */
    roleOverrides: jsonb("role_overrides").$type<RoleOverrides>(),
    /** 删除：放进回收站（各处都看不到了），可以恢复；彻底删除才真的删掉这一行。 */
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    deletedBy: text("deleted_by").references(() => user.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("work_item_space_type").on(t.spaceId, t.typeId),
    index("work_item_status").on(t.status),
    index("work_item_deleted").on(t.spaceId, t.deletedAt),
  ],
);

export const fieldValue = pgTable(
  "field_value",
  {
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    value: jsonValue("value"),
    /** 公式字段的结果计算时间；普通字段为空。 */
    computedAt: timestamp("computed_at", { withTimezone: true, mode: "date" }),
    /** 字段配了可见角色时为 true，只同步给 field_viewer 里的人和空间管理员。 */
    restricted: boolean("restricted").notNull().default(false),
    /** 检索列（见 engine 的 fieldIndex）：数字、日期（天数）用于范围筛选。 */
    num: doublePrecision("num"),
    /** 检索列：文本、链接、日期的字符串，用于模糊匹配。 */
    str: text("str"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.workItemId, t.fieldKey] })],
);

/** 检索列：单选、多选、人员、是否字段的每个值一行，用于“属于”筛选。 */
export const fieldValueItem = pgTable(
  "field_value_item",
  {
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    item: text("item").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workItemId, t.fieldKey, t.item] }),
    index("field_value_item_lookup").on(t.fieldKey, t.item),
  ],
);

/**
 * 受限字段的可见名单：工作项上担任字段可见（或可改）角色的人。
 * 由 mutator 在角色成员、字段权限变化时维护；查询靠它过滤受限字段的值。
 */
export const fieldViewer = pgTable(
  "field_viewer",
  {
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workItemId, t.fieldKey, t.userId] })],
);

/**
 * 用户组给的、比空间成员更大的查看范围：每个类型每人一条。
 * 由 mutator 在类型权限或用户组成员变化时维护；查询靠它和 work_item_type.view_base 过滤工作项。
 */
export const typeAccess = pgTable(
  "type_access",
  {
    typeId: text("type_id")
      .notNull()
      .references(() => workItemType.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    level: text("level").$type<ViewLevel>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.typeId, t.userId] })],
);

/** 关注、收藏：每人对每个工作项各一条。 */
export const workItemMark = pgTable(
  "work_item_mark",
  {
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"follow" | "star">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workItemId, t.userId, t.kind] }), index("work_item_mark_user").on(t.userId, t.kind)],
);

/** 最近浏览：每人对每个工作项只留最后一次。 */
export const workItemVisit = pgTable(
  "work_item_visit",
  {
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    visitedAt: timestamp("visited_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workItemId, t.userId] }), index("work_item_visit_user").on(t.userId, t.visitedAt)],
);

export const roleMember = pgTable(
  "role_member",
  {
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    source: text("source").$type<RoleMemberSource>().notNull().default("manual"),
  },
  (t) => [primaryKey({ columns: [t.workItemId, t.roleKey, t.userId] })],
);

export const relation = pgTable(
  "relation",
  {
    id: text("id").primaryKey(),
    /** 自定义关联的定义。子工作项关系没有定义，用 parentNodeKey 标识。 */
    relationDefId: text("relation_def_id").references(() => relationDef.id),
    /** 子工作项关系：from 是父工作项，to 是为它的这个“子工作项驱动”节点建的子工作项。 */
    parentNodeKey: text("parent_node_key"),
    fromId: text("from_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    toId: text("to_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("relation_def_from_to").on(t.relationDefId, t.fromId, t.toId),
    // 公式和角色继承需要从子工作项反查父工作项
    index("relation_to").on(t.toId),
    index("relation_from").on(t.fromId),
  ],
);

export const nodeInstance = pgTable(
  "node_instance",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    /** 按节点键对应流程定义，不按名称。 */
    nodeKey: text("node_key").notNull(),
    state: text("state").$type<NodeState>().notNull().default("notStarted"),
    owners: jsonb("owners").$type<string[]>().notNull().default([]),
    plannedStart: timestamp("planned_start", { withTimezone: true, mode: "date" }),
    plannedEnd: timestamp("planned_end", { withTimezone: true, mode: "date" }),
    actualStart: timestamp("actual_start", { withTimezone: true, mode: "date" }),
    actualEnd: timestamp("actual_end", { withTimezone: true, mode: "date" }),
    /** 计划日期被人手动改过，排期重算时不覆盖。 */
    plannedPinned: boolean("planned_pinned").notNull().default(false),
    /** 整体完成结论（结论选项值）和意见。 */
    conclusion: text("conclusion"),
    comment: text("comment"),
    /** 每位负责人的个人结论和意见：用户 id → { value, comment }。 */
    verdicts: jsonb("verdicts").$type<Record<string, { value: string | null; comment?: string | null }>>(),
    /** 节点字段的值：节点字段键 → 值。 */
    fields: jsonb("fields").$type<Record<string, unknown>>(),
    /** 估分（人天等，按团队习惯）和实际工时（小时）。 */
    points: doublePrecision("points"),
    actualHours: doublePrecision("actual_hours"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("node_instance_work_item_node").on(t.workItemId, t.nodeKey)],
);

export const nodeConfirmation = pgTable(
  "node_confirmation",
  {
    nodeInstanceId: text("node_instance_id")
      .notNull()
      .references(() => nodeInstance.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.nodeInstanceId, t.userId] })],
);

/** 节点上的子任务：拆给具体的人、带截止日期的待办。节点有未完成的子任务时不能确认完成。 */
export const nodeTask = pgTable(
  "node_task",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    nodeKey: text("node_key").notNull(),
    name: text("name").notNull(),
    assigneeId: text("assignee_id").references(() => user.id),
    /** 截止日期（空间时区那天的 0 点，和节点的计划日期一样）。 */
    dueDate: timestamp("due_date", { withTimezone: true, mode: "date" }),
    done: boolean("done").notNull().default(false),
    doneAt: timestamp("done_at", { withTimezone: true, mode: "date" }),
    doneBy: text("done_by").references(() => user.id),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("node_task_work_item").on(t.workItemId, t.nodeKey), index("node_task_assignee").on(t.assigneeId)],
);

/**
 * 工作项上加的依赖：节点要等另一个节点完成才能开始（start）或才能完成（complete）。
 * 对方节点可以在本工作项里，也可以在别的工作项里；对方的工作项被终止、删除，或节点被跳过时不再等。
 */
export const nodeDependency = pgTable(
  "node_dependency",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    nodeKey: text("node_key").notNull(),
    /** 被依赖的节点实例。 */
    targetNodeId: text("target_node_id")
      .notNull()
      .references(() => nodeInstance.id, { onDelete: "cascade" }),
    /** 加依赖时对方节点的名称，看不到对方工作项的人也能知道在等什么。 */
    targetNodeName: text("target_node_name").notNull(),
    allow: text("allow").$type<"start" | "complete">().notNull(),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("node_dependency_unique").on(t.workItemId, t.nodeKey, t.targetNodeId, t.allow),
    index("node_dependency_target").on(t.targetNodeId),
  ],
);

/** 计划基线：某一刻所有节点计划日期的快照，用来和当前计划对比偏差。 */
export const planBaseline = pgTable(
  "plan_baseline",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** 节点键 → 计划开始和结束（YYYY-MM-DD）。 */
    nodes: jsonb("nodes").$type<Record<string, { start: string; end: string }>>().notNull(),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("plan_baseline_work_item").on(t.workItemId)],
);

/**
 * 层级的一层：从上一层的工作项沿一条关系往下找这一层的工作项。
 * relationDefId 为空表示子工作项关系；reverse 表示沿关系的反方向（上一层在关系的 to 一端）。
 * repeat：同类型的关系可以一层套一层（层级循环），如「需求 → 子需求 → 子需求」。
 */
export interface HierarchyLayer {
  typeId: string;
  relationDefId: string | null;
  reverse?: boolean;
  repeat?: boolean;
}

/** 层级管理：按关系把工作项排成一棵多层的树，树形视图按它展开。 */
export const hierarchy = pgTable(
  "hierarchy",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** 第一层（树根）的工作项类型。 */
    rootTypeId: text("root_type_id")
      .notNull()
      .references(() => workItemType.id),
    /** 第二层起的每一层。 */
    layers: jsonb("layers").$type<HierarchyLayer[]>().notNull(),
    createdBy: text("created_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("hierarchy_space").on(t.spaceId)],
);

/** 工作项下的评论。提及的人会收到通知（由事件流里的通知 activity 生成）。 */
export const comment = pgTable(
  "comment",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    body: text("body").notNull(),
    mentions: jsonb("mentions").$type<string[]>().notNull(),
    /** 楼中楼：回复所在的那条一级评论；一级评论为空。 */
    parentId: text("parent_id"),
    /** 回复的是谁（回复楼里的某条回复时显示「回复 xx」）。 */
    replyToId: text("reply_to_id").references(() => user.id),
    editedAt: timestamp("edited_at", { withTimezone: true, mode: "date" }),
    /** 删除只清空内容、留下占位，楼里的回复还在。 */
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
  },
  (t) => [index("comment_work_item").on(t.workItemId, t.createdAt)],
);

/** 工作项的附件。文件本身在文件存储里（storage_key），这里只有元数据，由 Zero 同步给前端。 */
export const attachment = pgTable(
  "attachment",
  {
    id: text("id").primaryKey(),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    storageKey: text("storage_key").notNull(),
    /** 附件字段上传的附件记字段键；为空的是工作项的附件（附件卡片）。 */
    fieldKey: text("field_key"),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("attachment_work_item").on(t.workItemId, t.createdAt)],
);

/** 站内通知。每条事件给每个人最多一条，重试不会重复。 */
export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id, { onDelete: "cascade" }),
    workItemId: text("work_item_id").references(() => workItem.id, { onDelete: "cascade" }),
    kind: text("kind")
      .$type<"mentioned" | "nodeAssigned" | "taskAssigned" | "automation" | "nudge" | "replied">()
      .notNull(),
    /** 列表里显示的一句话，生成时写好，避免前端再拼。 */
    text: text("text").notNull(),
    eventId: bigint("event_id", { mode: "number" }).notNull(),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
  },
  // id 由事件、（自动化规则的步骤、）收件人决定，重试时插入同一行；同一事件可以给同一个人发多条（如提及 + 自动化通知）
  (t) => [index("notification_user").on(t.userId, t.createdAt)],
);

/** 所有状态变化的流水。只追加不修改；审计、动态、自动化、Webhook 都从这里取事件。 */
export const eventLog = pgTable(
  "event_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id),
    // 彻底删除工作项后流水留着做审计，只是不再指向它
    workItemId: text("work_item_id").references(() => workItem.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** fieldChanged 事件改的字段：动态按它对上字段值的可见范围，受限字段的改动只给能看的人。 */
    fieldKey: text("field_key"),
    /** 操作人；系统和自动化写入时为空。 */
    actor: text("actor"),
    /** 引发本事件的上游事件，用于追踪自动化连锁和做循环保护。 */
    causedBy: bigint("caused_by", { mode: "number" }),
    at: timestamp("at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("event_log_work_item").on(t.workItemId, t.id)],
);

/**
 * 按时间触发的规则在每个整点对每个工作项最多触发一次：时钟先占这一行，占到了才写事件，重试不会重复触发。
 */
export const automationFire = pgTable(
  "automation_fire",
  {
    ruleId: text("rule_id")
      .notNull()
      .references(() => automationRule.id, { onDelete: "cascade" }),
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    /** 触发的整点（毫秒时间戳）。 */
    slot: bigint("slot", { mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.workItemId, t.slot] })],
);

export const automationRun = pgTable(
  "automation_run",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => automationRule.id),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => eventLog.id),
    /** 执行这条规则的 Temporal workflow，方便从执行记录跳到 Temporal UI。 */
    workflowId: text("workflow_id").notNull(),
    status: text("status").$type<"running" | "succeeded" | "failed" | "skipped">().notNull(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [uniqueIndex("automation_run_rule_event").on(t.ruleId, t.eventId)],
);

/**
 * 事务性 Outbox：和业务写入、event_log 在同一个事务里插入，中继程序把它按顺序交给 Temporal。
 * stream 决定顺序和归属：同一个 stream 的事件由同一个 Temporal workflow 依次处理。
 * 投递失败的行留在原处，attempts 和 last_error 记录原因，下一轮从它开始重试，保证同一个 stream 不乱序。
 */
export const outbox = infra.table(
  "outbox",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => eventLog.id),
    stream: text("stream").notNull(),
    createdAt: createdAt(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true, mode: "date" }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [index("outbox_pending").on(t.id).where(sql`${t.dispatchedAt} is null`)],
);

/**
 * 开放接口的访问令牌。令牌代表创建它的用户，权限和这个用户在界面上一样。
 * 只存令牌的 SHA-256；明文只在创建时返回一次。
 */
export const apiToken = infra.table(
  "api_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** 令牌开头几位，列表里用来认出是哪个令牌。 */
    prefix: text("prefix").notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("api_token_user").on(t.userId)],
);

/** 工作项的向量表示，用于 AI 检索。不同步到前端。 */
export const workItemEmbedding = infra.table(
  "work_item_embedding",
  {
    workItemId: text("work_item_id")
      .primaryKey()
      .references(() => workItem.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [index("work_item_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

// ───────────── 关系（Drizzle 查询和 Zero schema 共用） ─────────────

export const userRelations = relations(user, ({ many }) => ({
  spaces: many(spaceMember),
}));

export const spaceRelations = relations(space, ({ many }) => ({
  members: many(spaceMember),
  workItemTypes: many(workItemType),
  workItems: many(workItem),
  automationRules: many(automationRule),
  views: many(savedView),
  charts: many(metricChart),
  webhooks: many(webhook),
  businessLines: many(businessLine),
  userGroups: many(userGroup),
  hierarchies: many(hierarchy),
  linkRules: many(linkRule),
  /** 别的空间指向本空间类型的跨空间关联（也包含本空间自己的，查询时按 spaceId 去掉）。 */
  incomingRelationDefs: many(relationDef, { relationName: "toSpace" }),
}));

export const linkRuleRelations = relations(linkRule, ({ one }) => ({
  space: one(space, { fields: [linkRule.spaceId], references: [space.id] }),
  def: one(relationDef, { fields: [linkRule.relationDefId], references: [relationDef.id] }),
  creator: one(user, { fields: [linkRule.createdBy], references: [user.id] }),
}));

export const hierarchyRelations = relations(hierarchy, ({ one }) => ({
  space: one(space, { fields: [hierarchy.spaceId], references: [space.id] }),
  rootType: one(workItemType, { fields: [hierarchy.rootTypeId], references: [workItemType.id] }),
}));

export const userGroupRelations = relations(userGroup, ({ one, many }) => ({
  space: one(space, { fields: [userGroup.spaceId], references: [space.id] }),
  members: many(userGroupMember),
}));

export const userGroupMemberRelations = relations(userGroupMember, ({ one }) => ({
  group: one(userGroup, { fields: [userGroupMember.groupId], references: [userGroup.id] }),
  user: one(user, { fields: [userGroupMember.userId], references: [user.id] }),
}));

export const typeAccessRelations = relations(typeAccess, ({ one }) => ({
  type: one(workItemType, { fields: [typeAccess.typeId], references: [workItemType.id] }),
}));

export const businessLineRelations = relations(businessLine, ({ one }) => ({
  space: one(space, { fields: [businessLine.spaceId], references: [space.id] }),
}));

export const spaceMemberRelations = relations(spaceMember, ({ one }) => ({
  space: one(space, { fields: [spaceMember.spaceId], references: [space.id] }),
  user: one(user, { fields: [spaceMember.userId], references: [user.id] }),
}));

export const workItemTypeRelations = relations(workItemType, ({ one, many }) => ({
  space: one(space, { fields: [workItemType.spaceId], references: [space.id] }),
  fields: many(fieldDef),
  roles: many(roleDef),
  flowTemplates: many(flowTemplate),
  workItems: many(workItem),
  /** 从这个类型出发的自定义关联。 */
  relationDefs: many(relationDef, { relationName: "fromType" }),
  /** 指向这个类型的自定义关联（可能来自别的空间）。 */
  incomingRelationDefs: many(relationDef, { relationName: "toType" }),
  /** 用户组给的查看范围。 */
  access: many(typeAccess),
}));

export const fieldDefRelations = relations(fieldDef, ({ one }) => ({
  type: one(workItemType, { fields: [fieldDef.typeId], references: [workItemType.id] }),
}));

export const roleDefRelations = relations(roleDef, ({ one }) => ({
  type: one(workItemType, { fields: [roleDef.typeId], references: [workItemType.id] }),
}));

export const relationDefRelations = relations(relationDef, ({ one, many }) => ({
  toSpace: one(space, { fields: [relationDef.toSpaceId], references: [space.id], relationName: "toSpace" }),
  linkRules: many(linkRule),
  fromType: one(workItemType, {
    fields: [relationDef.fromTypeId],
    references: [workItemType.id],
    relationName: "fromType",
  }),
  toType: one(workItemType, { fields: [relationDef.toTypeId], references: [workItemType.id], relationName: "toType" }),
}));

export const flowTemplateRelations = relations(flowTemplate, ({ one, many }) => ({
  type: one(workItemType, { fields: [flowTemplate.typeId], references: [workItemType.id] }),
  versions: many(flowVersion, { relationName: "versions" }),
  currentVersion: one(flowVersion, {
    fields: [flowTemplate.currentVersionId],
    references: [flowVersion.id],
    relationName: "currentVersion",
  }),
}));

export const flowVersionRelations = relations(flowVersion, ({ one }) => ({
  template: one(flowTemplate, {
    fields: [flowVersion.templateId],
    references: [flowTemplate.id],
    relationName: "versions",
  }),
}));

export const savedViewRelations = relations(savedView, ({ one }) => ({
  space: one(space, { fields: [savedView.spaceId], references: [space.id] }),
  creator: one(user, { fields: [savedView.createdBy], references: [user.id] }),
}));

export const metricChartRelations = relations(metricChart, ({ one }) => ({
  space: one(space, { fields: [metricChart.spaceId], references: [space.id] }),
  creator: one(user, { fields: [metricChart.createdBy], references: [user.id] }),
}));

export const automationRuleRelations = relations(automationRule, ({ one, many }) => ({
  space: one(space, { fields: [automationRule.spaceId], references: [space.id] }),
  creator: one(user, { fields: [automationRule.createdBy], references: [user.id] }),
  runs: many(automationRun),
}));

/**
 * 投票字段的一张票：谁在哪个工作项的哪个投票字段上选了什么、备注。
 * revealed 为假时只有投票人自己看得到（盲投，放榜后改成真），由 Zero 查询按它过滤。
 */
export const voteBallot = pgTable(
  "vote_ballot",
  {
    workItemId: text("work_item_id")
      .notNull()
      .references(() => workItem.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    choices: jsonb("choices").$type<string[]>().notNull(),
    remark: text("remark"),
    revealed: boolean("revealed").notNull().default(true),
    votedAt: timestamp("voted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workItemId, t.fieldKey, t.userId] })],
);

export const voteBallotRelations = relations(voteBallot, ({ one }) => ({
  workItem: one(workItem, { fields: [voteBallot.workItemId], references: [workItem.id] }),
  user: one(user, { fields: [voteBallot.userId], references: [user.id] }),
}));

export const workItemMarkRelations = relations(workItemMark, ({ one }) => ({
  workItem: one(workItem, { fields: [workItemMark.workItemId], references: [workItem.id] }),
}));

export const workItemVisitRelations = relations(workItemVisit, ({ one }) => ({
  workItem: one(workItem, { fields: [workItemVisit.workItemId], references: [workItem.id] }),
}));

export const workItemRelations = relations(workItem, ({ one, many }) => ({
  marks: many(workItemMark),
  ballots: many(voteBallot),
  visits: many(workItemVisit),
  space: one(space, { fields: [workItem.spaceId], references: [space.id] }),
  type: one(workItemType, { fields: [workItem.typeId], references: [workItemType.id] }),
  flowVersion: one(flowVersion, { fields: [workItem.flowVersionId], references: [flowVersion.id] }),
  deleter: one(user, { fields: [workItem.deletedBy], references: [user.id] }),
  attachments: many(attachment),
  fieldValues: many(fieldValue),
  roleMembers: many(roleMember),
  nodes: many(nodeInstance),
  baselines: many(planBaseline),
  dependencies: many(nodeDependency),
  outgoing: many(relation, { relationName: "from" }),
  incoming: many(relation, { relationName: "to" }),
  events: many(eventLog),
  comments: many(comment),
  tasks: many(nodeTask),
}));

export const nodeTaskRelations = relations(nodeTask, ({ one }) => ({
  workItem: one(workItem, { fields: [nodeTask.workItemId], references: [workItem.id] }),
  assignee: one(user, { fields: [nodeTask.assigneeId], references: [user.id] }),
}));

export const nodeDependencyRelations = relations(nodeDependency, ({ one }) => ({
  workItem: one(workItem, { fields: [nodeDependency.workItemId], references: [workItem.id] }),
  target: one(nodeInstance, { fields: [nodeDependency.targetNodeId], references: [nodeInstance.id] }),
}));

export const planBaselineRelations = relations(planBaseline, ({ one }) => ({
  workItem: one(workItem, { fields: [planBaseline.workItemId], references: [workItem.id] }),
  creator: one(user, { fields: [planBaseline.createdBy], references: [user.id] }),
}));

export const attachmentRelations = relations(attachment, ({ one }) => ({
  workItem: one(workItem, { fields: [attachment.workItemId], references: [workItem.id] }),
  uploader: one(user, { fields: [attachment.uploadedBy], references: [user.id] }),
}));

export const commentRelations = relations(comment, ({ one }) => ({
  workItem: one(workItem, { fields: [comment.workItemId], references: [workItem.id] }),
  author: one(user, { fields: [comment.authorId], references: [user.id] }),
  replyTo: one(user, { fields: [comment.replyToId], references: [user.id], relationName: "commentReplyTo" }),
}));

export const notificationRelations = relations(notification, ({ one }) => ({
  user: one(user, { fields: [notification.userId], references: [user.id] }),
  workItem: one(workItem, { fields: [notification.workItemId], references: [workItem.id] }),
}));

export const fieldValueRelations = relations(fieldValue, ({ one, many }) => ({
  workItem: one(workItem, { fields: [fieldValue.workItemId], references: [workItem.id] }),
  viewers: many(fieldViewer),
  items: many(fieldValueItem),
}));

export const fieldValueItemRelations = relations(fieldValueItem, ({ one }) => ({
  fieldValue: one(fieldValue, {
    fields: [fieldValueItem.workItemId, fieldValueItem.fieldKey],
    references: [fieldValue.workItemId, fieldValue.fieldKey],
  }),
}));

export const fieldViewerRelations = relations(fieldViewer, ({ one }) => ({
  fieldValue: one(fieldValue, {
    fields: [fieldViewer.workItemId, fieldViewer.fieldKey],
    references: [fieldValue.workItemId, fieldValue.fieldKey],
  }),
}));

export const roleMemberRelations = relations(roleMember, ({ one }) => ({
  workItem: one(workItem, { fields: [roleMember.workItemId], references: [workItem.id] }),
  user: one(user, { fields: [roleMember.userId], references: [user.id] }),
}));

export const relationRelations = relations(relation, ({ one }) => ({
  def: one(relationDef, { fields: [relation.relationDefId], references: [relationDef.id] }),
  from: one(workItem, { fields: [relation.fromId], references: [workItem.id], relationName: "from" }),
  to: one(workItem, { fields: [relation.toId], references: [workItem.id], relationName: "to" }),
}));

export const nodeInstanceRelations = relations(nodeInstance, ({ one, many }) => ({
  workItem: one(workItem, { fields: [nodeInstance.workItemId], references: [workItem.id] }),
  confirmations: many(nodeConfirmation),
  /** 等这个节点完成的依赖。 */
  dependents: many(nodeDependency),
}));

export const nodeConfirmationRelations = relations(nodeConfirmation, ({ one }) => ({
  node: one(nodeInstance, { fields: [nodeConfirmation.nodeInstanceId], references: [nodeInstance.id] }),
}));

export const eventLogRelations = relations(eventLog, ({ one }) => ({
  workItem: one(workItem, { fields: [eventLog.workItemId], references: [workItem.id] }),
  actorUser: one(user, { fields: [eventLog.actor], references: [user.id] }),
  fieldValue: one(fieldValue, {
    fields: [eventLog.workItemId, eventLog.fieldKey],
    references: [fieldValue.workItemId, fieldValue.fieldKey],
  }),
}));

export const webhookRelations = relations(webhook, ({ one, many }) => ({
  space: one(space, { fields: [webhook.spaceId], references: [space.id] }),
  deliveries: many(webhookDelivery),
}));

export const webhookDeliveryRelations = relations(webhookDelivery, ({ one }) => ({
  webhook: one(webhook, { fields: [webhookDelivery.webhookId], references: [webhook.id] }),
}));

export const automationRunRelations = relations(automationRun, ({ one }) => ({
  rule: one(automationRule, { fields: [automationRun.ruleId], references: [automationRule.id] }),
  event: one(eventLog, { fields: [automationRun.eventId], references: [eventLog.id] }),
}));
