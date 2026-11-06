import type { Grantee, PermissionOp, TypePermissions, ViewLevel } from "@fp/db/schema";
import type { ExpressionBuilder, Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { requireAdmin, spaceMemberOf } from "./access.ts";
import { type Schema, zql } from "./schema.gen.ts";

/*
 * 用户组和工作项类型权限：
 * - 用户组是空间里的一组人，本身没有权限，在类型的「权限」里授权给它。
 * - 查看：每个授权对象（空间成员、用户组）一个范围，取最大；空间管理员看全部，
 *   工作项上担任角色的人、创建者、关注人总能看到自己参与的。
 * - 操作（新建、终止/恢复、冻结/解冻、升级模板、删除）：禁止优先，其次允许，都没有就不能做；
 *   某种操作一条都没配时按原来的默认规则。空间管理员不受限制。
 */

export type { Grantee, PermissionOp, TypePermissions, ViewLevel };
export const VIEW_LEVELS = ["all", "involved", "none"] as const satisfies readonly ViewLevel[];
export const PERMISSION_OPS = [
  "create",
  "terminate",
  "freeze",
  "upgrade",
  "delete",
] as const satisfies readonly PermissionOp[];
export const VIEW_LEVEL_LABEL: Record<ViewLevel, string> = { all: "全部", involved: "仅参与的", none: "不可见" };
export const PERMISSION_OP_LABEL: Record<PermissionOp, string> = {
  create: "新建",
  terminate: "终止 / 恢复",
  freeze: "冻结 / 解冻",
  upgrade: "升级模板",
  delete: "删除",
};
const RANK: Record<ViewLevel, number> = { none: 0, involved: 1, all: 2 };

const grantee = z.string().regex(/^(members|group:.+|role:.+)$/) as unknown as z.ZodType<Grantee>;
export const typePermissionsSchema = z.object({
  view: z.record(grantee, z.enum(VIEW_LEVELS)).optional(),
  ops: z.partialRecord(z.enum(PERMISSION_OPS), z.record(grantee, z.enum(["allow", "deny"]))).optional(),
});

export const setPermissionsArgs = z.object({ typeId: z.string(), permissions: typePermissionsSchema.nullable() });
export const createGroupArgs = z.object({
  id: z.string(),
  spaceId: z.string(),
  name: z.string().trim().min(1).max(40),
});
export const renameGroupArgs = z.object({ id: z.string(), name: z.string().trim().min(1).max(40) });
export const groupIdArgs = z.object({ id: z.string() });
export const setGroupMembersArgs = z.object({ id: z.string(), userIds: z.array(z.string()).max(1000) });

/**
 * 工作项对当前用户可见：空间成员，并且是管理员、类型对成员或他所在的用户组开放全部，
 * 或者开放「仅参与的」而他参与了这个工作项（创建、担任角色、关注）。
 */
export function itemVisible(userID: string) {
  return ({ or, and, cmp, exists }: ExpressionBuilder<"workItem", Schema>) =>
    and(
      // 删除的工作项在回收站里，其他地方都看不到
      cmp("deletedAt", "IS", null),
      exists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID))),
      or(
        exists("space", (s) => s.whereExists("members", (m) => m.where("userId", userID).where("role", "admin"))),
        exists("type", (t) => t.where("viewBase", "all")),
        exists("type", (t) => t.whereExists("access", (a) => a.where("userId", userID).where("level", "all"))),
        and(
          or(
            exists("type", (t) => t.where("viewBase", "involved")),
            exists("type", (t) => t.whereExists("access", (a) => a.where("userId", userID).where("level", "involved"))),
          ),
          or(
            cmp("createdBy", userID),
            exists("roleMembers", (r) => r.where("userId", userID)),
            exists("marks", (m) => m.where("userId", userID).where("kind", "follow")),
          ),
        ),
      ),
    );
}

/** 类型对当前用户的查看范围（管理员是全部）。前端藏导航、服务端拦新建都用它。 */
export function viewLevelOf(
  permissions: TypePermissions | null | undefined,
  groupIds: readonly string[],
  isAdmin: boolean,
): ViewLevel {
  if (isAdmin) return "all";
  const view = permissions?.view ?? {};
  let best: ViewLevel = view.members ?? "all";
  for (const id of groupIds) {
    const level = view[`group:${id}`];
    if (level && RANK[level] > RANK[best]) best = level;
  }
  return best;
}

