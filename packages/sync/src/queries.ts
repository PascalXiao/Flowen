import { fieldIndex } from "@fp/engine";
import { defineQueries, defineQuery, type ExpressionBuilder } from "@rocicorp/zero";
import { z } from "zod";
import { itemVisible } from "./permissions.ts";
import { type Schema, zql } from "./schema.gen.ts";
import { workItemFilter } from "./views.ts";

/*
 * 前端只能通过这里定义的查询读数据。每个查询都在服务端按登录用户再执行一遍，
 * 所以权限过滤写在查询里：只能看到自己所在空间的数据。
 */

const spaceItemsArgs = z.object({ spaceId: z.string(), filter: workItemFilter.optional() });
/** 列表页的页签：全部、最近浏览、我创建的、我参与的、我关注的、我收藏的。 */
const listArgs = spaceItemsArgs.extend({
  tab: z.enum(["all", "recent", "created", "involved", "followed", "starred"]).default("all"),
  /**
   * 只同步列表要用的数据（显示的列、排序、分组、着色用到的）。不传时全部带上。
   * fields：字段键；nodes：none 不要节点，active 只要进行中的，all 全部；
   * relations：要不要关联，relatedFields：关联另一端要带的字段键；roles：要带成员的角色键。
   */
  /** 名称包含这段文字。 */
  search: z.string().max(200).optional(),
  /** 排序（只能按工作项本身的列）；不传时按创建时间倒序。 */
  order: z
    .array(z.object({ key: z.enum(["createdAt", "updatedAt"]), desc: z.boolean().optional() }))
    .max(3)
    .optional(),
  /** 最多取几条（分批加载）；不传时全部。 */
  limit: z.number().int().min(1).max(10000).optional(),
  needs: z
    .object({
      fields: z.array(z.string()).max(1000),
      nodes: z.enum(["none", "active", "all"]),
      relations: z.boolean(),
      relatedFields: z.array(z.string()).max(1000),
      roles: z.array(z.string()).max(200),
    })
    .optional(),
});

/** 只留这些字段键的值；一个都不要时什么都不匹配。 */
function onlyFields(keys: readonly string[] | undefined) {
  return (q: ReturnType<typeof zql.fieldValue.where>) =>
    keys === undefined ? q : keys.length ? q.where("fieldKey", "IN", [...keys]) : q.where("workItemId", "IS", null);
}

