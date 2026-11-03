import {
  CASCADE_FIELD_TYPES,
  type Condition,
  checkFieldConfig,
  checkLayout,
  checkOptions,
  compileFormula,
  conditionFields,
  type DetailLayout,
  EDITABLE_FIELD_TYPES,
  FIELD_GROUP_COLUMN_TYPES,
  type FieldDataType,
  type FlowDefinition,
  FormulaError,
  isStatusFlow,
  OPTION_FIELD_TYPES,
  type RoleConfig,
  roleConditions,
  type StatusFlowDefinition,
  validateFlow,
  validateStatusFlow,
} from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { z } from "zod";
import { assertSpaceMembers, requireAdmin, syncFieldAccess } from "./access.ts";
import { compileTypeFormulas, fieldResolver, recomputeFormulas, recomputeParentFormulas } from "./formulas.ts";
import { zql } from "./schema.gen.ts";

/*
 * 空间配置：工作项类型、角色、字段、流程模板。都只有空间管理员能改。
 * 模板的版本发布后不可修改；在已发布的版本上编辑会自动开一个新的草稿版本。
 * 已经创建的工作项固定在创建时的版本上，不受新版本影响。
 */

const key = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[^\s/]+$/, "键不能包含空格和斜杠。");

export const createTypeArgs = z.object({
  id: z.string(),
  spaceId: z.string(),
  key,
  name: z.string().min(1),
  /** node：节点流（需求、项目）；state：状态流（缺陷、任务）。 */
  flowMode: z.enum(["node", "state"]).default("node"),
});
export const createRoleArgs = z.object({ id: z.string(), typeId: z.string(), key, name: z.string().min(1) });
const fieldOptions = z
  .array(
    z.object({
      value: z.string().min(1),
      label: z.string().trim().min(1),
      color: z.string().max(32).optional(),
      /** 级联字段的上级选项值。 */
      parent: z.string().optional(),
      disabled: z.boolean().optional(),
    }),
  )
  .max(2000);
export const createFieldArgs = z.object({
  id: z.string(),
  typeId: z.string(),
  key,
  name: z.string().min(1),
  dataType: z.enum([...EDITABLE_FIELD_TYPES, "formula"]),
  options: fieldOptions.optional(),
  /** 公式字段的公式，字段可以写成 {字段名}。 */
  formula: z.string().max(2000).optional(),
});
export const setFormulaArgs = z.object({ id: z.string(), formula: z.string().min(1).max(2000) });
/** 字段的可见和可改角色；空数组表示不限制。 */
export const setFieldAccessArgs = z.object({
  id: z.string(),
  viewRoles: z.array(z.string()),
  editRoles: z.array(z.string()),
});
/** 详情页布局；`layout` 为空表示恢复默认。见 engine 的 DetailLayout。 */
export const setLayoutArgs = z.object({
  id: z.string(),
  layout: z.json().nullable(),
});
/** 列表的默认显示（列和顺序、排序、分组）；`display` 为空表示恢复默认。 */
export const setDefaultDisplayArgs = z.object({
  id: z.string(),
  display: z
    .object({
      columns: z
        .array(z.object({ key: z.string(), width: z.number().optional() }))
        .max(60)
        .optional(),
      sort: z
        .array(z.object({ key: z.string(), desc: z.boolean().optional() }))
        .max(5)
        .optional(),
      groupBy: z.string().nullable().optional(),
      frozen: z.number().int().min(0).max(10).optional(),
      rowHeight: z.enum(["low", "medium", "high", "xhigh"]).optional(),
      summary: z
        .record(z.string(), z.enum(["count", "filled", "empty", "filledPct", "sum", "avg", "max", "min"]))
        .optional(),
    })
    .nullable(),
});
export const createTemplateArgs = z.object({ id: z.string(), typeId: z.string(), key, name: z.string().min(1) });

export const condition: z.ZodType<Condition, Condition> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("equal"), field: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }),
    z.object({ kind: z.literal("notEqual"), field: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }),
    z.object({ kind: z.literal("notEmpty"), field: z.string() }),
    z.object({
      kind: z.literal("compare"),
      field: z.string(),
      op: z.enum(["gt", "gte", "lt", "lte"]),
      value: z.union([z.number(), z.string()]),
    }),
    z.object({ kind: z.literal("all"), items: z.array(condition) }),
    z.object({ kind: z.literal("any"), items: z.array(condition) }),
  ]),
);

