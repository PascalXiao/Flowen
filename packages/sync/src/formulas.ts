import {
  CASCADE_FIELD_TYPES,
  type CompiledFormula,
  compileFormula,
  dayFromDate,
  dayToIso,
  type FieldConfig,
  type FieldDataType,
  type FormulaItem,
  type FormulaNode,
  type FormulaNodeItem,
  nodeFlowOf,
  optionPath,
  orderFormulas,
} from "@fp/engine";
import type { Transaction } from "@rocicorp/zero";
import { syncFieldAccess } from "./access.ts";
import { storeFieldValue } from "./field-values.ts";
import { zql } from "./schema.gen.ts";

type FieldRow = {
  key: string;
  name: string;
  dataType: FieldDataType;
  formula: string | null;
  config?: FieldConfig | null;
};

type ColumnsField = {
  key: string;
  name: string;
  dataType?: string;
  config?: { columns?: readonly { key: string; name: string }[] | null } | null;
};

/** 字段组的行存的是列键；公式里按列名取（each.{品牌}），所以行里再按列名放一份。 */
function formulaValue(field: ColumnsField | undefined, value: unknown): unknown {
  const columns = field?.dataType === "fieldGroup" ? field.config?.columns : null;
  if (!columns || !Array.isArray(value)) return value;
  return value.map((row) =>
    row && typeof row === "object"
      ? { ...row, ...Object.fromEntries(columns.map((c) => [c.name, (row as Record<string, unknown>)[c.key] ?? null])) }
      : row,
  );
}

/** 公式里写的字段名或字段键换成字段键。 */
export function fieldResolver(fields: readonly { key: string; name: string }[]) {
  return (ref: string) => fields.find((f) => f.key === ref)?.key ?? fields.find((f) => f.name === ref)?.key;
}

