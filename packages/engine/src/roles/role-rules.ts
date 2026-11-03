/*
 * 流程角色的规则，对照飞书项目的角色管理：
 *
 * - 出现方式：默认出现（可设能不能删）/ 默认隐藏（用户自己「添加角色」）/ 满足条件自动出现。
 *   用户手动加上或删掉的角色记在工作项上，之后不再跟着规则变，直到重新启用规则。
 * - 成员分配：创建者 / 自行添加 / 全部默认分配给指定成员 / 按条件默认分配
 *   （条件组从上到下取第一个命中的，或取所有命中的并集；都没命中时用兜底成员）。
 * - 限制为单人、是否为负责人、谁能改这个角色的成员（任何人 / 空间管理员 / 创建人 / 某些角色）。
 *
 * 业务线是空间级的一棵树，工作项上的「业务线」字段从里面选，条件可以按业务线判断（选上级时下级也算）。
 */

import type { FieldOption } from "../fields/field-value.ts";
import { type Condition, evaluate, type Fields } from "../flow/condition.ts";

export type RoleAppear =
  | { mode: "default"; allowRemove?: boolean }
  | { mode: "hidden" }
  | { mode: "conditional"; when: Condition; allowRemove?: boolean };

export type RoleAssign =
  | { mode: "creator" }
  | { mode: "manual" }
  | { mode: "fixed"; members: string[] }
  | {
      mode: "conditional";
      rules: { when: Condition; members: string[] }[];
      /** first：从上到下取第一个命中的；union：取所有命中的并集。 */
      combine?: "first" | "union";
      /** 一个条件都没命中时的成员。 */
      fallback?: string[];
    };

export type RoleEditors =
  | { mode: "anyone" }
  | { mode: "admin" }
  | { mode: "creator" }
  | { mode: "roles"; roles: string[] };

/** 角色上除名称以外的配置，存在 role_def.config。为空时：默认出现、成员默认是创建者、任何人可改。 */
export type RoleConfig = {
  appear?: RoleAppear | null;
  assign?: RoleAssign | null;
  /** 限制为单人。 */
  single?: boolean | null;
  /** 是否为负责人：工作项的负责人可以删除、终止工作项，增删角色。 */
  isOwner?: boolean | null;
  editors?: RoleEditors | null;
  description?: string | null;
};

export interface RuleRole {
  key: string;
  name: string;
  config?: RoleConfig | null;
}

/** 工作项上手动加上、删掉的角色。 */
export interface RoleOverrides {
  added?: string[];
  removed?: string[];
}

/** 角色此刻是否出现在工作项上。条件按条件求值用的字段值判断（见 conditionView）。 */
export function roleAppears(role: RuleRole, view: Fields, overrides?: RoleOverrides | null): boolean {
  if (overrides?.added?.includes(role.key)) return true;
  if (overrides?.removed?.includes(role.key)) return false;
  const appear = role.config?.appear;
  if (!appear || appear.mode === "default") return true;
  if (appear.mode === "hidden") return false;
  return evaluate(appear.when, view);
}

/** 用户能不能把这个出现了的角色删掉。 */
export function roleRemovable(role: RuleRole): boolean {
  const appear = role.config?.appear;
  if (!appear) return true;
  if (appear.mode === "hidden") return true;
  return appear.allowRemove !== false;
}

/** 按分配方式算出的默认成员。 */
export function defaultRoleMembers(role: RuleRole, view: Fields, creatorId: string): string[] {
  const assign = role.config?.assign;
  let members: string[];
  if (!assign || assign.mode === "creator") members = [creatorId];
  else if (assign.mode === "manual") members = [];
  else if (assign.mode === "fixed") members = [...assign.members];
  else {
    const hits = assign.rules.filter((r) => evaluate(r.when, view));
    if (hits.length === 0) members = [...(assign.fallback ?? [])];
    else if (assign.combine === "union") members = hits.flatMap((r) => r.members);
    else members = [...(hits[0]?.members ?? [])];
  }
  const unique = [...new Set(members)];
  return role.config?.single ? unique.slice(0, 1) : unique;
}

/** 新建时每个出现的角色的默认成员；不出现的角色不在结果里。 */
export function initialRoleMembers(
  roles: readonly RuleRole[],
  view: Fields,
  creatorId: string,
  overrides?: RoleOverrides | null,
): Record<string, string[]> {
  return Object.fromEntries(
    roles.filter((r) => roleAppears(r, view, overrides)).map((r) => [r.key, defaultRoleMembers(r, view, creatorId)]),
  );
}

/** 当前用户能不能改这个角色的成员。空间管理员总是可以。 */
export function canEditRoleMembers(
  role: RuleRole,
  who: { isAdmin: boolean; isCreator: boolean; roles: readonly string[] },
): boolean {
  if (who.isAdmin) return true;
  const editors = role.config?.editors;
  if (!editors || editors.mode === "anyone") return true;
  if (editors.mode === "admin") return false;
  if (editors.mode === "creator") return who.isCreator;
  return editors.roles.some((r) => who.roles.includes(r));
}

/** 角色配置里用到的条件（检查引用的字段用）。 */
export function roleConditions(config: RoleConfig | null | undefined): Condition[] {
  if (!config) return [];
  return [
    ...(config.appear?.mode === "conditional" ? [config.appear.when] : []),
    ...(config.assign?.mode === "conditional" ? config.assign.rules.map((r) => r.when) : []),
  ];
}

/** 空间业务线树的一个节点。 */
export interface BusinessLine {
  id: string;
  name: string;
  parentId?: string | null;
  disabled?: boolean | null;
}

/** 业务线树转成「业务线」字段的选项（级联）。 */
export function businessLineOptions(lines: readonly BusinessLine[]): FieldOption[] {
  return lines.map((l) => ({
    value: l.id,
    label: l.name,
    ...(l.parentId && { parent: l.parentId }),
    ...(l.disabled && { disabled: true }),
  }));
}

/** 检查业务线树：名称不为空、同级不重名、上级存在、不成环。返回错误原因，没问题时返回 null。 */
export function checkBusinessLines(lines: readonly BusinessLine[]): string | null {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const siblings = new Set<string>();
  for (const l of lines) {
    if (!l.name.trim()) return "业务线名称不能为空。";
    const key = `${l.parentId ?? ""}\n${l.name.trim()}`;
    if (siblings.has(key)) return `业务线「${l.name}」重名了。`;
    siblings.add(key);
    if (l.parentId && !byId.has(l.parentId)) return `业务线「${l.name}」的上级不存在。`;
    const seen = new Set([l.id]);
    for (let p = l.parentId ? byId.get(l.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
      if (seen.has(p.id)) return `业务线「${l.name}」的上下级成环了。`;
      seen.add(p.id);
    }
  }
  return null;
}