/** 范围筛选的边界：数字原样；日期（YYYY-MM-DD）换成检索列里的天数。 */
function rangeBound(value: number | string | undefined): number | null {
  if (value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const n = fieldIndex({ name: "", dataType: "date" }, value).num;
  return n === null || Number.isNaN(n) ? null : n;
}

/** “包含这段文字”的 ILIKE 模式，转义掉通配符。 */
function containsPattern(text: string) {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** 空间里当前用户能看到、并且符合筛选条件的工作项。 */
function spaceItems({ spaceId, filter = {} }: z.output<typeof spaceItemsArgs>, userID: string) {
  let q = zql.workItem.where("spaceId", spaceId).where(itemVisible(userID));
  if (filter.typeIds?.length) q = q.where("typeId", "IN", filter.typeIds);
  if (filter.statuses?.length) q = q.where("status", "IN", filter.statuses);
  if (filter.stages?.length) q = q.where("stage", "IN", filter.stages);
  const memberIds = filter.memberIds;
  if (memberIds?.length) q = q.whereExists("roleMembers", (r) => r.where("userId", "IN", memberIds));
  // 字段条件查检索列；只在自己能看到的字段值里找，受限字段不会被用来探测
  for (const f of filter.fields ?? [])
    q = q.whereExists("fieldValues", (v) => {
      const fv = visibleFieldValues(userID)(v.where("fieldKey", f.field));
      switch (f.op) {
        case "in":
          return fv.whereExists("items", (i) => i.where("item", "IN", f.values));
        case "contains":
          return fv.where("str", "ILIKE", containsPattern(f.text));
        case "range": {
          let r = fv;
          const min = rangeBound(f.min);
          const max = rangeBound(f.max);
          if (min !== null) r = r.where("num", ">=", min);
          if (max !== null) r = r.where("num", "<=", max);
          return r;
        }
      }
    });
  return q;
}

/**
 * 字段值的可见范围：没配可见角色的字段所有人可见；配了的只给可见名单里的人和空间管理员。
 * 在服务端执行，看不到的值根本不会同步到浏览器。
 */
function visibleFieldValues(userID: string) {
  return (q: ReturnType<typeof zql.fieldValue.where>) =>
    q.where(({ or, cmp, exists }) =>
      or(
        cmp("restricted", false),
        exists("viewers", (v) => v.where("userId", userID)),
        exists("workItem", (w) =>
          w.whereExists("space", (s) =>
            s.whereExists("members", (m) => m.where("userId", userID).where("role", "admin")),
          ),
        ),
      ),
    );
}

/**
 * 事件的可见范围：改受限字段的事件（fieldChanged）跟字段值一样，只给能看到这个字段的人；
 * 其余事件随工作项可见。
 */
function visibleEvent(userID: string) {
  return ({ or, cmp, exists }: ExpressionBuilder<"eventLog", Schema>) =>
    or(
      cmp("fieldKey", "IS", null),
      exists("fieldValue", (v) => visibleFieldValues(userID)(v)),
    );
}

const boardArgs = spaceItemsArgs.extend({ fields: z.array(z.string()).max(200).optional() });
/** 看板的一列：阶段（null 是没有阶段）、状态流的一个状态，或者对不上任何状态的「其他」。 */
const boardColumnArgs = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stage"), stage: z.string().nullable() }),
  z.object({ kind: z.literal("status"), key: z.string(), name: z.string(), keys: z.array(z.string()).max(200) }),
  z.object({ kind: z.literal("other"), keys: z.array(z.string()).max(200), names: z.array(z.string()).max(200) }),
]);

/** 看板卡片要的东西：类型、流程定义、指定字段的值、角色成员（头像），以及自己在空间里的身份。 */
function boardCards(q: ReturnType<typeof zql.workItem.where>, fields: readonly string[] | undefined, userID: string) {
  return q
    .related("type")
    .related("flowVersion")
    .related("space", (s) => s.related("members", (m) => m.where("userId", userID)))
    .related("fieldValues", (v) => visibleFieldValues(userID)(onlyFields(fields)(v)))
    .related("roleMembers", (r) => r.related("user"));
}

/** 树形视图的排期管理模式要每个工作项的节点排期（跳过的不算）；不要时用不会命中的条件，保持形状不变。 */
function treePlans(plans: boolean | undefined) {
  return (n: ReturnType<typeof zql.nodeInstance.where>) =>
    plans ? n.where("state", "!=", "skipped") : n.where("workItemId", "IS", null);
}

/** 树形视图按哪种关系展开：relationDefId 为空时按子工作项，否则按这个自定义关联。 */
const hierarchyArgs = z.object({ relationDefId: z.string().nullable() });

/** 只留下构成层级的关系。 */
function hierarchyEdges({ relationDefId }: z.output<typeof hierarchyArgs>) {
  return ({ cmp }: ExpressionBuilder<"relation", Schema>) =>
    relationDefId === null ? cmp("parentNodeKey", "IS NOT", null) : cmp("relationDefId", relationDefId);
}

/** 层级里往下走一层：沿哪条关系（null 为子工作项关系）、哪个方向、到哪个类型。 */
const stepArgs = z.object({ typeId: z.string(), relationDefId: z.string().nullable(), reverse: z.boolean() });
type Step = z.output<typeof stepArgs>;

const layerArgs = z.object({
  id: z.string(),
  step: stepArgs,
  next: z.array(stepArgs).max(2),
  plans: z.boolean().optional(),
});

/** 一步用的是哪条关系。 */
function stepEdge(step: Step) {
  return ({ cmp }: ExpressionBuilder<"relation", Schema>) =>
    step.relationDefId === null ? cmp("parentNodeKey", "IS NOT", null) : cmp("relationDefId", step.relationDefId);
}

