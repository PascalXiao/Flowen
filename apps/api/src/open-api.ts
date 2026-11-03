import { randomUUID } from "node:crypto";
import { type Database, schema } from "@fp/db";
import { nodeFlowOf, statusFlowOf } from "@fp/engine";
import { queries, workItemFilter } from "@fp/sync";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { ORPCError, os } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tokenUser } from "./tokens.ts";
import type { createZeroHandlers } from "./zero/handlers.ts";

/*
 * 开放接口（REST + OpenAPI）：给外部系统读写工作项。
 * 用 `Authorization: Bearer <令牌>` 认证，令牌代表创建它的用户，能看到和能做的事跟这个用户在界面上一样：
 * 读走和前端同一套 Zero 查询（带权限过滤），写走同一套 mutator（同样的校验、事件和自动化）。
 * 文档在 /open-api/v1/docs，OpenAPI 描述在 /open-api/v1/spec.json。
 */

export const OPEN_API_PREFIX = "/open-api/v1";

type Zero = ReturnType<typeof createZeroHandlers>;

const base = os.$context<{ headers: Headers; database: Database; zero: Zero }>();

const authed = base.use(async ({ context, next }) => {
  const userId = await tokenUser(context.database, context.headers);
  if (!userId) throw new ORPCError("UNAUTHORIZED", { message: "缺少或无效的访问令牌。" });
  return next({ context: { userId } });
});

/** 执行 mutator；业务校验失败（权限、条件不满足……）按 400 返回原因。 */
async function mutate(zero: Zero, name: string, args: unknown, userId: string) {
  try {
    await zero.run(name, args, userId);
  } catch (error) {
    if (error instanceof Error) throw new ORPCError("BAD_REQUEST", { message: error.message });
    throw error;
  }
}

const notFound = () => new ORPCError("NOT_FOUND", { message: "工作项不存在或没有权限。" });

const timestamp = z.number().describe("毫秒时间戳");
const fieldValues = z.record(z.string(), z.unknown()).describe("字段键 → 值");

const workItemSummary = z.object({
  id: z.string(),
  name: z.string(),
  spaceId: z.string(),
  typeId: z.string(),
  status: z.string().describe("inProgress / completed / terminated"),
  stage: z.string().nullable().describe("节点流的当前阶段；状态流的当前状态名"),
  createdAt: timestamp,
  updatedAt: timestamp,
});

const workItemDetail = workItemSummary.extend({
  flowStatus: z.string().nullable().describe("状态流的当前状态键；节点流为空"),
  createdBy: z.string(),
  fields: fieldValues.describe("自己能看到的字段值，字段键 → 值"),
  roles: z.record(z.string(), z.array(z.string())).describe("角色键 → 用户 id"),
  nodes: z
    .array(
      z.object({
        key: z.string(),
        name: z.string(),
        state: z.string().describe("notStarted / inProgress / completed / skipped"),
        owners: z.array(z.string()),
        plannedStart: timestamp.nullable(),
        plannedEnd: timestamp.nullable(),
      }),
    )
    .describe("节点流的节点；状态流为空"),
});

const space = z.object({ id: z.string(), name: z.string() });

const spaceDetail = space.extend({
  members: z.array(z.object({ userId: z.string(), name: z.string(), role: z.string() })),
  types: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
      flowMode: z.string().describe("node：节点流；state：状态流"),
      fields: z.array(
        z.object({
          key: z.string(),
          name: z.string(),
          alias: z.string().nullable().describe("对接标识：读写字段值时可以代替字段键"),
          dataType: z.string(),
          description: z.string().nullable().describe("帮助说明"),
          options: z.array(z.object({ value: z.string(), label: z.string() })).nullable(),
        }),
      ),
      roles: z.array(z.object({ key: z.string(), name: z.string() })),
    }),
  ),
});