/** 字段配置（见 engine 的 FieldConfig）。 */
export const fieldConfigSchema = z.object({
  description: z.string().max(2000).nullish(),
  alias: z.string().max(64).nullish(),
  validWhen: condition.nullish(),
  showWhen: condition.nullish(),
  requiredWhen: condition.nullish(),
  defaultValue: z
    .union([
      z.object({ mode: z.literal("fixed"), value: z.json() }),
      z.object({
        mode: z.literal("conditional"),
        rules: z.array(z.object({ when: condition, value: z.json() })).max(100),
        combine: z.enum(["first", "union"]).optional(),
      }),
    ])
    .nullish(),
  unique: z.boolean().nullish(),
  number: z
    .object({
      precision: z.number().int().min(0).max(10).optional(),
      thousands: z.boolean().optional(),
      scale: z.enum(["raw", "percent", "permille", "thousand", "tenThousand", "million"]).optional(),
      symbol: z.string().max(8).optional(),
      symbolPosition: z.enum(["before", "after"]).optional(),
    })
    .nullish(),
  leafOnly: z.boolean().nullish(),
  optionWhen: z.record(z.string(), condition).nullish(),
  exclusiveOptions: z.array(z.string()).nullish(),
  freezeOnComplete: z.boolean().nullish(),
  columns: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        name: z.string().trim().min(1).max(60),
        dataType: z.enum(FIELD_GROUP_COLUMN_TYPES),
        options: fieldOptions.nullish(),
      }),
    )
    .max(30)
    .nullish(),
});

/** 类型设置：复制时排除的字段和角色。 */
export const setTypeSettingsArgs = z.object({
  id: z.string(),
  settings: z
    .object({
      copyExcludeFields: z.array(z.string().min(1)).max(500).optional(),
      copyExcludeRoles: z.array(z.string().min(1)).max(200).optional(),
    })
    .nullable(),
});

export async function setTypeSettings(tx: Transaction, args: z.output<typeof setTypeSettingsArgs>, userID: string) {
  await adminType(tx, args.id, userID);
  await tx.mutate.workItemType.update({ id: args.id, settings: args.settings });
}

/** 改字段：名称、选项、必填和配置。字段类型和键建好后不能改。 */
export const updateFieldArgs = z.object({
  id: z.string(),
  name: z.string().trim().min(1).optional(),
  options: fieldOptions.optional(),
  required: z.boolean().optional(),
  config: fieldConfigSchema.nullable().optional(),
});

const layoutItem = z.union([
  z.object({
    kind: z.literal("field"),
    field: z.string(),
    label: z.string().max(60).optional(),
    hint: z.string().max(500).optional(),
    showWhen: condition.optional(),
    createHidden: z.boolean().optional(),
    wide: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("text"), text: z.string().max(1000), tone: z.enum(["info", "warning"]).optional() }),
  z.object({ kind: z.literal("relation"), relationDefId: z.string(), title: z.string().max(60).optional() }),
  z.object({
    kind: z.literal("nodeTable"),
    nodes: z.array(z.string().min(1)).min(1).max(60),
    template: z.string().max(100).optional(),
    title: z.string().max(60).optional(),
  }),
  z.object({
    kind: z.literal("relationTable"),
    relationDefId: z.string(),
    columns: z.array(z.string().min(1).max(200)).min(1).max(40),
    title: z.string().max(60).optional(),
  }),
  z.object({
    kind: z.literal("nodeInfo"),
    node: z.string().min(1),
    info: z.array(z.enum(["owner", "schedule", "conclusion"])).optional(),
    label: z.string().max(60).optional(),
  }),
  z.object({
    kind: z.literal("relatedField"),
    relationDefId: z.string(),
    field: z.string().min(1).max(200),
    label: z.string().max(60).optional(),
  }),
  z.object({ kind: z.enum(["relations", "roles", "subItems", "attachments"]) }),
]);
/** 详情页布局的结构（早期的分组布局和页签布局都认）。 */
const detailLayoutSchema = z.object({
  groups: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        fields: z.array(z.string()),
        collapsed: z.boolean().optional(),
      }),
    )
    .max(30)
    .optional(),
  hidden: z.array(z.string()).optional(),
  tabs: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        name: z.string().trim().min(1).max(40),
        system: z.enum(["nodes", "comments", "activity"]).optional(),
        showWhen: condition.optional(),
        sections: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(40),
              items: z.array(layoutItem).max(500),
              collapsed: z.boolean().optional(),
              columns: z.union([z.literal(1), z.literal(2)]).optional(),
            }),
          )
          .max(50)
          .optional(),
      }),
    )
    .max(30)
    .optional(),
  create: z
    .union([
      z.object({ mode: z.literal("sync") }),
      z.object({ mode: z.literal("custom"), items: z.array(layoutItem).max(500) }),
    ])
    .optional(),
  labelPosition: z.enum(["side", "top"]).optional(),
});

