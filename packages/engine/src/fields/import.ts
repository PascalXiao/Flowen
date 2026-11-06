import { defaultRoleMembers, type RuleRole, roleAppears } from "../roles/role-rules.ts";
import {
  applyDefaults,
  conditionView,
  fieldStates,
  missingRequired,
  type RuleField,
  TEMPLATE_CONDITION_KEY,
} from "./field-rules.ts";
import { normalizeFieldValue, PASTEABLE_FIELD_TYPES, parseFieldText } from "./field-value.ts";

/** 表格的一列导入到哪里：名称、流程类型、某个字段、某个角色，或者不导入。 */
export type ImportTarget =
  | { kind: "name" }
  | { kind: "flow" }
  | { kind: "field"; key: string }
  | { kind: "role"; key: string }
  | null;

export interface ImportContext {
  /** 名称列表头的另一个叫法（如「项目名称」）。 */
  typeName: string;
  fields: readonly RuleField[];
  roles: readonly RuleRole[];
  /** 已发布的流程（流程类型）；第一套是默认的。 */
  flows: readonly { id: string; name: string }[];
  members: readonly { userId: string; name: string }[];
  /** 导入的人：「创建者」分配方式的角色默认是他。 */
  me: string;
}

export interface ImportRow {
  /** Excel 里的行号（表头是第 1 行）。 */
  line: number;
  name: string;
  flowTemplateId?: string;
  fields: Record<string, unknown>;
  roles: Record<string, string[]>;
  /** 表格里填了人、但按出现规则本来不出现的角色：当作手动加上的角色。 */
  addedRoles: string[];
  errors: string[];
}

/** 能从表格导入的字段：和新建表单一样，公式、关联、系统外信号、投票、附件这类不在里面。 */
export function importableFields<F extends RuleField>(fields: readonly F[]): F[] {
  return fields.filter((f) => PASTEABLE_FIELD_TYPES.includes(f.dataType));
}

/** 导入模板的表头：名称、流程类型（有多套流程时）、能导入的字段、角色。 */
export function importHeaders(ctx: ImportContext): string[] {
  return [
    "名称",
    ...(ctx.flows.length > 1 ? ["流程类型"] : []),
    ...importableFields(ctx.fields).map((f) => f.name),
    ...ctx.roles.map((r) => r.name),
  ];
}

/** 按表头自动对应：名称、流程类型、字段名、角色名（字段优先）；对不上的不导入。 */
export function guessTargets(headers: readonly string[], ctx: ImportContext): ImportTarget[] {
  const used = new Set<string>();
  const fields = importableFields(ctx.fields);
  return headers.map((raw) => {
    const h = raw.trim();
    let target: ImportTarget = null;
    if (h === "名称" || h === `${ctx.typeName}名称`) target = { kind: "name" };
    else if (h === "流程类型" && ctx.flows.length > 0) target = { kind: "flow" };
    else {
      const field = fields.find((f) => f.name === h || f.key === h);
      const role = ctx.roles.find((r) => r.name === h || r.key === h);
      if (field) target = { kind: "field", key: field.key };
      else if (role) target = { kind: "role", key: role.key };
    }
    const id =
      target && (target.kind === "field" || target.kind === "role" ? `${target.kind}:${target.key}` : target.kind);
    if (!id || used.has(id)) return null;
    used.add(id);
    return target;
  });
}

const blank = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * 把表格的数据行变成要新建的工作项：按列的对应关系解析字段（和粘贴单元格一样按显示名找选项、人员），
 * 没填的字段按默认值规则补上，角色先按分配方式算默认成员、表格里填了的以表格为准，
 * 必填没填、选项或人员对不上的记到 errors 里。整行空白的跳过。
 */
export function planImport(
  rows: readonly (readonly string[])[],
  targets: readonly ImportTarget[],
  ctx: ImportContext,
): ImportRow[] {
  const findUser = (name: string) => ctx.members.find((m) => m.name === name || m.userId === name)?.userId;
  const out: ImportRow[] = [];
  rows.forEach((cells, index) => {
    if (cells.every((c) => c.trim() === "")) return;
    const row: ImportRow = { line: index + 2, name: "", fields: {}, roles: {}, addedRoles: [], errors: [] };
    const filled: Record<string, unknown> = {};
    const roleCells: Record<string, string[]> = {};
    targets.forEach((target, col) => {
      const text = (cells[col] ?? "").trim();
      if (!target) return;
      if (target.kind === "name") row.name = text;
      else if (target.kind === "flow") {
        if (!text) return;
        const flow = ctx.flows.find((f) => f.name === text);
        if (flow) row.flowTemplateId = flow.id;
        else row.errors.push(`没有流程类型「${text}」。`);
      } else if (target.kind === "field") {
        const field = ctx.fields.find((f) => f.key === target.key);
        if (!field || !text) return;
        const parsed = parseFieldText(field, text, findUser);
        if ("error" in parsed) {
          row.errors.push(parsed.error);
          return;
        }
        try {
          const value = normalizeFieldValue(field, parsed.value);
          if (!blank(value)) filled[field.key] = value;
        } catch (e) {
          row.errors.push(e instanceof Error ? e.message : String(e));
        }
      } else {
        const role = ctx.roles.find((r) => r.key === target.key);
        if (!role || !text) return;
        const ids: string[] = [];
        for (const name of text
          .split(/[、,，;；\n]/)
          .map((s) => s.trim())
          .filter(Boolean)) {
          const id = findUser(name);
          if (id) ids.push(id);
          else row.errors.push(`「${role.name}」里的「${name}」不是空间成员。`);
        }
        roleCells[role.key] = [...new Set(ids)];
      }
    });
    if (!row.name) row.errors.unshift("名称没填。");

    const flowName = ctx.flows.find((f) => f.id === (row.flowTemplateId ?? ctx.flows[0]?.id))?.name ?? "";
    const flowCondition = { [TEMPLATE_CONDITION_KEY]: flowName };
    const { [TEMPLATE_CONDITION_KEY]: _flow, ...values } = applyDefaults(ctx.fields, { ...filled, ...flowCondition });
    const all = { ...values, ...flowCondition };
    const states = fieldStates(ctx.fields, all);
    const missing = missingRequired(
      ctx.fields.filter((f) => f.dataType !== "attachment"),
      all,
    );
    if (missing.length > 0) row.errors.push(`必填没填：${missing.map((f) => f.name).join("、")}。`);
    // 只带有效且显示的字段，被规则藏起来的不带
    row.fields = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => states[k]?.visible !== false && !blank(v)),
    );

    const view = conditionView(ctx.fields, all);
    for (const role of ctx.roles) {
      const given = roleCells[role.key];
      if (given?.length) {
        row.roles[role.key] = given;
        if (!roleAppears(role, view)) row.addedRoles.push(role.key);
      } else if (roleAppears(role, view)) row.roles[role.key] = defaultRoleMembers(role, view, ctx.me);
    }
    out.push(row);
  });
  return out;
}