interface ItemRow {
  id: string;
  name: string;
  spaceId: string;
  typeId: string;
  status: string | null;
  stage: string | null;
  createdAt: number | null;
  updatedAt: number | null;
}

/** Zero 的类型里有默认值的列都可能为空；接口里给出确定的值。 */
function toSummary(i: ItemRow): z.output<typeof workItemSummary> {
  return {
    id: i.id,
    name: i.name,
    spaceId: i.spaceId,
    typeId: i.typeId,
    status: i.status ?? "inProgress",
    stage: i.stage,
    createdAt: i.createdAt ?? 0,
    updatedAt: i.updatedAt ?? 0,
  };
}

type Detail = NonNullable<Awaited<ReturnType<typeof loadItem>>>;

function loadItem(zero: Zero, id: string, userId: string) {
  return zero.zql.run(queries.workItems.byId.fn({ args: { id }, ctx: { userID: userId } }));
}

function toDetail(item: Detail): z.output<typeof workItemDetail> {
  const flow = nodeFlowOf(item.flowVersion?.definition);
  const roles: Record<string, string[]> = {};
  for (const m of item.roleMembers) roles[m.roleKey] = [...(roles[m.roleKey] ?? []), m.userId];
  const states = new Map(item.nodes.map((n) => [n.nodeKey, n]));
  return {
    ...toSummary(item),
    flowStatus: statusFlowOf(item.flowVersion?.definition) ? item.flowStatus : null,
    createdBy: item.createdBy,
    fields: Object.fromEntries(item.fieldValues.map((f) => [f.fieldKey, f.value])),
    roles,
    nodes: (flow?.nodes ?? []).map((n) => {
      const runtime = states.get(n.key);
      return {
        key: n.key,
        name: n.name,
        state: runtime?.state ?? "notStarted",
        owners: [...(runtime?.owners ?? [])],
        plannedStart: runtime?.plannedStart ?? null,
        plannedEnd: runtime?.plannedEnd ?? null,
      };
    }),
  };
}

/** 读回工作项；写操作之后用它返回最新状态。 */
/** 字段值的键可以写字段键，也可以写对接标识；这里统一换成字段键。 */
async function byFieldKey(database: Database, typeId: string, fields: Record<string, unknown>) {
  const defs = await database.db
    .select({ key: schema.fieldDef.key, config: schema.fieldDef.config })
    .from(schema.fieldDef)
    .where(eq(schema.fieldDef.typeId, typeId));
  const keyOf = new Map<string, string>();
  for (const d of defs) if (d.config?.alias) keyOf.set(d.config.alias, d.key);
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [keyOf.get(k) ?? k, v]));
}

async function detail(zero: Zero, id: string, userId: string) {
  const item = await loadItem(zero, id, userId);
  if (!item) throw notFound();
  return toDetail(item);
}

const tags = { spaces: ["空间"], items: ["工作项"] };