const fieldValueInput = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]);
const nodeEventAction = z.union([
  z.object({ kind: z.literal("setStage"), stage: z.string().trim().min(1), onlyFrom: z.array(z.string()).optional() }),
  z.object({ kind: z.literal("setField"), field: z.string(), value: fieldValueInput }),
]);

export const flowDefinitionSchema = z.object({
  key: z.string(),
  version: z.number().int(),
  nodes: z.array(
    z.object({
      key,
      name: z.string().min(1),
      completion: z.enum(["singleConfirm", "allConfirm", "auto", "subItemDriven"]),
      ownerRoles: z.array(z.string()),
      operatorRoles: z.array(z.string()).optional(),
      visibility: condition.optional(),
      gate: condition.optional(),
      stageOnArrival: z.string().min(1).optional(),
      form: z.array(z.object({ field: z.string(), required: z.boolean().optional() })).optional(),
      tasks: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
      relatedInfo: z
        .array(z.object({ relation: z.string().min(1).max(100), field: z.string().min(1).max(200) }))
        .max(30)
        .optional(),
      subItems: z
        .object({ type: z.string().min(1), relation: z.string().min(1), scheduleLinked: z.boolean().optional() })
        .optional(),
      effort: z
        .object({
          points: z.boolean().optional(),
          hours: z.enum(["show", "required"]).optional(),
          scheduleRequired: z.boolean().optional(),
          ownersRequired: z.boolean().optional(),
        })
        .optional(),
      nodeInfo: z
        .array(
          z.object({ node: z.string().min(1), info: z.array(z.enum(["owner", "schedule", "conclusion"])).optional() }),
        )
        .max(50)
        .optional(),
      duration: z.number().int().min(0).max(999).optional(),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      milestone: z.boolean().optional(),
      restricted: z.boolean().optional(),
      conclusion: z
        .object({
          options: z
            .array(z.object({ value: z.string().min(1), label: z.string().min(1), passed: z.boolean().optional() }))
            .min(1)
            .max(20),
          perOwner: z.boolean().optional(),
          aggregate: z.enum(["majority", "veto"]).optional(),
          required: z.boolean().optional(),
          commentRequired: z.boolean().optional(),
        })
        .optional(),
      buttons: z
        .array(
          z.object({
            key: z.string().min(1),
            label: z.string().trim().min(1).max(20),
            style: z.enum(["primary", "default", "warning"]).optional(),
            action: z.enum(["complete", "assign"]),
            conclusion: z.string().optional(),
            assignments: z
              .array(z.object({ field: z.string(), value: fieldValueInput }))
              .max(20)
              .optional(),
            roles: z.array(z.string()).optional(),
          }),
        )
        .max(10)
        .optional(),
      fields: z
        .array(
          z.object({
            key: z.string().min(1),
            name: z.string().trim().min(1).max(40),
            dataType: z.enum(["text", "number", "date", "select", "multiSelect"]),
            options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1) })).optional(),
            required: z.boolean().optional(),
          }),
        )
        .max(50)
        .optional(),
      onArrive: z.array(nodeEventAction).max(20).optional(),
      onComplete: z.array(nodeEventAction).max(20).optional(),
      schedule: z.object({ field: z.string(), offset: z.number().int().min(-999).max(999) }).optional(),
    }),
  ),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
  stageRules: z
    .array(z.object({ when: condition, stage: z.string().trim().min(1) }))
    .max(50)
    .optional(),
});