/** 编译一个类型上的全部公式字段，按依赖顺序排好。 */
export function compileTypeFormulas(fields: readonly FieldRow[]) {
  const resolve = fieldResolver(fields);
  return orderFormulas(
    fields.flatMap((f) => {
      if (f.dataType !== "formula" || !f.formula) return [];
      const compiled = compileFormula(f.formula, resolve);
      return [{ ...f, refs: compiled.refs, compiled }];
    }),
  );
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * 重算一个工作项的公式字段，只写有变化的值，返回变化。只在服务端算：
 * 浏览器里可能缺受限字段和子工作项的数据，算出来的值不可靠。
 */
export async function recomputeFormulas(
  tx: Transaction,
  workItemId: string,
): Promise<{ fieldKey: string; from: unknown; to: unknown }[]> {
  if (tx.location !== "server") return [];
  const item = await tx.run(
    zql.workItem
      .where("id", workItemId)
      .related("type", (t) => t.related("fields"))
      .related("fieldValues")
      .related("flowVersion", (v) => v.related("template"))
      .one(),
  );
  if (!item?.type) return [];
  const self = { template: item.flowVersion?.template?.name ?? null, typeName: item.type.name };
  // 配了「完成后冻结」的公式字段，工作项完成后不再变
  const frozen = item.status === "completed";
  const formulas = compileTypeFormulas(item.type.fields).filter((f) => !(frozen && f.config?.freezeOnComplete));
  if (formulas.length === 0) return [];

  const values = new Map(item.fieldValues.map((v) => [v.fieldKey, v.value]));
  const children = formulas.some((f) => f.compiled.usesSubItems || f.compiled.usesRelated)
    ? await subItemsOf(tx, workItemId)
    : null;
  const cross = formulas.some((f) => f.compiled.usesRelated) ? await crossScope(tx, workItemId, children ?? []) : null;
  const changes: { fieldKey: string; from: unknown; to: unknown }[] = [];
  let created = false;
  for (const f of formulas) {
    const value = evaluate(f.compiled, values, children, cross, item.type.fields, self);
    if (same(values.get(f.key), value)) continue;
    const result = await storeFieldValue(tx, workItemId, f, value);
    created ||= result.created;
    changes.push({ fieldKey: f.key, from: result.from, to: value });
    values.set(f.key, value);
  }
  if (created) await syncFieldAccess(tx, workItemId);
  return changes;
}

type SubItem = {
  name: string;
  status: string | null;
  stage: string | null;
  /** 流程类型（流程模板名）和流程节点，公式里的 .流程类型 .节点 用。 */
  template?: string | null;
  nodes?: FormulaNodeItem[];
  values: Map<string, unknown>;
  fields: readonly ColumnsField[];
};

/** 公式里的别的工作项：字段按名称或键取。 */
const asFormulaItem = (i: SubItem): FormulaItem => ({
  name: i.name,
  status: i.status,
  stage: i.stage,
  template: i.template ?? null,
  nodes: i.nodes ?? [],
  field: (ref) => {
    const key = fieldResolver(i.fields)(ref);
    return key === undefined
      ? null
      : formulaValue(
          i.fields.find((f) => f.key === key),
          i.values.get(key),
        );
  },
});

type CrossScope = {
  related(name: string): FormulaItem[];
  children(): FormulaItem[];
  node(ref: string): FormulaNode | null;
  optionPath(value: string): string[];
};

type OptionField = {
  dataType: string;
  options?: readonly { value: string; parent?: string }[] | null;
  config?: {
    columns?: readonly { dataType: string; options?: readonly { value: string; parent?: string }[] | null }[] | null;
  } | null;
};

/** 级联选项的路径：从这些字段（含字段组的列）的级联选项里找，LEVEL 用。 */
function cascadePaths(fields: readonly OptionField[]) {
  const options = fields.flatMap((f) => [
    ...(CASCADE_FIELD_TYPES.includes(f.dataType as FieldDataType) ? (f.options ?? []) : []),
    ...(f.config?.columns ?? []).flatMap((c) =>
      CASCADE_FIELD_TYPES.includes(c.dataType as FieldDataType) ? (c.options ?? []) : [],
    ),
  ]);
  return (value: string) => {
    const path = optionPath(options, value);
    return path.length > 0 ? path : [value];
  };
}

const day = (ms: number | null | undefined) => (ms == null ? null : dayToIso(dayFromDate(ms)));

/**
 * 公式里 RELATED、CHILDREN、NODE 要的数据：按关联名（或关联键）分好的关联工作项（两个方向）、子工作项、节点。
 */
async function crossScope(tx: Transaction, workItemId: string, children: SubItem[]): Promise<CrossScope> {
  const outgoing = await tx.run(
    zql.relation
      .where("fromId", workItemId)
      .where("relationDefId", "IS NOT", null)
      .related("def")
      .related("to", (w) =>
        w
          .related("fieldValues")
          .related("type", (t) => t.related("fields"))
          .related("nodes")
          .related("flowVersion", (v) => v.related("template")),
      ),
  );
  const incoming = await tx.run(
    zql.relation
      .where("toId", workItemId)
      .where("relationDefId", "IS NOT", null)
      .related("def")
      .related("from", (w) =>
        w
          .related("fieldValues")
          .related("type", (t) => t.related("fields"))
          .related("nodes")
          .related("flowVersion", (v) => v.related("template")),
      ),
  );
  const toSub = (w: {
    name: string;
    status: string | null;
    stage: string | null;
    fieldValues: readonly { fieldKey: string; value: unknown }[];
    type?: { fields: readonly ColumnsField[] } | undefined;
    flowVersion?: { definition: unknown; template?: { name: string } | undefined } | undefined;
    nodes?:
      | readonly {
          nodeKey: string;
          state: string | null;
          conclusion: string | null;
          plannedStart?: number | null;
          plannedEnd?: number | null;
          actualEnd?: number | null;
        }[]
      | undefined;
  }): SubItem => {
    const flow = nodeFlowOf(w.flowVersion?.definition);
    return {
      name: w.name,
      status: w.status,
      stage: w.stage,
      template: w.flowVersion?.template?.name ?? null,
      nodes: (w.nodes ?? []).map((n) => ({
        name: flow?.nodes.find((d) => d.key === n.nodeKey)?.name ?? n.nodeKey,
        state: n.state ?? "notStarted",
        conclusion: n.conclusion ?? null,
        plannedStart: day(n.plannedStart),
        plannedEnd: day(n.plannedEnd),
        actualEnd: day(n.actualEnd),
      })),
      values: new Map(w.fieldValues.map((v) => [v.fieldKey, v.value])),
      fields: w.type?.fields ?? [],
    };
  };
  const byDef = new Map<string, SubItem[]>();
  const add = (
    def: { id: string; name: string; reverseName?: string | null } | undefined,
    name: string | undefined,
    w: Parameters<typeof toSub>[0] | undefined,
  ) => {
    if (!def || !w) return;
    for (const k of [def.id, name ?? def.name]) byDef.set(k, [...(byDef.get(k) ?? []), toSub(w)]);
  };
  for (const r of outgoing) add(r.def, r.def?.name, r.to);
  // 互相关联的另一端用另一端的字段名；没有设另一端字段名的关联，两个方向都用关联名
  for (const r of incoming) add(r.def, r.def?.reverseName ?? r.def?.name, r.from);

  const item = await tx.run(
    zql.workItem
      .where("id", workItemId)
      .related("flowVersion")
      .related("nodes")
      .related("type", (t) => t.related("fields"))
      .one(),
  );
  const definition = nodeFlowOf(item?.flowVersion?.definition);
  const optionFields = [
    ...(item?.type?.fields ?? []),
    ...[...outgoing.map((r) => r.to), ...incoming.map((r) => r.from)].flatMap((w) => w?.type?.fields ?? []),
  ] as OptionField[];
  return {
    optionPath: cascadePaths(optionFields),
    related: (name) => (byDef.get(name) ?? []).map(asFormulaItem),
    children: () => children.map(asFormulaItem),
    node: (ref) => {
      const key = definition?.nodes.find((n) => n.key === ref || n.name === ref)?.key ?? ref;
      const n = item?.nodes.find((x) => x.nodeKey === key);
      return n
        ? {
            state: n.state ?? "notStarted",
            conclusion: n.conclusion ?? null,
            plannedStart: day(n.plannedStart),
            plannedEnd: day(n.plannedEnd),
            actualEnd: day(n.actualEnd),
          }
        : null;
    },
  };
}

async function subItemsOf(tx: Transaction, workItemId: string): Promise<SubItem[]> {
  const edges = await tx.run(
    zql.relation
      .where("fromId", workItemId)
      .where("parentNodeKey", "IS NOT", null)
      .related("to", (w) => w.related("fieldValues").related("type", (t) => t.related("fields"))),
  );
  return edges.flatMap((e) =>
    e.to
      ? [
          {
            name: e.to.name,
            status: e.to.status,
            stage: e.to.stage,
            values: new Map(e.to.fieldValues.map((v) => [v.fieldKey, v.value])),
            fields: e.to.type?.fields ?? [],
          },
        ]
      : [],
  );
}

function evaluate(
  formula: CompiledFormula,
  values: Map<string, unknown>,
  children: SubItem[] | null,
  cross: CrossScope | null,
  fields: readonly ColumnsField[],
  self: { template: string | null; typeName: string },
) {
  return formula.evaluate({
    ...self,
    field: (key) =>
      formulaValue(
        fields.find((f) => f.key === key),
        values.get(key),
      ),
    ...(cross && { related: cross.related, children: cross.children, node: cross.node, optionPath: cross.optionPath }),
    ...(children && {
      subItemCount: children.length,
      subItemsDone: children.filter((c) => c.status === "completed").length,
      subItemValues: (ref) =>
        children.map((c) => {
          const key = fieldResolver(c.fields)(ref);
          return key === undefined ? null : c.values.get(key);
        }),
    }),
  });
}

/**
 * 子工作项的字段或状态变了：重算上级工作项的公式（上级的公式可能又被再上一级汇总，最多往上 5 层）。
 */
export async function recomputeParentFormulas(tx: Transaction, workItemId: string, depth = 0): Promise<void> {
  if (tx.location !== "server" || depth >= 5) return;
  const parents = await tx.run(zql.relation.where("toId", workItemId).where("parentNodeKey", "IS NOT", null));
  for (const p of new Set(parents.map((r) => r.fromId))) {
    const changes = await recomputeFormulas(tx, p);
    if (changes.length > 0) await recomputeParentFormulas(tx, p, depth + 1);
  }
  await recomputeRelatedFormulas(tx, workItemId, depth);
}

/**
 * 工作项变了（字段、状态、节点）：通过自定义关联连着它的工作项，公式里可能用 RELATED 读它，重算一遍。
 * 只重算有跨工作项公式的类型；连锁变化最多往外 5 层。
 */
export async function recomputeRelatedFormulas(tx: Transaction, workItemId: string, depth = 0): Promise<void> {
  if (tx.location !== "server" || depth >= 5) return;
  const edges = [
    ...(await tx.run(zql.relation.where("toId", workItemId).where("relationDefId", "IS NOT", null))).map(
      (r) => r.fromId,
    ),
    ...(await tx.run(zql.relation.where("fromId", workItemId).where("relationDefId", "IS NOT", null))).map(
      (r) => r.toId,
    ),
  ];
  for (const id of new Set(edges)) {
    const neighbor = await tx.run(
      zql.workItem
        .where("id", id)
        .related("type", (t) => t.related("fields"))
        .one(),
    );
    if (!neighbor?.type?.fields.some((f) => f.formula && /RELATED|NODE|CHILDREN/i.test(f.formula))) continue;
    if ((await recomputeFormulas(tx, id)).length > 0) await recomputeRelatedFormulas(tx, id, depth + 1);
  }
}