export const openApiRouter = {
  spaces: {
    list: authed
      .route({ method: "GET", path: "/spaces", summary: "我所在的空间", tags: tags.spaces })
      .output(z.array(space))
      .handler(async ({ context }) => {
        const rows = await context.zero.zql.run(
          queries.spaces.mine.fn({ args: undefined, ctx: { userID: context.userId } }),
        );
        return rows.map((s) => ({ id: s.id, name: s.name }));
      }),
    get: authed
      .route({
        method: "GET",
        path: "/spaces/{spaceId}",
        summary: "空间详情：成员、工作项类型、字段和角色",
        tags: tags.spaces,
      })
      .input(z.object({ spaceId: z.string() }))
      .output(spaceDetail)
      .handler(async ({ input, context }) => {
        const s = await context.zero.zql.run(
          queries.spaces.byId.fn({ args: { id: input.spaceId }, ctx: { userID: context.userId } }),
        );
        if (!s) throw new ORPCError("NOT_FOUND", { message: "空间不存在或没有权限。" });
        return {
          id: s.id,
          name: s.name,
          members: s.members.map((m) => ({
            userId: m.userId,
            name: m.user?.name ?? m.userId,
            role: m.role ?? "member",
          })),
          types: s.workItemTypes.map((t) => ({
            id: t.id,
            key: t.key,
            name: t.name,
            flowMode: t.flowMode ?? "node",
            fields: [...t.fields]
              .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
              .map((f) => ({
                key: f.key,
                name: f.name,
                alias: f.config?.alias ?? null,
                dataType: f.dataType,
                description: f.config?.description ?? null,
                options: f.options ? f.options.map((o) => ({ value: o.value, label: o.label })) : null,
              })),
            roles: t.roles.map((r) => ({ key: r.key, name: r.name })),
          })),
        };
      }),
  },
  workItems: {
    list: authed
      .route({
        method: "POST",
        path: "/spaces/{spaceId}/work-items/query",
        summary: "按条件查询空间里的工作项（新创建的在前）",
        description: "筛选条件和界面上的筛选一样。用上一页返回的 nextCursor 取下一页。",
        tags: tags.items,
      })
      .input(
        z.object({
          spaceId: z.string(),
          filter: workItemFilter.optional(),
          limit: z.number().int().min(1).max(200).default(50),
          cursor: z.string().optional().describe("上一页返回的 nextCursor"),
        }),
      )
      .output(z.object({ items: z.array(workItemSummary), nextCursor: z.string().nullable() }))
      .handler(async ({ input, context }) => {
        let query = queries.workItems.bySpace.fn({
          args: { spaceId: input.spaceId, filter: input.filter },
          ctx: { userID: context.userId },
        });
        if (input.cursor) {
          const start = decodeCursor(input.cursor);
          if (!start) throw new ORPCError("BAD_REQUEST", { message: "cursor 无效。" });
          query = query.start(start);
        }
        const rows = await context.zero.zql.run(query.limit(input.limit + 1));
        const page = rows.slice(0, input.limit);
        const last = page.at(-1);
        return {
          items: page.map(toSummary),
          nextCursor:
            rows.length > input.limit && last ? encodeCursor({ id: last.id, createdAt: last.createdAt ?? 0 }) : null,
        };
      }),
    get: authed
      .route({ method: "GET", path: "/work-items/{id}", summary: "工作项详情", tags: tags.items })
      .input(z.object({ id: z.string() }))
      .output(workItemDetail)
      .handler(({ input, context }) => detail(context.zero, input.id, context.userId)),
    create: authed
      .route({
        method: "POST",
        path: "/work-items",
        summary: "新建工作项",
        description: "不传 flowTemplateId 时用类型的当前模板（状态流类型没有模板）。",
        tags: tags.items,
        successStatus: 201,
      })
      .input(
        z.object({
          typeId: z.string(),
          name: z.string().trim().min(1).max(200),
          flowTemplateId: z.string().optional(),
          fields: fieldValues.optional(),
          roles: z.record(z.string(), z.array(z.string())).optional().describe("角色键 → 用户 id"),
        }),
      )
      .output(workItemDetail)
      .handler(async ({ input, context }) => {
        const id = randomUUID();
        const fields = input.fields && (await byFieldKey(context.database, input.typeId, input.fields));
        await mutate(context.zero, "workItem.create", { id, ...input, ...(fields && { fields }) }, context.userId);
        return detail(context.zero, id, context.userId);
      }),
    setFields: authed
      .route({
        method: "PATCH",
        path: "/work-items/{id}/fields",
        summary: "修改字段值",
        description:
          "字段可以用字段键或对接标识。一次可以改多个字段，按顺序逐个保存；某个字段失败时，它前面的已经保存了。值传 null 表示清空。",
        tags: tags.items,
      })
      .input(z.object({ id: z.string(), fields: fieldValues }))
      .output(workItemDetail)
      .handler(async ({ input, context }) => {
        const [item] = await context.database.db
          .select({ typeId: schema.workItem.typeId })
          .from(schema.workItem)
          .where(eq(schema.workItem.id, input.id));
        const fields = item ? await byFieldKey(context.database, item.typeId, input.fields) : input.fields;
        for (const [fieldKey, value] of Object.entries(fields))
          await mutate(context.zero, "fieldValue.set", { workItemId: input.id, fieldKey, value }, context.userId);
        return detail(context.zero, input.id, context.userId);
      }),
    confirmNode: authed
      .route({
        method: "POST",
        path: "/work-items/{id}/nodes/{nodeKey}/confirm",
        summary: "确认完成节点",
        description: "节点配了完成表单时，在 values 里传表单字段的值。",
        tags: tags.items,
      })
      .input(z.object({ id: z.string(), nodeKey: z.string(), values: fieldValues.optional() }))
      .output(workItemDetail)
      .handler(async ({ input, context }) => {
        await mutate(
          context.zero,
          "node.confirm",
          { workItemId: input.id, nodeKey: input.nodeKey, values: input.values ?? {} },
          context.userId,
        );
        return detail(context.zero, input.id, context.userId);
      }),
    transition: authed
      .route({
        method: "POST",
        path: "/work-items/{id}/transition",
        summary: "状态流转（状态流工作项）",
        tags: tags.items,
      })
      .input(z.object({ id: z.string(), to: z.string().describe("目标状态键") }))
      .output(workItemDetail)
      .handler(async ({ input, context }) => {
        await mutate(context.zero, "workItem.transition", { workItemId: input.id, to: input.to }, context.userId);
        return detail(context.zero, input.id, context.userId);
      }),
    comment: authed
      .route({
        method: "POST",
        path: "/work-items/{id}/comments",
        summary: "发表评论",
        tags: tags.items,
        successStatus: 201,
      })
      .input(
        z.object({
          id: z.string(),
          body: z.string().trim().min(1).max(10_000),
          mentions: z.array(z.string()).max(50).optional().describe("要提醒的用户 id"),
        }),
      )
      .output(z.object({ id: z.string() }))
      .handler(async ({ input, context }) => {
        const id = randomUUID();
        await mutate(
          context.zero,
          "comment.create",
          { id, workItemId: input.id, body: input.body, mentions: input.mentions ?? [] },
          context.userId,
        );
        return { id };
      }),
  },
};

