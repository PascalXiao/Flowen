import { cyclicNodes, nodeFlowOf, scheduleLinks } from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { canOperateNode, loadForAction, recomputeFlow } from "./flow.ts";
import { itemVisible } from "./permissions.ts";
import { zql } from "./schema.gen.ts";
import { nodeInstanceId } from "./work-items.ts";

/** 一个节点上最多加的依赖数。 */
export const MAX_NODE_DEPENDENCIES = 20;

export const addDependencyArgs = z.object({
  id: z.string(),
  workItemId: z.string(),
  nodeKey: z.string(),
  /** 被依赖的节点所在的工作项：可以是本工作项，也可以是同一空间里的别的工作项。 */
  targetItemId: z.string(),
  targetNodeKey: z.string(),
  allow: z.enum(["start", "complete"]),
});
export const removeDependencyArgs = z.object({ id: z.string() });
export const recheckArgs = z.object({ workItemId: z.string() });

const DENIED = "只有节点负责人、可操作角色或空间管理员可以改依赖。";

/**
 * 在工作项上给节点加一条依赖：要等另一个节点完成，才能开始或才能完成。
 * 流程模板里配的依赖对所有工作项生效；这里加的只对这一个工作项生效，也可以等别的工作项里的节点。
 */
export async function addDependency(tx: Transaction, args: z.output<typeof addDependencyArgs>, userID: string) {
  const flow = await loadForAction(tx, args.workItemId, userID);
  const graph = flow.engine.graph;
  if (!graph.has(args.nodeKey)) throw new Error("节点不存在。");
  if (!canOperateNode(flow, args.nodeKey, userID)) throw new Error(DENIED);
  const node = graph.node(args.nodeKey);
  const state = flow.state.nodes[args.nodeKey]?.state;
  if (state === "completed" || state === "skipped") throw new Error(`节点「${node.name}」已经结束，不能再加依赖。`);
  if (state === "inProgress" && args.allow === "start")
    throw new Error(`节点「${node.name}」已经开始了，只能加「才能完成」的依赖。`);

  if (args.targetItemId === args.workItemId) {
    if (args.targetNodeKey === args.nodeKey) throw new Error("节点不能依赖自己。");
    if (graph.has(args.targetNodeKey) && graph.descendants(args.nodeKey).has(args.targetNodeKey))
      throw new Error(`「${graph.node(args.targetNodeKey).name}」在「${node.name}」后面，等它会卡住流程。`);
    // 和流程模板里配的依赖、排期规则，以及已经加的依赖合起来不能绕成环
    const added = {
      ...flow.state.dependencies,
      [args.nodeKey]: [
        ...(flow.state.dependencies?.[args.nodeKey] ?? []),
        { allow: args.allow, node: args.targetNodeKey },
      ],
    };
    if (graph.has(args.targetNodeKey) && cyclicNodes(graph, scheduleLinks(graph, added)).length > 0)
      throw new Error(`「${graph.node(args.targetNodeKey).name}」已经在等「${node.name}」了，互相等待会卡住。`);
  }
  const target = await tx.run(
    zql.workItem
      .where("id", args.targetItemId)
      .where(itemVisible(userID))
      .related("flowVersion")
      .related("nodes", (n) => n.where("nodeKey", args.targetNodeKey))
      .one(),
  );
  if (!target || target.spaceId !== flow.spaceId) throw new Error("要依赖的工作项不存在或没有权限。");
  const targetNode = nodeFlowOf(target.flowVersion?.definition)?.nodes.find((n) => n.key === args.targetNodeKey);
  const instance = target.nodes[0];
  if (!targetNode || !instance) throw new Error("要依赖的节点不存在。");
  if (instance.state === "skipped") throw new Error(`「${targetNode.name}」已经被跳过，不用等它。`);

  const mine = await tx.run(zql.nodeDependency.where("workItemId", args.workItemId).where("nodeKey", args.nodeKey));
  if (mine.some((d) => d.targetNodeId === instance.id && d.allow === args.allow)) throw new Error("已经有这条依赖了。");
  if (mine.length >= MAX_NODE_DEPENDENCIES) throw new Error(`一个节点最多加 ${MAX_NODE_DEPENDENCIES} 条依赖。`);
  // 对方已经在等这个节点：互相等会卡死
  const reverse = await tx.run(
    zql.nodeDependency
      .where("workItemId", args.targetItemId)
      .where("nodeKey", args.targetNodeKey)
      .where("targetNodeId", nodeInstanceId(args.workItemId, args.nodeKey)),
  );
  if (reverse.length > 0) throw new Error(`「${targetNode.name}」已经在等「${node.name}」了，互相等待会卡住。`);

  await tx.mutate.nodeDependency.insert({
    id: args.id,
    workItemId: args.workItemId,
    nodeKey: args.nodeKey,
    targetNodeId: instance.id,
    targetNodeName: targetNode.name,
    allow: args.allow,
    createdBy: userID,
    createdAt: Date.now(),
  });
  // 本工作项里的依赖会影响排期，加完重排一次
  const events = await recomputeFlow(tx, args.workItemId, userID);
  return { spaceId: flow.spaceId, targetNodeName: targetNode.name, targetItemName: target.name, events };
}

/** 删掉一条依赖，然后重算流程：原来在等它的节点可能可以开始了。 */
export async function removeDependency(tx: Transaction, args: z.output<typeof removeDependencyArgs>, userID: string) {
  const dependency = await tx.run(zql.nodeDependency.where("id", args.id).one());
  if (!dependency) throw new Error("依赖不存在。");
  const flow = await loadForAction(tx, dependency.workItemId, userID);
  if (flow.engine.graph.has(dependency.nodeKey) && !canOperateNode(flow, dependency.nodeKey, userID))
    throw new Error(DENIED);
  await tx.mutate.nodeDependency.delete({ id: args.id });
  const events = await recomputeFlow(tx, dependency.workItemId, userID);
  return { spaceId: flow.spaceId, dependency, events };
}

/**
 * 别的工作项里被依赖的节点完成（或它的工作项终止、删除）后，重算这个工作项：
 * 在等它的节点可以开始了。由 worker 调用；没有变化时什么也不做，可以重复调用。
 */
export async function recheckDependencies(tx: Transaction, args: z.output<typeof recheckArgs>, userID: string) {
  const item = await tx.run(zql.workItem.where("id", args.workItemId).one());
  if (!item || item.frozen || item.deletedAt != null) return { spaceId: item?.spaceId ?? "", events: [] };
  return { spaceId: item.spaceId, events: await recomputeFlow(tx, args.workItemId, userID) };
}