/** 沿这些步（只看某个方向的）能走到的关系行，用来数一个工作项在层级里有几个下级。 */
function stepEdges(steps: readonly Step[], reverse: boolean) {
  return ({ or, and, cmp, exists }: ExpressionBuilder<"relation", Schema>) => {
    const conds = steps
      .filter((s) => s.reverse === reverse)
      .map((s) =>
        and(
          s.relationDefId === null ? cmp("parentNodeKey", "IS NOT", null) : cmp("relationDefId", s.relationDefId),
          exists(reverse ? "from" : "to", (w) => w.where("typeId", s.typeId)),
        ),
      );
    return conds.length > 0 ? or(...conds) : cmp("id", "IS", null);
  };
}

export const queries = defineQueries({
  spaces: {
    mine: defineQuery(({ ctx }) =>
      zql.space.whereExists("members", (m) => m.where("userId", ctx.userID)).orderBy("name", "asc"),
    ),
    /** 全景视图选数据源用：自己所在的空间、空间里的工作项类型和成员名字。 */
    panoramaSources: defineQuery(({ ctx }) =>
      zql.space
        .whereExists("members", (m) => m.where("userId", ctx.userID))
        .related("workItemTypes", (t) => t.orderBy("sort", "asc"))
        .related("members", (m) => m.related("user"))
        .orderBy("name", "asc"),
    ),
    byId: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
      zql.space
        .where("id", args.id)
        .whereExists("members", (m) => m.where("userId", ctx.userID))
        .related("members", (m) => m.related("user"))
        .related("businessLines", (b) => b.orderBy("sort", "asc"))
        .related("views", (v) => v.orderBy("createdAt", "asc"))
        .related("charts", (c) => c.orderBy("sort", "asc").orderBy("createdAt", "asc"))
        // 用户组和成员：权限配置要用，前端也按它算自己能看到哪些工作项类型
        .related("userGroups", (g) => g.related("members").orderBy("createdAt", "asc"))
        .related("hierarchies", (h) => h.orderBy("createdAt", "asc"))
        // 空间关联的联动规则：「才允许完成」在浏览器乐观执行时也要拦
        .related("linkRules", (r) => r.orderBy("createdAt", "asc"))
        .related("workItemTypes", (t) =>
          t
            .orderBy("sort", "asc")
            .related("fields")
            .related("roles", (r) => r.orderBy("sort", "asc").orderBy("createdAt", "asc"))
            .related("relationDefs")
            // 带上当前版本：前端乐观创建工作项时要用流程定义启动引擎
            .related("flowTemplates", (f) => f.related("currentVersion")),
        )
        .one(),
    ),
  },
  automations: {
    /** 空间的自动化规则和每条规则最近的执行记录。 */
    bySpace: defineQuery(z.object({ spaceId: z.string() }), ({ args, ctx }) =>
      zql.automationRule
        .where("spaceId", args.spaceId)
        .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID)))
        .related("creator")
        .related("runs", (r) =>
          r
            .orderBy("id", "desc")
            .limit(10)
            .related("event", (e) => e.where(visibleEvent(ctx.userID)).related("workItem")),
        )
        .orderBy("createdAt", "asc"),
    ),
  },
  webhooks: {
    /** 空间的 Webhook 和最近的推送记录。含签名密钥，只给空间管理员。 */
    bySpace: defineQuery(z.object({ spaceId: z.string() }), ({ args, ctx }) =>
      zql.webhook
        .where("spaceId", args.spaceId)
        .whereExists("space", (s) =>
          s.whereExists("members", (m) => m.where("userId", ctx.userID).where("role", "admin")),
        )
        .related("deliveries", (d) => d.orderBy("createdAt", "desc").limit(20))
        .orderBy("createdAt", "asc"),
    ),
  },
  types: {
    /** 类型配置页：角色、字段、模板及其最新版本。 */
    byId: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
      zql.workItemType
        .where("id", args.id)
        .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID)))
        .related("space", (s) =>
          s
            .related("members", (m) => m.where("userId", ctx.userID))
            .related("workItemTypes")
            .related("businessLines", (b) => b.orderBy("sort", "asc")),
        )
        .related("roles", (r) => r.orderBy("sort", "asc").orderBy("createdAt", "asc"))
        .related("relationDefs", (r) => r.related("toType").orderBy("createdAt", "asc"))
        .related("fields", (f) => f.orderBy("sort", "asc"))
        .related("flowTemplates", (t) => t.related("versions", (v) => v.orderBy("version", "desc").limit(1)))
        .one(),
    ),
  },
  templates: {
    /** 模板编辑器：模板、它的版本列表、所属类型的角色和字段。 */
    byId: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
      zql.flowTemplate
        .where("id", args.id)
        .whereExists("type", (t) =>
          t.whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID))),
        )
        .related("versions", (v) => v.orderBy("version", "desc"))
        .related("type", (t) =>
          t
            .related("roles", (r) => r.orderBy("sort", "asc").orderBy("createdAt", "asc"))
            .related("fields", (f) => f.orderBy("sort", "asc"))
            .related("space", (s) => s.related("members", (m) => m.where("userId", ctx.userID))),
        )
        .one(),
    ),
  },
  workItems: {
    /** 空间的工作项列表，按筛选条件过滤（在服务端执行，只同步命中的工作项）。 */
    bySpace: defineQuery(spaceItemsArgs, ({ args, ctx }) =>
      spaceItems(args, ctx.userID).related("type").orderBy("createdAt", "desc"),
    ),
    /**
     * 空间看板（分泳道时用）：工作项连同处理人和流程定义。状态流卡片拖到别的列时在前端乐观执行流转，
     * 所以也要带上字段值（流转条件）和自己在空间里的成员身份。fields 只带这些字段的值（卡片、泳道、流转条件用到的）。
     */
    boardBySpace: defineQuery(boardArgs, ({ args, ctx }) =>
      boardCards(spaceItems(args, ctx.userID), args.fields, ctx.userID).orderBy("updatedAt", "desc"),
    ),
    /** 看板分列、数每列有几张卡片用：只要工作项本身。 */
    boardIndex: defineQuery(spaceItemsArgs, ({ args, ctx }) => spaceItems(args, ctx.userID)),
    /** 看板的一列：按阶段（node）或状态（status）分，最近更新的在前，最多 limit 张。 */
    boardColumn: defineQuery(
      boardArgs.extend({ column: boardColumnArgs, limit: z.number().int().min(1).max(5000) }),
      ({ args, ctx }) => {
        const c = args.column;
        const q = spaceItems(args, ctx.userID).where(({ or, and, cmp }) => {
          if (c.kind === "stage") return c.stage === null ? cmp("stage", "IS", null) : cmp("stage", c.stage);
          // 状态键不在这个状态流里（旧版本流程）的按状态名对上，和看板前端分列的规则一样
          const unknownKey = or(cmp("flowStatus", "IS", null), cmp("flowStatus", "NOT IN", c.keys));
          return c.kind === "status"
            ? or(cmp("flowStatus", c.key), and(unknownKey, cmp("stage", c.name)))
            : and(unknownKey, or(cmp("stage", "IS", null), cmp("stage", "NOT IN", c.names)));
        });
        return boardCards(q, args.fields, ctx.userID).orderBy("updatedAt", "desc").limit(args.limit);
      },
    ),
    /**
     * 回收站：空间里删除了的工作项。空间管理员看全部，其他成员只看自己删的。
     */
    recycleBin: defineQuery(z.object({ spaceId: z.string() }), ({ args, ctx }) =>
      zql.workItem
        .where("spaceId", args.spaceId)
        .where("deletedAt", "IS NOT", null)
        .where(({ or, cmp, exists }) =>
          or(
            cmp("deletedBy", ctx.userID),
            exists("space", (s) =>
              s.whereExists("members", (m) => m.where("userId", ctx.userID).where("role", "admin")),
            ),
          ),
        )
        .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID)))
        .related("type")
        .related("deleter")
        .orderBy("deletedAt", "desc"),
    ),
    /**
     * 度量图表的数据源：命中筛选的工作项，带自己能看到的字段值和角色成员，在前端汇总。
     * fields、roles 只带图表用到的字段和角色（不传时全部带上）。
     */
    forChart: defineQuery(
      spaceItemsArgs.extend({
        fields: z.array(z.string()).max(10).optional(),
        roles: z.array(z.string()).max(10).optional(),
      }),
      ({ args, ctx }) =>
        spaceItems(args, ctx.userID)
          .related("fieldValues", (v) => visibleFieldValues(ctx.userID)(onlyFields(args.fields)(v)))
          .related("roleMembers", (r) =>
            args.roles === undefined
              ? r
              : args.roles.length
                ? r.where("roleKey", "IN", args.roles)
                : r.where("workItemId", "IS", null),
          ),
    ),
    /** 空间甘特图：工作项连同节点排期和流程定义。改排期的 mutator 在前端乐观执行时也要读这些。 */
    /**
     * 全景视图：跨空间、跨工作项类型的工作项（数据源最多 200 个类型）。
     * 每个工作项照常按所在空间和类型的可见范围过滤。
     */
    panorama: defineQuery(z.object({ typeIds: z.array(z.string()).max(200) }), ({ args, ctx }) =>
      zql.workItem.where("typeId", "IN", args.typeIds).where(itemVisible(ctx.userID)).orderBy("createdAt", "desc"),
    ),
    plansBySpace: defineQuery(spaceItemsArgs, ({ args, ctx }) =>
      spaceItems(args, ctx.userID)
        .related("flowVersion")
        .related("space", (s) => s.related("members", (m) => m.where("userId", ctx.userID)))
        .related("fieldValues", visibleFieldValues(ctx.userID))
        .related("nodes", (n) => n.related("confirmations"))
        .orderBy("createdAt", "asc"),
    ),
    /**
     * 列表页：工作项连同列里要显示的东西（字段值、角色成员、节点负责人、自己的关注收藏和浏览记录）。
     * 页签：我参与的 = 担任任一角色或是节点负责人（负责人从角色来，按角色算）。
     */
    list: defineQuery(listArgs, ({ args, ctx }) => {
      let q = spaceItems(args, ctx.userID);
      const me = ctx.userID;
      if (args.tab === "created") q = q.where("createdBy", me);
      if (args.tab === "involved") q = q.whereExists("roleMembers", (r) => r.where("userId", me));
      if (args.tab === "followed") q = q.whereExists("marks", (m) => m.where("userId", me).where("kind", "follow"));
      if (args.tab === "starred") q = q.whereExists("marks", (m) => m.where("userId", me).where("kind", "star"));
      if (args.tab === "recent") q = q.whereExists("visits", (v) => v.where("userId", me));
      const search = args.search?.trim();
      if (search) q = q.where("name", "ILIKE", containsPattern(search));
      for (const o of args.order?.length ? args.order : [{ key: "createdAt" as const, desc: true }])
        q = q.orderBy(o.key, o.desc ? "desc" : "asc");
      if (args.limit) q = q.limit(args.limit);
      const needs = args.needs;
      const fields = (v: ReturnType<typeof zql.fieldValue.where>) =>
        visibleFieldValues(me)(onlyFields(needs?.fields)(v));
      const related = (v: ReturnType<typeof zql.fieldValue.where>) =>
        visibleFieldValues(me)(onlyFields(needs?.relatedFields)(v));
      const nodes = needs?.nodes ?? "all";
      // 不要关联时用一个不会命中的条件，保持返回的形状不变
      const relations = needs?.relations ?? true;
      return (
        q
          .related("type")
          .related("flowVersion")
          .related("fieldValues", fields)
          .related("roleMembers", (r) =>
            needs === undefined
              ? r
              : needs.roles.length
                ? r.where("roleKey", "IN", needs.roles)
                : r.where("workItemId", "IS", null),
          )
          .related("nodes", (n) =>
            nodes === "all"
              ? n
              : nodes === "active"
                ? n.where("state", "inProgress")
                : n.where("workItemId", "IS", null),
          )
          // 自定义关联（两个方向）连同另一端的名称、状态和字段值：关联列、关联字段列要显示
          .related("outgoing", (r) =>
            r
              .where(({ cmp }) => (relations ? cmp("relationDefId", "IS NOT", null) : cmp("fromId", "IS", null)))
              .related("to", (w) => w.where(itemVisible(me)).related("fieldValues", related)),
          )
          .related("incoming", (r) =>
            r
              .where(({ cmp }) => (relations ? cmp("relationDefId", "IS NOT", null) : cmp("toId", "IS", null)))
              .related("from", (w) => w.where(itemVisible(me)).related("fieldValues", related)),
          )
          .related("marks", (m) => m.where("userId", me))
          .related("visits", (v) => v.where("userId", me))
      );
    }),
    byId: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
      zql.workItem
        .where("id", args.id)
        .where(itemVisible(ctx.userID))
        .related("flowVersion")
        .related("type", (t) =>
          t
            .related("fields", (f) => f.orderBy("sort", "asc"))
            .related("roles", (r) => r.orderBy("sort", "asc").orderBy("createdAt", "asc"))
            .related("relationDefs", (r) => r.related("toType").orderBy("createdAt", "asc")),
        )
        // 自己在空间里的成员身份：前端乐观执行确认、回滚时要判断是不是管理员；业务线树给「业务线」字段当选项
        .related("space", (s) =>
          s
            .related("members", (m) => m.where("userId", ctx.userID))
            .related("businessLines", (b) => b.orderBy("sort", "asc")),
        )
        .related("fieldValues", visibleFieldValues(ctx.userID))
        .related("roleMembers", (r) => r.related("user"))
        // 节点连同在等它的依赖（别的工作项的名称只给看得到它的人）
        .related("nodes", (n) =>
          n
            .related("confirmations")
            .related("dependents", (d) => d.related("workItem", (w) => w.where(itemVisible(ctx.userID)))),
        )
        .related("comments", (c) => c.related("author").related("replyTo").orderBy("createdAt", "asc"))
        // 投票：自己的票，和已经公开（非盲投或已放榜）的票
        .related("ballots", (b) =>
          b
            .where(({ or, cmp }) => or(cmp("userId", ctx.userID), cmp("revealed", true)))
            .related("user")
            .orderBy("votedAt", "asc"),
        )
        .related("attachments", (a) => a.related("uploader").orderBy("createdAt", "asc"))
        // 节点子任务；确认节点时乐观执行也要数没完成的子任务
        .related("tasks", (t) => t.orderBy("createdAt", "asc").orderBy("id", "asc"))
        // 计划基线：甘特图和排期明细里对比
        .related("baselines", (b) => b.related("creator").orderBy("createdAt", "asc"))
        // 工作项上加的依赖和对方节点的状态；对方工作项只给看得到它的人
        .related("dependencies", (d) =>
          d
            .related("target", (t) => t.related("workItem", (w) => w.where(itemVisible(ctx.userID))))
            .orderBy("createdAt", "asc"),
        )
        .related("marks", (m) => m.where("userId", ctx.userID))
        // 子工作项、上级工作项和自定义关联（两个方向）
        // 关联工作项带上字段值和字段定义：布局里的「关联信息」要显示它们的字段
        .related("outgoing", (r) =>
          r
            .related("to", (w) =>
              w
                .where(itemVisible(ctx.userID))
                .related("fieldValues", visibleFieldValues(ctx.userID))
                .related("type", (t) => t.related("fields"))
                .related("nodes"),
            )
            .related("def"),
        )
        .related("incoming", (r) =>
          r
            .related("from", (w) =>
              w
                .where(itemVisible(ctx.userID))
                .related("fieldValues", visibleFieldValues(ctx.userID))
                .related("type", (t) => t.related("fields"))
                .related("nodes"),
            )
            .related("def"),
        )
        .one(),
    ),
    /** 加依赖时选对方节点：一个工作项的流程和节点状态。 */
    flowById: defineQuery(z.object({ id: z.string() }), ({ args, ctx }) =>
      zql.workItem.where("id", args.id).where(itemVisible(ctx.userID)).related("flowVersion").related("nodes").one(),
    ),
    /**
     * 树形视图的第一层：符合筛选条件的工作项，带上它们的上级（判断是不是根）和下级数量。
     * 更深的层级展开时用 workItems.children 按需加载。
     */
    treeBySpace: defineQuery(
      spaceItemsArgs.extend({ hierarchy: hierarchyArgs, plans: z.boolean().optional() }),
      ({ args, ctx }) =>
        spaceItems(args, ctx.userID)
          .related("type")
          .related("nodes", treePlans(args.plans))
          .related("incoming", (r) => r.where(hierarchyEdges(args.hierarchy)))
          .related("outgoing", (r) => r.where(hierarchyEdges(args.hierarchy)))
          .orderBy("createdAt", "desc"),
    ),
    /** 按层级管理的树形视图：第一层的工作项，带上沿下一层的关系能找到的下级。 */
    layerRoots: defineQuery(
      spaceItemsArgs.extend({ rootTypeId: z.string(), next: z.array(stepArgs).max(2), plans: z.boolean().optional() }),
      ({ args, ctx }) =>
        spaceItems({ spaceId: args.spaceId, filter: { ...args.filter, typeIds: [args.rootTypeId] } }, ctx.userID)
          .related("type")
          .related("nodes", treePlans(args.plans))
          .related("outgoing", (r) => r.where(stepEdges(args.next, false)))
          .related("incoming", (r) => r.where(stepEdges(args.next, true)))
          .orderBy("createdAt", "desc"),
    ),
    /**
     * 按层级展开一个工作项：沿 step 找到的下级，以及每个下级沿 next 的下级数量。
     * 正方向下级在关系的 to 一端（layerDown），反方向在 from 一端（layerUp）。
     */
    layerDown: defineQuery(layerArgs, ({ args, ctx }) =>
      zql.relation
        .where("fromId", args.id)
        .where(stepEdge(args.step))
        .whereExists("to", (w) => w.where("typeId", args.step.typeId).where(itemVisible(ctx.userID)))
        .related("to", (w) =>
          w
            .related("type")
            .related("nodes", treePlans(args.plans))
            .related("outgoing", (r) => r.where(stepEdges(args.next, false)))
            .related("incoming", (r) => r.where(stepEdges(args.next, true))),
        )
        .orderBy("createdAt", "asc"),
    ),
    layerUp: defineQuery(layerArgs, ({ args, ctx }) =>
      zql.relation
        .where("toId", args.id)
        .where(stepEdge(args.step))
        .whereExists("from", (w) => w.where("typeId", args.step.typeId).where(itemVisible(ctx.userID)))
        .related("from", (w) =>
          w
            .related("type")
            .related("nodes", treePlans(args.plans))
            .related("outgoing", (r) => r.where(stepEdges(args.next, false)))
            .related("incoming", (r) => r.where(stepEdges(args.next, true))),
        )
        .orderBy("createdAt", "asc"),
    ),
    /** 树形视图里展开一个工作项：它的下级，以及每个下级自己的下级数量。 */
    children: defineQuery(
      z.object({ id: z.string(), hierarchy: hierarchyArgs, plans: z.boolean().optional() }),
      ({ args, ctx }) =>
        zql.relation
          .where("fromId", args.id)
          .where(hierarchyEdges(args.hierarchy))
          .whereExists("to", (w) => w.where(itemVisible(ctx.userID)))
          .related("to", (w) =>
            w
              .related("type")
              .related("nodes", treePlans(args.plans))
              .related("outgoing", (r) => r.where(hierarchyEdges(args.hierarchy))),
          )
          .orderBy("createdAt", "asc"),
    ),
    /** 工作项动态：最近的事件，新的在前。受限字段的改动只给能看到这个字段的人。 */
    activity: defineQuery(
      z.object({ workItemId: z.string(), limit: z.number().int().min(1).max(500) }),
      ({ args, ctx }) =>
        zql.eventLog
          .where("workItemId", args.workItemId)
          .whereExists("workItem", (w) => w.where(itemVisible(ctx.userID)))
          .where(visibleEvent(ctx.userID))
          .related("actorUser")
          .orderBy("id", "desc")
          .limit(args.limit),
    ),
  },
  myWork: {
    /**
     * “我的工作”里的节点：所有空间里我参与的、还在进行中的工作项，带上进行中的节点。
     * 节点负责人存在 jsonb 数组里，查询过滤不了，由前端挑出负责人里有自己的节点。
     */
    nodes: defineQuery(({ ctx }) =>
      zql.workItem
        .where("status", "inProgress")
        .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID)))
        .whereExists("roleMembers", (r) => r.where("userId", ctx.userID))
        .whereExists("nodes", (n) => n.where("state", "inProgress"))
        .related("space")
        .related("type")
        .related("flowVersion")
        .related("nodes", (n) => n.where("state", "inProgress")),
    ),
    /** 分给我、还没完成的子任务。 */
    tasks: defineQuery(({ ctx }) =>
      zql.nodeTask
        .where("assigneeId", ctx.userID)
        .where("done", false)
        .whereExists("workItem", (w) =>
          w.whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID))),
        )
        .related("workItem", (w) => w.related("space").related("flowVersion")),
    ),
    /** 已办的节点：我参与的工作项里，某个时间之后完成的节点（负责人里有没有自己由前端判断）。 */
    doneNodes: defineQuery(z.object({ since: z.number() }), ({ args, ctx }) =>
      zql.workItem
        .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID)))
        .whereExists("roleMembers", (r) => r.where("userId", ctx.userID))
        .whereExists("nodes", (n) => n.where("state", "completed").where("actualEnd", ">=", args.since))
        .related("space")
        .related("type")
        .related("flowVersion")
        .related("nodes", (n) => n.where("state", "completed").where("actualEnd", ">=", args.since)),
    ),
    /** 已办的子任务：分给我、某个时间之后完成的。 */
    doneTasks: defineQuery(z.object({ since: z.number() }), ({ args, ctx }) =>
      zql.nodeTask
        .where("assigneeId", ctx.userID)
        .where("done", true)
        .where("doneAt", ">=", args.since)
        .whereExists("workItem", (w) =>
          w.whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", ctx.userID))),
        )
        .related("workItem", (w) => w.related("space").related("flowVersion")),
    ),
  },
  search: {
    /**
     * 全局搜索：自己所在的所有空间里，名称、文本类字段值（只查自己能看到的）或评论包含关键字的工作项，
     * 最近更新的在前。带上命中的字段值和评论，用来显示命中在哪里。
     */
    workItems: defineQuery(z.object({ q: z.string().trim().min(1).max(100) }), ({ args, ctx }) => {
      const pattern = containsPattern(args.q);
      const visible = visibleFieldValues(ctx.userID);
      return zql.workItem
        .where(itemVisible(ctx.userID))
        .where(({ or, cmp, exists }) =>
          or(
            cmp("name", "ILIKE", pattern),
            exists("fieldValues", (v) => visible(v.where("str", "ILIKE", pattern))),
            exists("comments", (c) => c.where("body", "ILIKE", pattern)),
          ),
        )
        .related("space")
        .related("type", (t) => t.related("fields"))
        .related("fieldValues", (v) => visible(v.where("str", "ILIKE", pattern)).limit(1))
        .related("comments", (c) => c.where("body", "ILIKE", pattern).orderBy("createdAt", "desc").limit(1))
        .orderBy("updatedAt", "desc")
        .limit(30);
    }),
  },
  notifications: {
    /** 自己最近的通知。 */
    mine: defineQuery(({ ctx }) =>
      zql.notification.where("userId", ctx.userID).related("workItem").orderBy("createdAt", "desc").limit(50),
    ),
  },
});
