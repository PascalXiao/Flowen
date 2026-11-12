import { type InstanceDependency, nodeFlowOf } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { itemVisible } from "./permissions.ts";
import { zql } from "./schema.gen.ts";
import { assertAdmin } from "./templates.ts";

/** 一个空间最多几条联动规则。 */
export const MAX_LINK_RULES = 100;

const configArgs = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field"), sourceField: z.string().min(1), targetField: z.string().min(1) }),
  z.object({
    kind: z.literal("nodeDrive"),
    sourceNode: z.string().min(1),
    targetNode: z.string().min(1),
    mode: z.enum(["complete", "allow"]),
  }),
  z.object({ kind: z.literal("nodeSchedule"), sourceNode: z.string().min(1), targetNode: z.string().min(1) }),
]);

export const createLinkRuleArgs = z.object({
  id: z.string(),
  /** 规则建在哪个空间（跨空间关联两端的空间都可以）；不传时是关联定义所在的空间。 */
  spaceId: z.string().optional(),
  name: z.string().trim().min(1, "规则要有名称。").max(50),
  relationDefId: z.string(),
  sourceSide: z.enum(["from", "to"]),
  config: configArgs,
});
export const setLinkRuleEnabledArgs = z.object({ id: z.string(), enabled: z.boolean() });
export const deleteLinkRuleArgs = z.object({ id: z.string() });

/** 类型所有流程模板当前版本里的节点：键 → 名称。 */
async function typeNodes(tx: Transaction, typeId: string) {
  const templates = await tx.run(zql.flowTemplate.where("typeId", typeId).related("currentVersion"));
  const nodes = new Map<string, string>();
  for (const t of templates)
    for (const n of nodeFlowOf(t.currentVersion?.definition)?.nodes ?? [])
      if (!nodes.has(n.key)) nodes.set(n.key, n.name);
  return nodes;
}

/** 新建一条联动规则。只有空间管理员可以；字段要同类型，节点要在两端类型的流程里。 */
export async function createLinkRule(tx: Transaction, args: z.output<typeof createLinkRuleArgs>, userID: string) {
  const def = await tx.run(zql.relationDef.where("id", args.relationDefId).one());
  if (!def) throw new Error("关系不存在。");
  const spaceId = args.spaceId ?? def.spaceId;
  if (spaceId !== def.spaceId && spaceId !== def.toSpaceId) throw new Error("这条关系不在这个空间里。");
  await assertAdmin(tx, spaceId, userID);
  const existing = await tx.run(zql.linkRule.where("spaceId", spaceId));
  if (existing.length >= MAX_LINK_RULES) throw new Error(`一个空间最多 ${MAX_LINK_RULES} 条联动规则。`);
  const [sourceType, targetType] =
    args.sourceSide === "from" ? [def.fromTypeId, def.toTypeId] : [def.toTypeId, def.fromTypeId];
  const c = args.config;
  let config = c as typeof c & { sourceNodeName?: string };
  if (c.kind === "field") {
    const source = await tx.run(zql.fieldDef.where("typeId", sourceType).where("key", c.sourceField).one());
    const target = await tx.run(zql.fieldDef.where("typeId", targetType).where("key", c.targetField).one());
    if (!source || !target) throw new Error("字段不存在。");
    if (target.formula) throw new Error(`「${target.name}」是公式字段，不能被同步。`);
    if (source.dataType !== target.dataType) throw new Error(`「${source.name}」和「${target.name}」的字段类型不同。`);
  } else {
    const sources = await typeNodes(tx, sourceType);
    const targets = await typeNodes(tx, targetType);
    const sourceName = sources.get(c.sourceNode);
    if (!sourceName || !targets.has(c.targetNode)) throw new Error("节点不存在。");
    if (c.kind === "nodeDrive") config = { ...c, sourceNodeName: sourceName };
  }
  // 同一条关系、同一方向，同一个目标字段 / 节点只能有一条同类规则（跨空间关联两边建的规则一起算）
  const target = c.kind === "field" ? c.targetField : c.targetNode;
  const clash = (await tx.run(zql.linkRule.where("relationDefId", args.relationDefId))).some(
    (r) =>
      r.relationDefId === args.relationDefId &&
      r.sourceSide === args.sourceSide &&
      r.config.kind === c.kind &&
      (r.config.kind === "field" ? r.config.targetField : r.config.targetNode) === target,
  );
  if (clash) throw new Error("这条关系上已经有同样目标的规则了。");
  await tx.mutate.linkRule.insert({
    id: args.id,
    spaceId,
    name: args.name,
    relationDefId: args.relationDefId,
    sourceSide: args.sourceSide,
    config: config as never,
    enabled: true,
    createdBy: userID,
    createdAt: Date.now(),
  });
}