/** 一种操作对这些授权对象的结论：禁止优先，其次允许；没配这种操作时返回 null（按默认规则）。 */
export function decideOp(
  permissions: TypePermissions | null | undefined,
  op: PermissionOp,
  grantees: readonly Grantee[],
): boolean | null {
  const rules = permissions?.ops?.[op];
  if (!rules || Object.keys(rules).length === 0) return null;
  const hits = grantees.map((g) => rules[g]).filter(Boolean);
  if (hits.includes("deny")) return false;
  return hits.includes("allow");
}

export async function groupsOf(tx: Transaction, spaceId: string, userID: string): Promise<string[]> {
  const rows = await tx.run(
    zql.userGroupMember.where("userId", userID).whereExists("group", (g) => g.where("spaceId", spaceId)),
  );
  return rows.map((r) => r.groupId);
}

/**
 * 检查当前用户能不能对这个类型（或这个工作项）做某种操作。没配这种操作时用 fallback 判断默认规则。
 * 空间管理员总能做。
 */
export async function requireOp(
  tx: Transaction,
  target: { spaceId: string; typeId: string; itemRoles?: readonly string[] },
  userID: string,
  op: PermissionOp,
  fallback: () => boolean | Promise<boolean>,
  message: string,
) {
  const member = await spaceMemberOf(tx, target.spaceId, userID);
  if (member?.role === "admin") return;
  const type = await tx.run(zql.workItemType.where("id", target.typeId).one());
  const grantees: Grantee[] = [
    "members",
    ...(await groupsOf(tx, target.spaceId, userID)).map((id) => `group:${id}` as const),
    ...(target.itemRoles ?? []).map((key) => `role:${key}` as const),
  ];
  const decided = decideOp(type?.permissions, op, grantees);
  if (decided === false || (decided === null && !(await fallback()))) throw new Error(message);
}

/** 新建这种工作项前的检查：看不到这个类型的人不能建，再按「新建」权限。 */
export async function requireCreate(tx: Transaction, spaceId: string, typeId: string, userID: string) {
  const member = await spaceMemberOf(tx, spaceId, userID);
  if (member?.role === "admin") return;
  const type = await tx.run(zql.workItemType.where("id", typeId).one());
  const level = viewLevelOf(type?.permissions, await groupsOf(tx, spaceId, userID), false);
  const name = type?.name ?? "工作项";
  if (level === "none") throw new Error(`你没有权限新建${name}。`);
  await requireOp(tx, { spaceId, typeId }, userID, "create", () => true, `你没有权限新建${name}。`);
}

/**
 * 按类型权限和用户组成员重算 type_access：用户组给的查看范围比空间成员大时，每人一条。
 * 类型权限、用户组、用户组成员变化后调用。
 */
export async function syncTypeAccess(tx: Transaction, spaceId: string) {
  const types = await tx.run(zql.workItemType.where("spaceId", spaceId).related("access"));
  const groups = await tx.run(zql.userGroup.where("spaceId", spaceId).related("members"));
  for (const type of types) {
    const base = type.permissions?.view?.members ?? "all";
    if (type.viewBase !== base) await tx.mutate.workItemType.update({ id: type.id, viewBase: base });
    const wanted = new Map<string, ViewLevel>();
    for (const g of groups) {
      const level = type.permissions?.view?.[`group:${g.id}`];
      if (!level || RANK[level] <= RANK[base]) continue;
      for (const m of g.members) {
        const have = wanted.get(m.userId);
        if (!have || RANK[level] > RANK[have]) wanted.set(m.userId, level);
      }
    }
    for (const row of type.access)
      if (wanted.get(row.userId) !== row.level) {
        const level = wanted.get(row.userId);
        if (level) await tx.mutate.typeAccess.update({ typeId: type.id, userId: row.userId, level });
        else await tx.mutate.typeAccess.delete({ typeId: type.id, userId: row.userId });
      }
    const existing = new Set(type.access.map((a) => a.userId));
    for (const [userId, level] of wanted)
      if (!existing.has(userId)) await tx.mutate.typeAccess.insert({ typeId: type.id, userId, level });
  }
}