export const statusFlowDefinitionSchema = z.object({
  key: z.string(),
  version: z.number().int(),
  mode: z.literal("state"),
  statuses: z.array(
    z.object({ key, name: z.string().trim().min(1), category: z.enum(["todo", "doing", "done", "closed"]) }),
  ),
  transitions: z.array(
    z.object({ from: z.string(), to: z.string(), roles: z.array(z.string()).optional(), gate: condition.optional() }),
  ),
});

export const saveDraftArgs = z.object({
  templateId: z.string(),
  definition: z.union([statusFlowDefinitionSchema, flowDefinitionSchema]),
});
export const publishArgs = z.object({ versionId: z.string() });

/** 版本 id 由模板和版本号决定，浏览器乐观执行和服务端写的是同一行。 */
export function flowVersionId(templateId: string, version: number): string {
  return `${templateId}/v${version}`;
}

export async function assertAdmin(tx: Transaction, spaceId: string, userID: string) {
  await requireAdmin(tx, spaceId, userID, "只有空间管理员可以修改配置。");
}

/** 类型存在且当前用户是它所在空间的管理员。 */
async function adminType(tx: Transaction, typeId: string, userID: string) {
  const type = await tx.run(zql.workItemType.where("id", typeId).related("roles").related("fields").one());
  if (!type) throw new Error("工作项类型不存在。");
  await assertAdmin(tx, type.spaceId, userID);
  return type;
}

async function adminTemplate(tx: Transaction, templateId: string, userID: string) {
  const template = await tx.run(
    zql.flowTemplate
      .where("id", templateId)
      .related("versions", (v) => v.orderBy("version", "desc").limit(1))
      .one(),
  );
  if (!template) throw new Error("流程模板不存在。");
  const type = await adminType(tx, template.typeId, userID);
  return { template, type, latest: template.versions[0] };
}

export async function createType(tx: Transaction, args: z.output<typeof createTypeArgs>, userID: string) {
  await assertAdmin(tx, args.spaceId, userID);
  const existing = await tx.run(zql.workItemType.where("spaceId", args.spaceId));
  await tx.mutate.workItemType.insert({ ...args, sort: existing.length, createdAt: Date.now() });
}

export async function setLayout(tx: Transaction, args: z.output<typeof setLayoutArgs>, userID: string) {
  const type = await adminType(tx, args.id, userID);
  const parsed = args.layout === null ? null : detailLayoutSchema.safeParse(args.layout);
  if (parsed && !parsed.success) throw new Error("布局格式不对。");
  const layout = parsed ? (parsed.data as DetailLayout) : null;
  if (layout) {
    const relations = [
      ...(await tx.run(zql.relationDef.where("fromTypeId", args.id))),
      ...(await tx.run(zql.relationDef.where("toTypeId", args.id))).filter((r) => r.reverseName),
    ];
    const error = checkLayout(
      layout,
      type.fields.map((f) => f.key),
      relations.map((r) => r.id),
    );
    if (error) throw new Error(error);
  }
  await tx.mutate.workItemType.update({ id: args.id, detailLayout: layout });
}

export async function setDefaultDisplay(tx: Transaction, args: z.output<typeof setDefaultDisplayArgs>, userID: string) {
  await adminType(tx, args.id, userID);
  await tx.mutate.workItemType.update({ id: args.id, defaultDisplay: args.display });
}

export async function createRole(tx: Transaction, args: z.output<typeof createRoleArgs>, userID: string) {
  const type = await adminType(tx, args.typeId, userID);
  if (type.roles.some((r) => r.key === args.key || r.name === args.name))
    throw new Error(`已经有角色「${args.name}」了。`);
  await tx.mutate.roleDef.insert({
    ...args,
    inheritFrom: null,
    config: null,
    sort: type.roles.length,
    createdAt: Date.now(),
  });
}

