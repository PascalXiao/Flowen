import { type Executor, schema, type Tx } from "@fp/db";
import { AUDIT_ACTIONS, AUDIT_RETENTION_DAYS, type ZeroContext } from "@fp/sync";
import { eq, lt, sql } from "drizzle-orm";

/*
 * 审计日志的写入。浏览器发来的写操作（mutator）在服务端执行时，AUDIT_ACTIONS 里列着的都记一条，
 * 和业务写入在同一个事务里；接口动作（复制空间、存为模板、登录……）由接口自己调 writeAudit。
 * 自动化代替人执行的动作（ctx.causedBy 有值）不记：它们记在工作项的操作记录和规则的执行记录里。
 */

export interface AuditInput {
  actor: string | null;
  action: string;
  spaceId?: string | null;
  targetId?: string | null;
  targetName?: string | null;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

/** 写一条审计日志。分类按 AUDIT_ACTIONS 取。偶尔顺手清掉保留期以外的旧日志。 */
export async function writeAudit(db: Executor, input: AuditInput) {
  const category = AUDIT_ACTIONS[input.action]?.[0] ?? "other";
  await db.insert(schema.auditLog).values({
    actor: input.actor,
    action: input.action,
    category,
    spaceId: input.spaceId ?? null,
    targetId: input.targetId ?? null,
    targetName: input.targetName ?? null,
    detail: input.detail ?? null,
    ip: input.ip ?? null,
  });
  if (Math.random() < 0.01)
    await db
      .delete(schema.auditLog)
      .where(lt(schema.auditLog.at, sql`now() - make_interval(days => ${AUDIT_RETENTION_DAYS})`));
}

/** 不进日志的参数：密钥、令牌、请求头。 */
const SECRET_KEY = /secret|token|password|headers/i;
/** 参数太大（流程图、页面布局）时只留键名。 */
const MAX_DETAIL = 4000;

export function auditDetail(args: unknown): Record<string, unknown> | null {
  if (!args || typeof args !== "object") return null;
  const clean = JSON.parse(
    JSON.stringify(args, (key, value) => (key && SECRET_KEY.test(key) ? "••••" : value)),
  ) as Record<string, unknown>;
  const text = JSON.stringify(clean);
  if (text.length <= MAX_DETAIL) return clean;
  return {
    truncated: true,
    keys: Object.keys(clean),
    ...Object.fromEntries(
      Object.entries(clean).filter(([, v]) => typeof v !== "object" || v === null || JSON.stringify(v).length < 200),
    ),
  };
}

interface Target {
  spaceId: string | null;
  targetId: string | null;
  targetName: string | null;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

async function typeTarget(db: Tx, typeId: string | undefined, name?: string): Promise<Target | null> {
  if (!typeId) return null;
  const [type] = await db
    .select({ spaceId: schema.workItemType.spaceId, name: schema.workItemType.name })
    .from(schema.workItemType)
    .where(eq(schema.workItemType.id, typeId));
  return type ? { spaceId: type.spaceId, targetId: typeId, targetName: name ?? type.name } : null;
}

/** 按 mutator 名和参数找到操作对象：所在空间、对象 id 和名称。找不到时返回 null。 */
export async function auditTarget(db: Tx, name: string, args: Record<string, unknown>): Promise<Target | null> {
  const [ns, op] = name.split(".");
  const id = str(args.id);
  const argName = str(args.name);
  const bySpaceTable = async (
    table:
      | typeof schema.relationDef
      | typeof schema.linkRule
      | typeof schema.hierarchy
      | typeof schema.savedView
      | typeof schema.metricChart
      | typeof schema.automationRule
      | typeof schema.webhook
      | typeof schema.userGroup,
  ): Promise<Target | null> => {
    if (!id) return null;
    const [row] = await db.select({ spaceId: table.spaceId, name: table.name }).from(table).where(eq(table.id, id));
    if (row) return { spaceId: row.spaceId, targetId: id, targetName: argName ?? row.name };
    const spaceId = str(args.spaceId);
    return spaceId ? { spaceId, targetId: id, targetName: argName ?? null } : null;
  };
  switch (ns) {
    case "space": {
      const spaceId = str(args.spaceId) ?? id;
      if (!spaceId) return null;
      const [space] = await db
        .select({ name: schema.space.name })
        .from(schema.space)
        .where(eq(schema.space.id, spaceId));
      const userId = str(args.userId);
      if (userId && (op === "setMemberRole" || op === "removeMember")) {
        const [user] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId));
        return { spaceId, targetId: userId, targetName: user?.name ?? null };
      }
      return { spaceId, targetId: spaceId, targetName: argName ?? space?.name ?? null };
    }
    case "workItemType":
      return typeTarget(db, id ?? str(args.typeId), argName);
    case "fieldDef": {
      if (op === "create") return typeTarget(db, str(args.typeId), argName);
      if (!id) return null;
      const [field] = await db
        .select({ typeId: schema.fieldDef.typeId, name: schema.fieldDef.name })
        .from(schema.fieldDef)
        .where(eq(schema.fieldDef.id, id));
      const t = await typeTarget(db, field?.typeId);
      return t && { ...t, targetId: id, targetName: argName ?? `${t.targetName} / ${field?.name}` };
    }
    case "roleDef": {
      if (op === "create" || op === "reorder") return typeTarget(db, str(args.typeId), argName);
      if (!id) return null;
      const [role] = await db
        .select({ typeId: schema.roleDef.typeId, name: schema.roleDef.name })
        .from(schema.roleDef)
        .where(eq(schema.roleDef.id, id));
      const t = await typeTarget(db, role?.typeId);
      return t && { ...t, targetId: id, targetName: `${t.targetName} / ${argName ?? role?.name}` };
    }
    case "flowTemplate": {
      if (op === "create") return typeTarget(db, str(args.typeId), argName);
      let templateId = str(args.templateId);
      const versionId = str(args.versionId);
      if (!templateId && versionId) {
        const [version] = await db
          .select({ templateId: schema.flowVersion.templateId })
          .from(schema.flowVersion)
          .where(eq(schema.flowVersion.id, versionId));
        templateId = version?.templateId;
      }
      if (!templateId) return null;
      const [template] = await db
        .select({ typeId: schema.flowTemplate.typeId, name: schema.flowTemplate.name })
        .from(schema.flowTemplate)
        .where(eq(schema.flowTemplate.id, templateId));
      const t = await typeTarget(db, template?.typeId);
      return t && { ...t, targetId: templateId, targetName: `${t.targetName} / ${template?.name}` };
    }
    case "relationDef":
      if (op === "create") {
        const t = await typeTarget(db, str(args.fromTypeId));
        return t && { ...t, targetId: id ?? null, targetName: argName ?? null };
      }
      return bySpaceTable(schema.relationDef);
    case "linkRule":
      return bySpaceTable(schema.linkRule);
    case "hierarchy":
      return bySpaceTable(schema.hierarchy);
    case "view":
      return bySpaceTable(schema.savedView);
    case "chart":
      return bySpaceTable(schema.metricChart);
    case "automation":
      return bySpaceTable(schema.automationRule);
    case "webhook":
      return bySpaceTable(schema.webhook);
    case "userGroup":
      return bySpaceTable(schema.userGroup);
    case "workItem": {
      const workItemId = str(args.workItemId);
      if (!workItemId) return null;
      const [item] = await db
        .select({ spaceId: schema.workItem.spaceId, name: schema.workItem.name })
        .from(schema.workItem)
        .where(eq(schema.workItem.id, workItemId));
      return item ? { spaceId: item.spaceId, targetId: workItemId, targetName: item.name } : null;
    }
    case "team": {
      if (!id) return null;
      const [team] = await db.select({ name: schema.team.name }).from(schema.team).where(eq(schema.team.id, id));
      return { spaceId: null, targetId: id, targetName: argName ?? team?.name ?? null };
    }
    case "spaceTemplate": {
      if (!id) return null;
      const [template] = await db
        .select({ name: schema.spaceTemplate.name, spaceId: schema.spaceTemplate.sourceSpaceId })
        .from(schema.spaceTemplate)
        .where(eq(schema.spaceTemplate.id, id));
      return { spaceId: null, targetId: id, targetName: argName ?? template?.name ?? null };
    }
    case "org": {
      const userId = str(args.userId);
      if (!userId) return null;
      const [user] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId));
      return { spaceId: null, targetId: userId, targetName: user?.name ?? null };
    }
  }
  return null;
}

/**
 * 包一层 mutator 的执行：要审计的操作先找好对象（删除之后就找不到了），执行成功后在同一个事务里记日志。
 */
export async function withAudit<T>(
  db: Tx,
  name: string,
  args: unknown,
  ctx: ZeroContext,
  run: () => Promise<T>,
): Promise<T> {
  if (!AUDIT_ACTIONS[name] || ctx.causedBy) return run();
  const record = (args ?? {}) as Record<string, unknown>;
  const before = await auditTarget(db, name, record);
  const result = await run();
  const target = before?.targetName ? before : ((await auditTarget(db, name, record)) ?? before);
  await writeAudit(db, {
    actor: ctx.userID,
    action: name,
    spaceId: target?.spaceId ?? null,
    targetId: target?.targetId ?? null,
    targetName: target?.targetName ?? null,
    detail: auditDetail(args),
  });
  return result;
}