/** 改类型的权限。只有空间管理员可以；用到的用户组必须在这个空间里。 */
export async function setTypePermissions(tx: Transaction, args: z.output<typeof setPermissionsArgs>, userID: string) {
  const type = await tx.run(zql.workItemType.where("id", args.typeId).one());
  if (!type) throw new Error("工作项类型不存在。");
  await requireAdmin(tx, type.spaceId, userID, "只有空间管理员可以修改权限。");
  const perms = args.permissions;
  if (perms) {
    const groupIds = new Set((await tx.run(zql.userGroup.where("spaceId", type.spaceId))).map((g) => g.id));
    const roleKeys = new Set((await tx.run(zql.roleDef.where("typeId", type.id))).map((r) => r.key));
    const used = [
      ...Object.keys(perms.view ?? {}),
      ...Object.values(perms.ops ?? {}).flatMap((rules) => Object.keys(rules ?? {})),
    ];
    for (const g of used) {
      if (g.startsWith("group:") && !groupIds.has(g.slice(6))) throw new Error("用户组不存在。");
      if (g.startsWith("role:") && !roleKeys.has(g.slice(5))) throw new Error(`角色「${g.slice(5)}」不存在。`);
    }
    if (Object.keys(perms.view ?? {}).some((g) => g.startsWith("role:")))
      throw new Error("查看范围只能按空间成员和用户组设置，担任角色的人总能看到。");
  }
  await tx.mutate.workItemType.update({ id: type.id, permissions: (perms ?? null) as never });
  await syncTypeAccess(tx, type.spaceId);
}

async function adminGroup(tx: Transaction, id: string, userID: string) {
  const group = await tx.run(zql.userGroup.where("id", id).one());
  if (!group) throw new Error("用户组不存在。");
  await requireAdmin(tx, group.spaceId, userID, "只有空间管理员可以管理用户组。");
  return group;
}

export async function createGroup(tx: Transaction, args: z.output<typeof createGroupArgs>, userID: string) {
  await requireAdmin(tx, args.spaceId, userID, "只有空间管理员可以管理用户组。");
  const same = await tx.run(zql.userGroup.where("spaceId", args.spaceId).where("name", args.name).one());
  if (same) throw new Error(`已经有叫「${args.name}」的用户组了。`);
  await tx.mutate.userGroup.insert({ id: args.id, spaceId: args.spaceId, name: args.name, createdAt: Date.now() });
}

export async function renameGroup(tx: Transaction, args: z.output<typeof renameGroupArgs>, userID: string) {
  const group = await adminGroup(tx, args.id, userID);
  const same = await tx.run(zql.userGroup.where("spaceId", group.spaceId).where("name", args.name).one());
  if (same && same.id !== group.id) throw new Error(`已经有叫「${args.name}」的用户组了。`);
  await tx.mutate.userGroup.update({ id: group.id, name: args.name });
}

/** 删用户组：类型权限里引用它的授权一起去掉。 */
export async function deleteGroup(tx: Transaction, args: z.output<typeof groupIdArgs>, userID: string) {
  const group = await adminGroup(tx, args.id, userID);
  const key = `group:${group.id}` as Grantee;
  for (const type of await tx.run(zql.workItemType.where("spaceId", group.spaceId))) {
    const perms = type.permissions;
    if (!perms) continue;
    const view = { ...(perms.view ?? {}) };
    delete view[key];
    const ops = Object.fromEntries(
      Object.entries(perms.ops ?? {}).map(([op, rules]) => {
        const next = { ...(rules ?? {}) };
        delete next[key];
        return [op, next];
      }),
    );
    await tx.mutate.workItemType.update({ id: type.id, permissions: { view, ops } as never });
  }
  for (const m of await tx.run(zql.userGroupMember.where("groupId", group.id)))
    await tx.mutate.userGroupMember.delete({ groupId: group.id, userId: m.userId });
  await tx.mutate.userGroup.delete({ id: group.id });
  await syncTypeAccess(tx, group.spaceId);
}

/** 设置用户组的成员：只能是空间成员。 */
export async function setGroupMembers(tx: Transaction, args: z.output<typeof setGroupMembersArgs>, userID: string) {
  const group = await adminGroup(tx, args.id, userID);
  const wanted = [...new Set(args.userIds)];
  if (wanted.length) {
    const members = await tx.run(zql.spaceMember.where("spaceId", group.spaceId).where("userId", "IN", wanted));
    if (members.length !== wanted.length) throw new Error("用户组成员必须是空间成员。");
  }
  const existing = await tx.run(zql.userGroupMember.where("groupId", group.id));
  for (const m of existing)
    if (!wanted.includes(m.userId)) await tx.mutate.userGroupMember.delete({ groupId: group.id, userId: m.userId });
  const have = new Set(existing.map((m) => m.userId));
  for (const userId of wanted)
    if (!have.has(userId)) await tx.mutate.userGroupMember.insert({ groupId: group.id, userId });
  await syncTypeAccess(tx, group.spaceId);
}