/** 角色配置（见 engine 的 RoleConfig）。 */
export const roleConfigSchema = z.object({
  appear: z
    .union([
      z.object({ mode: z.literal("default"), allowRemove: z.boolean().optional() }),
      z.object({ mode: z.literal("hidden") }),
      z.object({ mode: z.literal("conditional"), when: condition, allowRemove: z.boolean().optional() }),
    ])
    .nullish(),
  assign: z
    .union([
      z.object({ mode: z.literal("creator") }),
      z.object({ mode: z.literal("manual") }),
      z.object({ mode: z.literal("fixed"), members: z.array(z.string()).max(100) }),
      z.object({
        mode: z.literal("conditional"),
        rules: z.array(z.object({ when: condition, members: z.array(z.string()).max(100) })).max(200),
        combine: z.enum(["first", "union"]).optional(),
        fallback: z.array(z.string()).max(100).optional(),
      }),
    ])
    .nullish(),
  single: z.boolean().nullish(),
  isOwner: z.boolean().nullish(),
  editors: z
    .union([
      z.object({ mode: z.enum(["anyone", "admin", "creator"]) }),
      z.object({ mode: z.literal("roles"), roles: z.array(z.string()) }),
    ])
    .nullish(),
  description: z.string().max(2000).nullish(),
});
export const updateRoleArgs = z.object({
  id: z.string(),
  name: z.string().trim().min(1).optional(),
  config: roleConfigSchema.nullable().optional(),
});
/** 角色排序：按给出的角色键顺序。 */
export const reorderRolesArgs = z.object({ typeId: z.string(), keys: z.array(z.string()) });

/**
 * 改角色的名称和配置：出现方式、成员分配、单人、负责人、谁能改成员。
 * 条件只能引用这个类型的字段；默认成员和指定成员要是空间成员。改了只影响之后新建的工作项。
 */
export async function updateRole(tx: Transaction, args: z.output<typeof updateRoleArgs>, userID: string) {
  const role = await tx.run(zql.roleDef.where("id", args.id).one());
  if (!role) throw new Error("角色不存在。");
  const type = await adminType(tx, role.typeId, userID);
  const name = args.name ?? role.name;
  if (type.roles.some((r) => r.id !== role.id && r.name === name)) throw new Error(`已经有角色「${name}」了。`);
  const config = args.config;
  if (config) {
    const fields = new Set(type.fields.map((f) => f.key));
    for (const c of roleConditions(config as RoleConfig))
      for (const key of conditionFields(c))
        if (!fields.has(key)) throw new Error(`「${name}」的条件用到的字段「${key}」不存在。`);
    const people =
      config.assign?.mode === "fixed"
        ? config.assign.members
        : config.assign?.mode === "conditional"
          ? [...config.assign.rules.flatMap((r) => r.members), ...(config.assign.fallback ?? [])]
          : [];
    await assertSpaceMembers(tx, type.spaceId, people, "角色的默认成员要是空间成员。");
    if (config.editors?.mode === "roles") {
      const keys = new Set(type.roles.map((r) => r.key));
      const unknown = config.editors.roles.find((k) => !keys.has(k));
      if (unknown) throw new Error(`角色「${unknown}」不存在。`);
    }
  }
  await tx.mutate.roleDef.update({
    id: role.id,
    name,
    ...(config !== undefined && { config: config as RoleConfig | null }),
  });
}

export async function reorderRoles(tx: Transaction, args: z.output<typeof reorderRolesArgs>, userID: string) {
  const type = await adminType(tx, args.typeId, userID);
  const order = new Map(args.keys.map((k, i) => [k, i]));
  const sorted = [...type.roles].sort(
    (a, b) => (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.key) ?? Number.MAX_SAFE_INTEGER),
  );
  for (const [sort, r] of sorted.entries()) if (r.sort !== sort) await tx.mutate.roleDef.update({ id: r.id, sort });
}

/** 设置字段按工作项角色的可见、可改范围。只有空间管理员可以。 */
export async function setFieldAccess(tx: Transaction, args: z.output<typeof setFieldAccessArgs>, userID: string) {
  const field = await tx.run(zql.fieldDef.where("id", args.id).one());
  if (!field) throw new Error("字段不存在。");
  const type = await adminType(tx, field.typeId, userID);
  const roles = new Set(type.roles.map((r) => r.key));
  for (const role of [...args.viewRoles, ...args.editRoles])
    if (!roles.has(role)) throw new Error(`角色「${role}」不存在。`);
  await tx.mutate.fieldDef.update({
    id: args.id,
    viewRoles: args.viewRoles.length > 0 ? [...new Set(args.viewRoles)] : null,
    editRoles: args.editRoles.length > 0 ? [...new Set(args.editRoles)] : null,
  });
  for (const item of await tx.run(zql.workItem.where("typeId", field.typeId))) await syncFieldAccess(tx, item.id);
}

