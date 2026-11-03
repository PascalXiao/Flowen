import { type TypePermissions, viewLevelOf } from "@fp/sync";

/** 当前用户能看到的工作项类型：查看范围是「不可见」的类型不出现在导航里（管理员都能看到）。 */
export function visibleTypes<T extends { permissions?: TypePermissions | null }>(
  space: {
    workItemTypes: readonly T[];
    members: readonly { userId: string; role?: string | null }[];
    userGroups: readonly { id: string; members: readonly { userId: string }[] }[];
  },
  userId: string,
): T[] {
  const isAdmin = space.members.some((m) => m.userId === userId && m.role === "admin");
  const groups = space.userGroups.filter((g) => g.members.some((m) => m.userId === userId)).map((g) => g.id);
  return space.workItemTypes.filter((t) => viewLevelOf(t.permissions, groups, isAdmin) !== "none");
}
