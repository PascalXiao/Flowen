import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { zql } from "./schema.gen.ts";

/*
 * 企业管理员和团队。整个部署是一个企业：团队不属于某个空间，所有人都能看到。
 * - 企业管理员：管理所有团队、企业模板，看审计日志，指定别的企业管理员。
 * - 团队：谁都可以新建（自己成为团队管理员）；团队管理员和企业管理员能改、能删。
 *   上级团队可以有多个，不能成环；可用空间为空表示所有空间都能用。
 */

export async function isOrgAdmin(tx: Transaction, userID: string): Promise<boolean> {
  return !!(await tx.run(zql.orgAdmin.where("userId", userID).one()));
}

export async function requireOrgAdmin(tx: Transaction, userID: string, message: string) {
  if (!(await isOrgAdmin(tx, userID))) throw new Error(message);
}

export const setOrgAdminArgs = z.object({ userId: z.string(), admin: z.boolean() });

/** 设置或取消企业管理员。只有企业管理员可以；至少要留一个。 */
export async function setOrgAdmin(tx: Transaction, args: z.output<typeof setOrgAdminArgs>, userID: string) {
  await requireOrgAdmin(tx, userID, "只有企业管理员可以设置企业管理员。");
  const existing = await tx.run(zql.orgAdmin.where("userId", args.userId).one());
  if (args.admin) {
    if (existing) return;
    const user = await tx.run(zql.user.where("id", args.userId).one());
    if (!user) throw new Error("用户不存在。");
    await tx.mutate.orgAdmin.insert({ userId: args.userId, createdAt: Date.now() });
    return;
  }
  if (!existing) return;
  const all = await tx.run(zql.orgAdmin);
  if (all.length <= 1) throw new Error("至少要有一个企业管理员。");
  await tx.mutate.orgAdmin.delete({ userId: args.userId });
}

const userIds = z.array(z.string()).max(1000);
const teamBody = {
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).nullable().optional(),
  parentIds: z.array(z.string()).max(20).default([]),
  admins: userIds.max(50).default([]),
  /** 可用空间；null 表示所有空间。 */
  spaceIds: z.array(z.string()).max(500).nullable().default(null),
};
export const createTeamArgs = z.object({ id: z.string(), ...teamBody, members: userIds.default([]) });
export const updateTeamArgs = z.object({ id: z.string(), ...teamBody });
export const setTeamMembersArgs = z.object({ id: z.string(), userIds });
export const deleteTeamArgs = z.object({ id: z.string() });

type TeamRow = { id: string; name: string; parentIds: readonly string[] | null; admins: readonly string[] | null };

/** 能管理这个团队：企业管理员或团队管理员。 */
async function requireTeamAdmin(tx: Transaction, id: string, userID: string): Promise<TeamRow> {
  const team = await tx.run(zql.team.where("id", id).one());
  if (!team) throw new Error("团队不存在。");
  if (!(team.admins ?? []).includes(userID) && !(await isOrgAdmin(tx, userID)))
    throw new Error("只有团队管理员和企业管理员可以修改团队。");
  return team;
}

/** 检查上级团队：都存在，且不会让团队层级成环。 */
export function checkTeamParents(teams: readonly TeamRow[], id: string, parentIds: readonly string[]): string | null {
  const byId = new Map(teams.map((t) => [t.id, t]));
  for (const p of parentIds) {
    if (p === id) return "团队不能是自己的上级。";
    if (!byId.has(p)) return "上级团队不存在。";
  }
  // 从每个上级往上走，走回自己就成环了
  const seen = new Set<string>();
  const stack = [...parentIds];
  while (stack.length) {
    const cur = stack.pop() as string;
    if (cur === id) return "上下级关系不能成环。";
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(byId.get(cur)?.parentIds ?? []));
  }
  return null;
}

async function checkUsers(tx: Transaction, ids: readonly string[]) {
  for (const id of new Set(ids)) if (!(await tx.run(zql.user.where("id", id).one()))) throw new Error("有成员不存在。");
}

/** 新建团队。谁都可以建；没指定管理员时创建人是管理员。 */
export async function createTeam(tx: Transaction, args: z.output<typeof createTeamArgs>, userID: string) {
  const teams = await tx.run(zql.team);
  const error = checkTeamParents(teams, args.id, args.parentIds);
  if (error) throw new Error(error);
  if (teams.some((t) => t.name === args.name)) throw new Error(`已经有叫「${args.name}」的团队了。`);
  const admins = args.admins.length ? [...new Set(args.admins)] : [userID];
  await checkUsers(tx, [...admins, ...args.members]);
  await tx.mutate.team.insert({
    id: args.id,
    name: args.name,
    description: args.description ?? null,
    parentIds: [...new Set(args.parentIds)],
    admins,
    spaceIds: args.spaceIds,
    sort: teams.length,
    createdBy: userID,
    createdAt: Date.now(),
  });
  for (const member of new Set(args.members))
    await tx.mutate.teamMember.insert({ teamId: args.id, userId: member, createdAt: Date.now() });
}