export async function createField(tx: Transaction, args: z.output<typeof createFieldArgs>, userID: string) {
  const type = await adminType(tx, args.typeId, userID);
  const isOptions = OPTION_FIELD_TYPES.includes(args.dataType);
  if (isOptions && !args.options?.length) throw new Error("选项字段至少要有一个选项。");
  const optionError = isOptions ? checkOptions(args.dataType, args.options ?? []) : null;
  if (optionError) throw new Error(optionError);
  if (type.fields.some((f) => f.key === args.key || f.name === args.name))
    throw new Error(`已经有字段「${args.name}」了。`);
  const formula =
    args.dataType === "formula"
      ? checkFormula([...type.fields, { ...args, formula: null }], args.key, args.formula)
      : null;
  await tx.mutate.fieldDef.insert({
    ...args,
    options: isOptions ? (args.options ?? []) : null,
    formula,
    required: false,
    // 字段组先带一列，列在字段配置里改
    config: args.dataType === "fieldGroup" ? { columns: [{ key: "列1", name: "列1", dataType: "text" }] } : null,
    viewRoles: null,
    editRoles: null,
    sort: type.fields.length,
    createdAt: Date.now(),
  });
  if (formula) await recomputeType(tx, args.typeId);
}

/**
 * 检查公式：能解析、引用的字段都在、不和别的公式循环引用。返回规范化后的公式（字段换成字段键）。
 */
function checkFormula(
  fields: readonly { key: string; name: string; dataType: string; formula: string | null }[],
  key: string,
  source: string | undefined,
): string {
  if (!source?.trim()) throw new Error("公式字段要填公式。");
  const resolve = fieldResolver(fields);
  try {
    const compiled = compileFormula(source, resolve);
    if (compiled.refs.includes(key)) throw new FormulaError("公式不能引用自己。");
    compileTypeFormulas(
      fields.map((f) => ({
        ...f,
        dataType: f.key === key ? "formula" : (f.dataType as FieldDataType),
        formula: f.key === key ? compiled.source : f.formula,
      })),
    );
    return compiled.source;
  } catch (error) {
    if (error instanceof FormulaError) throw new Error(`公式有误：${error.message}`);
    throw error;
  }
}

/** 公式改了以后，类型下所有工作项重算（在服务端）。 */
async function recomputeType(tx: Transaction, typeId: string) {
  if (tx.location !== "server") return;
  for (const item of await tx.run(zql.workItem.where("typeId", typeId))) {
    if ((await recomputeFormulas(tx, item.id)).length > 0) await recomputeParentFormulas(tx, item.id);
  }
}

export async function setFormula(tx: Transaction, args: z.output<typeof setFormulaArgs>, userID: string) {
  const field = await tx.run(zql.fieldDef.where("id", args.id).one());
  if (field?.dataType !== "formula") throw new Error("只有公式字段能改公式。");
  const type = await adminType(tx, field.typeId, userID);
  const formula = checkFormula(type.fields, field.key, args.formula);
  await tx.mutate.fieldDef.update({ id: args.id, formula });
  await recomputeType(tx, field.typeId);
}

/**
 * 改字段的名称、选项、必填和配置（帮助说明、对接标识、有效性、条件显示和必填、默认值、数字格式…）。
 * 配置里的条件只能引用同一类型的其他字段；对接标识在类型内唯一。
 * 默认值只在新建时套用，改了不影响已有工作项。
 */