function encodeCursor(row: { id: string; createdAt: number }) {
  return Buffer.from(JSON.stringify([row.id, row.createdAt])).toString("base64url");
}

function decodeCursor(cursor: string): { id: string; createdAt: number } | null {
  try {
    const [id, createdAt] = JSON.parse(Buffer.from(cursor, "base64url").toString());
    return typeof id === "string" && typeof createdAt === "number" ? { id, createdAt } : null;
  } catch {
    return null;
  }
}

export function createOpenApiHandler() {
  return new OpenAPIHandler(openApiRouter, {
    plugins: [
      new OpenAPIReferencePlugin({
        schemaConverters: [new ZodToJsonSchemaConverter()],
        specPath: "/spec.json",
        docsPath: "/docs",
        docsTitle: "Flowen · 开放接口",
        // 固定文档页脚本的版本，不跟着 CDN 上的最新版走
        docsScriptUrl: "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.73.0",
        specGenerateOptions: {
          info: {
            title: "Flowen · 开放接口",
            version: "1.0.0",
            description:
              "用 `Authorization: Bearer <令牌>` 调用，令牌在「开放接口」页面创建。令牌代表创建它的用户，权限和这个用户在界面上一样。",
          },
          servers: [{ url: OPEN_API_PREFIX }],
          components: { securitySchemes: { token: { type: "http", scheme: "bearer" } } },
          security: [{ token: [] }],
        },
      }),
    ],
  });
}