export async function updateTeam(tx: Transaction, args: z.output<typeof updateTeamArgs>, userID: string) {
  await requireTeamAdmin(tx, args.id, userID);
  const teams = await tx.run(zql.team);
  const error = checkTeamParents(teams, args.id, args.parentIds);
  if (error) throw new Error(error);
  if (teams.some((t) => t.id !== args.id && t.name === args.name))
    throw new Error(`已经有叫「${args.name}」的团队了。`);
  if (args.admins.length === 0) throw new Error("团队至少要有一个管理员。");
  await checkUsers(tx, args.admins);
  await tx.mutate.team.update({
    id: args.id,
    name: args.name,
    description: args.description ?? null,
    parentIds: [...new Set(args.parentIds)],
    admins: [...new Set(args.admins)],
    spaceIds: args.spaceIds,
  });
}

/** 整体设置团队成员，返回加上和移出的人（审计用）。 */
export async function setTeamMembers(tx: Transaction, args: z.output<typeof setTeamMembersArgs>, userID: string) {
  await requireTeamAdmin(tx, args.id, userID);
  await checkUsers(tx, args.userIds);
  const existing = await tx.run(zql.teamMember.where("teamId", args.id));
  const want = new Set(args.userIds);
  const have = new Set(existing.map((m) => m.userId));
  const removed = existing.filter((m) => !want.has(m.userId)).map((m) => m.userId);
  const added = [...want].filter((u) => !have.has(u));
  for (const u of removed) await tx.mutate.teamMember.delete({ teamId: args.id, userId: u });
  for (const u of added) await tx.mutate.teamMember.insert({ teamId: args.id, userId: u, createdAt: Date.now() });
  return { added, removed };
}

/** 删除团队：下级团队不删，只是不再挂在它下面。 */
export async function deleteTeam(tx: Transaction, args: z.output<typeof deleteTeamArgs>, userID: string) {
  await requireTeamAdmin(tx, args.id, userID);
  for (const t of await tx.run(zql.team))
    if ((t.parentIds ?? []).includes(args.id))
      await tx.mutate.team.update({ id: t.id, parentIds: (t.parentIds ?? []).filter((p) => p !== args.id) });
  for (const m of await tx.run(zql.teamMember.where("teamId", args.id)))
    await tx.mutate.teamMember.delete({ teamId: args.id, userId: m.userId });
  await tx.mutate.team.delete({ id: args.id });
}

/** 团队和它所有下级团队（含多层）的 id。 */
export function teamWithDescendants(
  teams: readonly { id: string; parentIds: readonly string[] | null }[],
  id: string,
): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of teams)
      if (!out.has(t.id) && (t.parentIds ?? []).some((p) => out.has(p))) {
        out.add(t.id);
        grew = true;
      }
  }
  return out;
}

/** 团队的成员：团队和所有下级团队的成员，去重。 */
export function teamMemberIds(
  teams: readonly { id: string; parentIds: readonly string[] | null; members?: readonly { userId: string }[] }[],
  id: string,
): string[] {
  const ids = teamWithDescendants(teams, id);
  return [...new Set(teams.filter((t) => ids.has(t.id)).flatMap((t) => (t.members ?? []).map((m) => m.userId)))];
}

/** 筛选条件里的人员值：team:<团队 id> 表示这个团队（含下级团队）的成员。 */
export const TEAM_PREFIX = "team:";

/** 这个团队在这个空间能不能用（可用空间为空表示所有空间）。 */
export const teamAvailableIn = (team: { spaceIds: readonly string[] | null }, spaceId: string) =>
  !team.spaceIds?.length || team.spaceIds.includes(spaceId);

/**
 * 查询前把筛选里用到的团队展开成成员名单，跟着筛选条件一起发给服务端（和 clock 一样不存进视图）。
 * 服务端把 team:<id> 换成名单里的人；名单只影响筛选结果，权限照样在服务端过滤。
 */
export function teamsForFilter(
  filter: { conds?: { groups: { items: { values?: readonly string[] }[] }[] } },
  teams: readonly { id: string; parentIds: readonly string[] | null; members?: readonly { userId: string }[] }[],
): Record<string, string[]> | undefined {
  const used = new Set<string>();
  for (const g of filter.conds?.groups ?? [])
    for (const c of g.items)
      for (const v of c.values ?? []) if (v.startsWith(TEAM_PREFIX)) used.add(v.slice(TEAM_PREFIX.length));
  if (used.size === 0) return undefined;
  return Object.fromEntries([...used].map((id) => [id, teamMemberIds(teams, id)]));
}