export async function updateField(tx: Transaction, args: z.output<typeof updateFieldArgs>, userID: string) {
  const field = await tx.run(zql.fieldDef.where("id", args.id).one());
  if (!field) throw new Error("字段不存在。");
  const type = await adminType(tx, field.typeId, userID);
  const others = type.fields.filter((f) => f.id !== field.id);
  const name = args.name ?? field.name;
  if (others.some((f) => f.name === name)) throw new Error(`已经有字段「${name}」了。`);
  const dataType = field.dataType as FieldDataType;
  const options = args.options ?? field.options ?? [];
  if (args.options) {
    if (!OPTION_FIELD_TYPES.includes(dataType)) throw new Error(`「${name}」没有选项。`);
    if (options.length === 0) throw new Error("选项字段至少要有一个选项。");
    const error = checkOptions(dataType, options);
    if (error) throw new Error(error);
  }
  const config = args.config === undefined ? (field.config ?? null) : args.config;
  if (config) {
    const error = checkFieldConfig(
      { key: field.key, name, dataType, options },
      config,
      type.fields.map((f) => f.key),
    );
    if (error) throw new Error(error);
    if (config.leafOnly && !CASCADE_FIELD_TYPES.includes(dataType)) throw new Error("只有级联字段能要求选到最后一级。");
    if (config.alias && others.some((f) => f.config?.alias === config.alias || f.key === config.alias))
      throw new Error(`对接标识「${config.alias}」已经被别的字段用了。`);
  }
  await tx.mutate.fieldDef.update({
    id: field.id,
    name,
    ...(args.options && { options }),
    ...(args.required !== undefined && { required: args.required }),
    ...(args.config !== undefined && { config: args.config }),
  });
}

/** 新模板带一个草稿 v1：节点流只有“开始”节点；状态流是“待处理 → 处理中 → 已完成”的常用流转。 */
export async function createTemplate(tx: Transaction, args: z.output<typeof createTemplateArgs>, userID: string) {
  const type = await adminType(tx, args.typeId, userID);
  const now = Date.now();
  await tx.mutate.flowTemplate.insert({ ...args, currentVersionId: null, createdAt: now });
  const definition: FlowDefinition | StatusFlowDefinition =
    type.flowMode === "state"
      ? {
          key: args.key,
          version: 1,
          mode: "state",
          statuses: [
            { key: "todo", name: "待处理", category: "todo" },
            { key: "doing", name: "处理中", category: "doing" },
            { key: "done", name: "已完成", category: "done" },
          ],
          transitions: [
            { from: "todo", to: "doing" },
            { from: "doing", to: "done" },
            { from: "done", to: "doing" },
          ],
        }
      : {
          key: args.key,
          version: 1,
          nodes: [{ key: "start", name: "开始", completion: "auto", ownerRoles: [], position: { x: 0, y: 0 } }],
          edges: [],
        };
  await tx.mutate.flowVersion.insert({
    id: flowVersionId(args.id, 1),
    templateId: args.id,
    version: 1,
    definition,
    publishedAt: null,
    publishedBy: null,
    createdAt: now,
  });
}

/** 保存草稿：最新版本是草稿就覆盖它，已发布就开一个新版本。返回草稿的版本 id。 */
export async function saveDraft(tx: Transaction, args: z.output<typeof saveDraftArgs>, userID: string) {
  const { template, latest, type } = await adminTemplate(tx, args.templateId, userID);
  if (isStatusFlow(args.definition) !== (type.flowMode === "state"))
    throw new Error(type.flowMode === "state" ? "这个类型用状态流。" : "这个类型用节点流。");
  if (latest && !latest.publishedAt) {
    const definition = { ...args.definition, key: template.key, version: latest.version };
    await tx.mutate.flowVersion.update({ id: latest.id, definition });
    return latest.id;
  }
  const version = (latest?.version ?? 0) + 1;
  const id = flowVersionId(template.id, version);
  await tx.mutate.flowVersion.insert({
    id,
    templateId: template.id,
    version,
    definition: { ...args.definition, key: template.key, version },
    publishedAt: null,
    publishedBy: null,
    createdAt: Date.now(),
  });
  return id;
}

/**
 * 模板引用的角色和字段必须在工作项类型里存在。引擎的 validateFlow 只看图本身，这里补上和类型配置的对照。
 */
