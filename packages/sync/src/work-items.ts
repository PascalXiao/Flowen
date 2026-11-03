import {
  applyDefaults,
  conditionView,
  dayInTimeZone,
  dayToTimestamp,
  defaultRoleMembers,
  FlowEngine,
  type FlowEvent,
  isFinal,
  missingRequired,
  nodeFlowOf,
  normalizeFieldValue,
  type RoleOverrides,
  resolveOwners,
  roleAppears,
  StatusFlow,
  statusFlowOf,
  TEMPLATE_CONDITION_KEY,
  WorkCalendar,
} from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { assertSpaceMembers, requireWriter, syncFieldAccess } from "./access.ts";
import { withRuntimeOptions, writeFieldValue } from "./field-values.ts";
import { recomputeFlow } from "./flow.ts";
import { recomputeFormulas } from "./formulas.ts";
import { planNodes } from "./planning.ts";
import { zql } from "./schema.gen.ts";

export const createWorkItemArgs = z.object({
  id: z.string(),
  typeId: z.string(),
  name: z.string().min(1),
  /** 为空时用模板的当前版本；状态流类型没有模板。 */
  flowTemplateId: z.string().optional(),
  fields: z.record(z.string(), z.json()).default({}),
  /** 角色 → 成员用户 id。 */
  roles: z.record(z.string(), z.array(z.string())).default({}),
  /** 用户在新建表单里手动加上、删掉的角色。 */
  roleOverrides: z
    .object({ added: z.array(z.string()).optional(), removed: z.array(z.string()).optional() })
    .optional(),
});
export type CreateWorkItemArgs = z.output<typeof createWorkItemArgs>;

/** 角色成员必须是空间成员，而且不能是访客（访客只能查看和评论，担任角色也没法推进流程）。 */
export async function assertRoleMembers(tx: Transaction, spaceId: string, userIds: string[]) {
  await assertSpaceMembers(tx, spaceId, userIds);
  const wanted = [...new Set(userIds)];
  if (wanted.length === 0) return;
  const guests = await tx.run(
    zql.spaceMember.where("spaceId", spaceId).where("userId", "IN", wanted).where("role", "guest"),
  );
  if (guests.length > 0) throw new Error("访客不能担任角色。");
}

/** 节点实例的 id 由工作项和节点键决定，浏览器乐观执行和服务端执行写出的是同一行。 */
export function nodeInstanceId(workItemId: string, nodeKey: string): string {
  return `${workItemId}/${nodeKey}`;
}

/** 预置子任务的 id 由工作项、节点和序号决定，浏览器乐观执行和服务端写出的是同一行。 */
export function presetTaskId(workItemId: string, nodeKey: string, index: number): string {
  return `${workItemId}/${nodeKey}/task-${index}`;
}

/**
 * 新建工作项：写工作项、字段值、角色成员，并用流程引擎算出初始的节点状态和阶段
 * （开始节点自动完成、后续节点进入进行中、被开关裁剪的节点跳过）。
 * 引擎是纯函数，浏览器和服务端跑出来的结果一致。返回引擎产生的事件，服务端用它写 event_log。
 */
