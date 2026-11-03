import { nodeFlowOf } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { requireWriter } from "./access.ts";
import { recomputeFormulas, recomputeParentFormulas } from "./formulas.ts";
import { itemVisible } from "./permissions.ts";
import { zql } from "./schema.gen.ts";
import { createWorkItem, nodeInstanceId } from "./work-items.ts";

export const createSubItemArgs = z.object({
  id: z.string(),
  parentId: z.string(),
  nodeKey: z.string(),
  typeId: z.string(),
  name: z.string().trim().min(1, "子工作项要有名称。"),
});

/**
 * 为父工作项上进行中的“子工作项驱动”节点新建一个子工作项。
 * 子工作项的每个角色都先设成父节点的负责人（没有负责人时是自己）；子工作项全部结束后父节点自动完成。
 */
export async function createSubItem(tx: Transaction, args: z.output<typeof createSubItemArgs>, userID: string) {
  const parent = await tx.run(
    zql.workItem.where("id", args.parentId).where(itemVisible(userID)).related("flowVersion").one(),
  );
  if (!parent) throw new Error("工作项不存在或没有权限。");
  await requireWriter(tx, parent.spaceId, userID);
  const definition = nodeFlowOf(parent.flowVersion?.definition);
  const node = definition?.nodes.find((n) => n.key === args.nodeKey);
  if (node?.completion !== "subItemDriven") throw new Error("这个节点不是由子工作项驱动的。");
  const instance = await tx.run(zql.nodeInstance.where("id", nodeInstanceId(args.parentId, args.nodeKey)).one());
  if (instance?.state !== "inProgress") throw new Error(`节点「${node.name}」不在进行中，不能新建子工作项。`);

  const type = await tx.run(zql.workItemType.where("id", args.typeId).related("roles").one());
  if (!type || type.spaceId !== parent.spaceId) throw new Error("子工作项的类型必须属于同一个空间。");
  const owners = instance.owners?.length ? [...instance.owners] : [userID];
  const result = await createWorkItem(
    tx,
    {
      id: args.id,
      typeId: args.typeId,
      name: args.name,
      fields: {},
      roles: Object.fromEntries(type.roles.map((r) => [r.key, owners])),
    },
    userID,
  );
  await tx.mutate.relation.insert({
    id: `${args.parentId}/${args.nodeKey}/${args.id}`,
    relationDefId: null,
    parentNodeKey: args.nodeKey,
    fromId: args.parentId,
    toId: args.id,
    createdAt: Date.now(),
  });
  await recomputeParentFormulas(tx, args.id);
  return result;
}

export const createNodeSubItemArgs = z.object({
  id: z.string(),
  workItemId: z.string(),
  nodeKey: z.string(),
  name: z.string().trim().min(1, "工作项要有名称。"),
});

/**
 * 在节点上新建子工作项（节点配了 subItems）：建一个配置的类型的工作项，按配置的关联和本工作项关联上。
 * 关联名是本端看到的名字：本端建的关联用关联名，对端建的互相关联用对端字段名。
 */
export async function createNodeSubItem(tx: Transaction, args: z.output<typeof createNodeSubItemArgs>, userID: string) {
  const item = await tx.run(
    zql.workItem.where("id", args.workItemId).where(itemVisible(userID)).related("flowVersion").one(),
  );
  if (!item) throw new Error("工作项不存在或没有权限。");
  await requireWriter(tx, item.spaceId, userID);
  if (item.status === "terminated") throw new Error("工作项已终止。");
  if (item.frozen) throw new Error("工作项已冻结，解冻后才能修改。");
  const node = nodeFlowOf(item.flowVersion?.definition)?.nodes.find((n) => n.key === args.nodeKey);
  const config = node?.subItems;
  if (!node || !config) throw new Error("这个节点没有配子工作项。");
  const type = (await tx.run(zql.workItemType.where("spaceId", item.spaceId))).find(
    (t) => t.key === config.type || t.name === config.type,
  );
  if (!type) throw new Error(`子工作项的类型「${config.type}」不存在。`);
  // 本端建的关联（本工作项在 from 端），或对端建的互相关联（本工作项在 to 端）
  const defs = await tx.run(zql.relationDef.where("spaceId", item.spaceId));
  const outgoing = defs.find(
    (d) => d.fromTypeId === item.typeId && d.toTypeId === type.id && d.name === config.relation,
  );
  const incoming = defs.find(
    (d) => d.toTypeId === item.typeId && d.fromTypeId === type.id && (d.reverseName ?? d.name) === config.relation,
  );
  const def = outgoing ?? incoming;
  if (!def) throw new Error(`找不到关联「${config.relation}」。`);

  const result = await createWorkItem(
    tx,
    { id: args.id, typeId: type.id, name: args.name, fields: {}, roles: {} },
    userID,
  );
  await tx.mutate.relation.insert({
    id: `${args.workItemId}/${args.nodeKey}/sub/${args.id}`,
    relationDefId: def.id,
    parentNodeKey: null,
    fromId: outgoing ? args.workItemId : args.id,
    toId: outgoing ? args.id : args.workItemId,
    createdAt: Date.now(),
  });
  for (const id of [args.workItemId, args.id]) await recomputeFormulas(tx, id);
  return { ...result, typeId: type.id };
}