export async function setLinkRuleEnabled(
  tx: Transaction,
  args: z.output<typeof setLinkRuleEnabledArgs>,
  userID: string,
) {
  const rule = await tx.run(zql.linkRule.where("id", args.id).one());
  if (!rule) throw new Error("规则不存在。");
  await assertAdmin(tx, rule.spaceId, userID);
  await tx.mutate.linkRule.update({ id: args.id, enabled: args.enabled });
}

export async function deleteLinkRule(tx: Transaction, args: z.output<typeof deleteLinkRuleArgs>, userID: string) {
  const rule = await tx.run(zql.linkRule.where("id", args.id).one());
  if (!rule) throw new Error("规则不存在。");
  await assertAdmin(tx, rule.spaceId, userID);
  await tx.mutate.linkRule.delete({ id: args.id });
}

/**
 * 「才允许完成」的联动：关联的源工作项里，源节点还没完成的，目标节点要等它。
 * 返回按目标节点分组的等待项，合进流程状态的 dependencies。已终止、删除的源工作项不用等；
 * 看不到的源工作项只显示节点名。
 */
export async function linkGates(
  tx: Transaction,
  item: { id: string; spaceId: string; typeId: string },
  userID: string,
): Promise<Record<string, InstanceDependency[]>> {
  // 规则可能建在跨空间关联另一端的空间里，按关联两端的类型找
  const rules = (
    await tx.run(
      zql.linkRule
        .where("enabled", true)
        .whereExists("def", (d) =>
          d.where(({ or, cmp }) => or(cmp("fromTypeId", item.typeId), cmp("toTypeId", item.typeId))),
        )
        .related("def"),
    )
  ).filter((r) => r.config.kind === "nodeDrive" && r.config.mode === "allow");
  const gates: Record<string, InstanceDependency[]> = {};
  for (const rule of rules) {
    const config = rule.config;
    if (config.kind !== "nodeDrive" || !rule.def) continue;
    // 目标在源的另一端
    const targetType = rule.sourceSide === "from" ? rule.def.toTypeId : rule.def.fromTypeId;
    if (targetType !== item.typeId) continue;
    const edges = await tx.run(
      rule.sourceSide === "from"
        ? zql.relation.where("relationDefId", rule.relationDefId).where("toId", item.id)
        : zql.relation.where("relationDefId", rule.relationDefId).where("fromId", item.id),
    );
    for (const e of edges) {
      const sourceId = rule.sourceSide === "from" ? e.fromId : e.toId;
      const source = await tx.run(
        zql.workItem
          .where("id", sourceId)
          .related("nodes", (n) => n.where("nodeKey", config.sourceNode))
          .one(),
      );
      if (!source || source.status === "terminated" || source.deletedAt != null) continue;
      const state = source.nodes[0]?.state;
      // 源工作项没有这个节点（流程不同）时不拦
      if (!state || state === "completed" || state === "skipped") continue;
      const visible = await tx.run(zql.workItem.where("id", sourceId).where(itemVisible(userID)).one());
      const label = visible ? `${visible.name} · ${config.sourceNodeName}` : config.sourceNodeName;
      gates[config.targetNode] = [...(gates[config.targetNode] ?? []), { allow: "complete", waiting: label }];
    }
  }
  return gates;
}