export async function createWorkItem(
  tx: Transaction,
  args: CreateWorkItemArgs,
  userID: string,
): Promise<{
  spaceId: string;
  flowVersionId: string | null;
  events: FlowEvent[];
}> {
  const type = await tx.run(
    zql.workItemType
      .where("id", args.typeId)
      .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)))
      .one(),
  );
  if (!type) throw new Error("工作项类型不存在或没有权限。");
  await requireWriter(tx, type.spaceId, userID);
  // 字段值先按类型整理成规范形式，流程引擎按整理后的值判断出现条件
  const defs = await withRuntimeOptions(
    tx,
    type.spaceId,
    await tx.run(zql.fieldDef.where("typeId", args.typeId).orderBy("sort", "asc")),
  );
  const given: Record<string, unknown> = {};
  for (const [fieldKey, input] of Object.entries(args.fields)) {
    const def = defs.find((f) => f.key === fieldKey);
    if (!def) throw new Error(`字段「${fieldKey}」不存在。`);
    const value = normalizeFieldValue(def, input);
    if (value !== null) given[fieldKey] = value;
  }
  // 流程类型（流程模板名）当条件用：默认值、条件必填、角色出现规则里都能按它判断
  const chosenTemplates = zql.flowTemplate.where("typeId", args.typeId);
  const chosen = await tx.run(
    (args.flowTemplateId
      ? chosenTemplates.where("id", args.flowTemplateId)
      : chosenTemplates.orderBy("createdAt", "asc")
    ).one(),
  );
  const templateCondition = { [TEMPLATE_CONDITION_KEY]: chosen?.name ?? "" };
  // 没填的字段套默认值，再检查必填（有效且显示出来的必填字段）
  const fields: Record<string, unknown> = {};
  for (const [fieldKey, value] of Object.entries(applyDefaults(defs, { ...given, ...templateCondition }))) {
    if (fieldKey === TEMPLATE_CONDITION_KEY) continue;
    const def = defs.find((f) => f.key === fieldKey);
    const normalized = def && !(fieldKey in given) ? normalizeFieldValue(def, value) : value;
    if (normalized !== null) fields[fieldKey] = normalized;
  }
  const missing = missingRequired(
    defs.filter((f) => f.dataType !== "attachment" && f.dataType !== "formula"),
    { ...fields, ...templateCondition },
  );
  if (missing.length > 0) throw new Error(`请填写必填字段：${missing.map((f) => f.name).join("、")}。`);

  // 角色：按出现规则决定有哪些角色，没给成员的角色按分配方式带上默认成员
  const roleDefs = await tx.run(zql.roleDef.where("typeId", args.typeId).orderBy("sort", "asc"));
  const view = conditionView(defs, { ...fields, ...templateCondition });
  const overrides = cleanOverrides(args.roleOverrides, roleDefs);
  const roles: Record<string, string[]> = {};
  for (const role of roleDefs) {
    if (!roleAppears(role, view, overrides)) continue;
    const members = [...new Set(args.roles[role.key] ?? defaultRoleMembers(role, view, userID))];
    if (role.config?.single && members.length > 1) throw new Error(`角色「${role.name}」只能有一个人。`);
    roles[role.key] = members;
  }
  await assertRoleMembers(tx, type.spaceId, Object.values(roles).flat());

  // 节点流和状态流都从类型的流程模板（默认第一个）的当前发布版本开始
  const templates = zql.flowTemplate.where("typeId", args.typeId);
  const template = await tx.run(
    (args.flowTemplateId ? templates.where("id", args.flowTemplateId) : templates.orderBy("createdAt", "asc")).one(),
  );
  if (!template?.currentVersionId) throw new Error("这个工作项类型还没有发布的流程模板。");
  const version = await tx.run(zql.flowVersion.where("id", template.currentVersionId).one());
  if (!version?.publishedAt) throw new Error("流程模板的当前版本还没有发布。");
  const definition = nodeFlowOf(version.definition);
  const states = statusFlowOf(version.definition);
  const statusFlow = states && new StatusFlow(states);
  const flowVersionId = version.id;

  const now = Date.now();
  const engine = definition ? new FlowEngine(definition) : null;
  const flow = definition && engine ? engine.start(fields, resolveOwners(definition, roles)) : null;
  // 自动排期从创建那天（空间时区）开始；一开始就完成的节点（开始节点）算当天完成
  const space = await tx.run(zql.space.where("id", type.spaceId).one());
  const today = dayInTimeZone(now, space?.timezone ?? "Asia/Shanghai");
  const planned =
    engine && flow
      ? planNodes(
          engine.graph,
          WorkCalendar.fromConfig(space?.calendar),
          flow.state,
          today,
          Object.fromEntries(
            Object.entries(flow.state.nodes).map(([key, n]) => [
              key,
              { start: null, end: null, pinned: false, actualEnd: n.state === "completed" ? today : null },
            ]),
          ),
          fields,
        )
      : {};

  await tx.mutate.workItem.insert({
    id: args.id,
    spaceId: type.spaceId,
    typeId: args.typeId,
    flowVersionId,
    name: args.name,
    // 状态流：从第一个状态开始，阶段列显示状态名
    stage: flow?.state.stage ?? statusFlow?.initial.name ?? null,
    flowStatus: statusFlow?.initial.key ?? null,
    status: flow?.state.status ?? (statusFlow && isFinal(statusFlow.initial.category) ? "completed" : "inProgress"),
    roleOverrides: overrides,
    createdBy: userID,
    createdAt: now,
    updatedAt: now,
  });
  for (const [fieldKey, value] of Object.entries(fields))
    await writeFieldValue(tx, { id: args.id, typeId: args.typeId, spaceId: type.spaceId }, fieldKey, value);
  for (const [roleKey, userIds] of Object.entries(roles))
    for (const userId of new Set(userIds))
      await tx.mutate.roleMember.insert({ workItemId: args.id, roleKey, userId, source: "manual" });

  if (definition && flow) {
    for (const [nodeKey, runtime] of Object.entries(flow.state.nodes)) {
      const reached = runtime.state === "inProgress" || runtime.state === "completed";
      await tx.mutate.nodeInstance.insert({
        id: nodeInstanceId(args.id, nodeKey),
        workItemId: args.id,
        nodeKey,
        state: runtime.state,
        owners: runtime.owners,
        actualStart: reached ? now : null,
        actualEnd: runtime.state === "completed" ? now : null,
        plannedStart: planned[nodeKey] ? dayToTimestamp(planned[nodeKey].start) : null,
        plannedEnd: planned[nodeKey] ? dayToTimestamp(planned[nodeKey].end) : null,
        plannedPinned: false,
        updatedAt: now,
      });
    }
    // 模板里预置的子任务；被跳过的节点也建上，节点恢复出现时就有
    for (const node of definition.nodes)
      for (const [index, name] of (node.tasks ?? []).entries())
        await tx.mutate.nodeTask.insert({
          id: presetTaskId(args.id, node.key, index),
          workItemId: args.id,
          nodeKey: node.key,
          name,
          assigneeId: null,
          dueDate: null,
          done: false,
          createdBy: userID,
          createdAt: now,
        });
  }

  await syncFieldAccess(tx, args.id);
  const events: FlowEvent[] = [...(flow?.events ?? [])];
  // 开始时就到达或完成的节点上的事件可能要改字段：写进去，再重算流程
  const assigned = events.filter((e) => e.type === "fieldAssigned");
  for (const e of assigned)
    if (e.type === "fieldAssigned")
      await writeFieldValue(tx, { id: args.id, typeId: args.typeId, spaceId: type.spaceId }, e.field, e.value);
  // 公式在服务端算；算出的值可能让流程的出现条件、自动节点有变化
  if (((await recomputeFormulas(tx, args.id)).length > 0 || assigned.length > 0) && definition)
    events.push(...(await recomputeFlow(tx, args.id, userID)));
  return { spaceId: type.spaceId, flowVersionId, events };
}