export function checkReferences(
  definition: FlowDefinition | StatusFlowDefinition,
  roleKeys: readonly string[],
  fieldKeys: readonly string[],
): string[] {
  const errors: string[] = [];
  const roles = new Set(roleKeys);
  const fields = new Set(fieldKeys);
  const fieldsOf = conditionFields;
  if (isStatusFlow(definition)) {
    const name = (key: string) => definition.statuses.find((s) => s.key === key)?.name ?? key;
    for (const t of definition.transitions) {
      const label = `「${name(t.from)} → ${name(t.to)}」`;
      for (const role of t.roles ?? []) if (!roles.has(role)) errors.push(`流转${label}的角色「${role}」不存在。`);
      for (const field of t.gate ? fieldsOf(t.gate) : [])
        if (!fields.has(field)) errors.push(`流转${label}的条件用到的字段「${field}」不存在。`);
    }
    return errors;
  }
  for (const node of definition.nodes) {
    for (const role of node.ownerRoles)
      if (!roles.has(role)) errors.push(`节点「${node.name}」的负责角色「${role}」不存在。`);
    for (const role of node.operatorRoles ?? [])
      if (!roles.has(role)) errors.push(`节点「${node.name}」的可操作角色「${role}」不存在。`);
    for (const c of [node.visibility, node.gate])
      for (const field of c ? fieldsOf(c) : [])
        if (!fields.has(field)) errors.push(`节点「${node.name}」的条件用到的字段「${field}」不存在。`);
    for (const { field } of node.form ?? [])
      if (!fields.has(field)) errors.push(`节点「${node.name}」的完成表单用到的字段「${field}」不存在。`);
    const assigned = [
      ...(node.buttons ?? []).flatMap((b) => (b.assignments ?? []).map((a) => a.field)),
      ...[...(node.onArrive ?? []), ...(node.onComplete ?? [])].flatMap((a) =>
        a.kind === "setField" ? [a.field] : [],
      ),
    ];
    for (const field of assigned)
      if (!fields.has(field)) errors.push(`节点「${node.name}」要改的字段「${field}」不存在。`);
    if (node.schedule && !fields.has(node.schedule.field))
      errors.push(`节点「${node.name}」相对排期的基准字段「${node.schedule.field}」不存在。`);
    for (const b of node.buttons ?? []) {
      for (const role of b.roles ?? [])
        if (!roles.has(role)) errors.push(`节点「${node.name}」按钮「${b.label}」的角色「${role}」不存在。`);
      if (b.conclusion && !node.conclusion?.options.some((o) => o.value === b.conclusion))
        errors.push(`节点「${node.name}」按钮「${b.label}」的结论不在结论选项里。`);
    }
  }
  // 状态计算规则可以用节点状态（$node.键）和结论（$conclusion.键），其余要是字段
  const nodeKeys = new Set(definition.nodes.map((n) => n.key));
  for (const rule of definition.stageRules ?? [])
    for (const field of fieldsOf(rule.when)) {
      const [prefix, key] = field.startsWith("$") ? field.split(".", 2) : [null, null];
      if (prefix ? !nodeKeys.has(key ?? "") : !fields.has(field)) errors.push(`状态计算规则用到的「${field}」不存在。`);
    }
  return errors;
}

/** 发布草稿：通过校验后成为模板的当前版本，之后新建的工作项都用它。 */
export async function publishVersion(tx: Transaction, args: z.output<typeof publishArgs>, userID: string) {
  const version = await tx.run(zql.flowVersion.where("id", args.versionId).one());
  if (!version) throw new Error("版本不存在。");
  if (version.publishedAt) throw new Error("这个版本已经发布过了。");
  const { latest, type } = await adminTemplate(tx, version.templateId, userID);
  if (latest?.id !== version.id) throw new Error("只能发布最新的草稿。");

  const definition = version.definition;
  const errors = [
    ...(isStatusFlow(definition) ? validateStatusFlow(definition) : validateFlow(definition)).errors,
    ...checkReferences(
      definition,
      type.roles.map((r) => r.key),
      type.fields.map((f) => f.key),
    ),
  ];
  if (errors.length > 0) throw new Error(`流程还有问题，不能发布：${errors.join("；")}`);

  const now = Date.now();
  await tx.mutate.flowVersion.update({ id: version.id, publishedAt: now, publishedBy: userID });
  await tx.mutate.flowTemplate.update({ id: version.templateId, currentVersionId: version.id });
}