/** 只留存在的角色，空的时候存 null。 */
function cleanOverrides(
  overrides: { added?: string[] | undefined; removed?: string[] | undefined } | undefined,
  roles: readonly { key: string }[],
): RoleOverrides | null {
  const keys = new Set(roles.map((r) => r.key));
  const added = [...new Set(overrides?.added ?? [])].filter((k) => keys.has(k));
  const removed = [...new Set(overrides?.removed ?? [])].filter((k) => keys.has(k) && !added.includes(k));
  return added.length || removed.length ? { added, removed } : null;
}

export const copyWorkItemArgs = z.object({ sourceId: z.string(), id: z.string(), name: z.string().trim().min(1) });

/**
 * 复制工作项（对照飞书项目的「复制」）：同一类型、同一流程模板，字段值、角色成员、自定义关联带过去，
 * 类型设置里「复制时排除」的字段（字段键或关联名）和角色不带；公式字段重新算。新工作项从流程开头开始。
 */
export async function copyWorkItem(
  tx: Transaction,
  args: z.output<typeof copyWorkItemArgs>,
  userID: string,
): Promise<{ spaceId: string; typeId: string; flowVersionId: string | null; events: FlowEvent[] }> {
  const source = await tx.run(
    zql.workItem
      .where("id", args.sourceId)
      .whereExists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID)))
      .related("type", (t) => t.related("fields"))
      .related("flowVersion")
      .related("fieldValues")
      .related("roleMembers")
      .related("outgoing", (r) => r.where("relationDefId", "IS NOT", null).related("def"))
      .related("incoming", (r) => r.where("relationDefId", "IS NOT", null).related("def"))
      .one(),
  );
  if (!source?.type) throw new Error("工作项不存在或没有权限。");
  const settings = source.type.settings ?? {};
  const excluded = new Set(settings.copyExcludeFields ?? []);
  const fieldByKey = new Map(source.type.fields.map((f) => [f.key, f]));
  const skipField = (key: string) => {
    const f = fieldByKey.get(key);
    return !f || f.dataType === "formula" || excluded.has(key) || excluded.has(f.name);
  };
  const fields = Object.fromEntries(
    source.fieldValues.filter((v) => !skipField(v.fieldKey)).map((v) => [v.fieldKey, v.value as never]),
  );
  const excludedRoles = new Set(settings.copyExcludeRoles ?? []);
  const roles: Record<string, string[]> = {};
  for (const m of source.roleMembers)
    if (!excludedRoles.has(m.roleKey)) roles[m.roleKey] = [...(roles[m.roleKey] ?? []), m.userId];

  const created = await createWorkItem(
    tx,
    {
      id: args.id,
      typeId: source.typeId,
      name: args.name,
      ...(source.flowVersion?.templateId && { flowTemplateId: source.flowVersion.templateId }),
      fields,
      roles,
      ...(source.roleOverrides && {
        roleOverrides: {
          added: (source.roleOverrides.added ?? []).filter((r) => !excludedRoles.has(r)),
          removed: source.roleOverrides.removed ?? [],
        },
      }),
    },
    userID,
  );

  // 自定义关联：本端的关联按关联名、对端的按对端字段名排除；会挤掉别人已有关联的（单选）不带
  const now = Date.now();
  for (const r of source.outgoing) {
    if (!r.def || excluded.has(r.def.name) || (r.def.reverseName && r.def.reverseCardinality === "one")) continue;
    await tx.mutate.relation.insert({
      id: `${args.id}/copy/${r.id}`,
      relationDefId: r.def.id,
      parentNodeKey: null,
      fromId: args.id,
      toId: r.toId,
      createdAt: now,
    });
  }
  for (const r of source.incoming) {
    if (!r.def?.reverseName || excluded.has(r.def.reverseName) || r.def.cardinality === "one") continue;
    await tx.mutate.relation.insert({
      id: `${args.id}/copy/${r.id}`,
      relationDefId: r.def.id,
      parentNodeKey: null,
      fromId: r.fromId,
      toId: args.id,
      createdAt: now,
    });
  }
  await recomputeFormulas(tx, args.id);
  return {
    spaceId: created.spaceId,
    typeId: source.typeId,
    flowVersionId: created.flowVersionId,
    events: created.events,
  };
}
