import {
  type ActionTarget,
  type AutomationAction,
  type AutomationBranch,
  type AutomationRecipient,
  type AutomationTrigger,
  type Condition,
  type FieldValueLiteral,
  type FlowDefinition,
  formatFieldValue,
  type NewItemField,
  NODE_TRIGGERS,
  nodeFlowOf,
  type RequestHeader,
  type StatusFlowDefinition,
  statusFlowOf,
  TARGETABLE_ACTIONS,
  type ValueSource,
} from "@fp/engine";
import { mutators, queries } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Play, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { ConditionEditor } from "@/components/ConditionEditor";
import { FieldInput } from "@/components/FieldInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";
import { Tag } from "@/components/ui/tag";
import { type ForeignType, foreignTypes, type RelDef, spaceRelationDefs } from "@/lib/relations";
import { newId } from "@/lib/utils";

type Space = NonNullable<QueryResultType<ReturnType<typeof queries.spaces.byId>>>;
type ItemType = Space["workItemTypes"][number];
type Rule = QueryResultType<ReturnType<typeof queries.automations.bySpace>>[number];
/** 本空间的类型，或者经跨空间关联连过来的别的空间的类型。 */
type AnyType = ItemType | ForeignType;

const TRIGGER_LABEL: Record<AutomationTrigger["kind"], string> = {
  workItemCreated: "工作项创建后",
  workItemCompleted: "工作项完成时",
  workItemTerminated: "工作项终止时",
  workItemRestored: "工作项恢复时",
  workItemDeleted: "工作项删除时",
  fieldChanged: "字段变化时",
  statusChanged: "状态变化时",
  nodeStarted: "节点开始时",
  nodeCompleted: "节点完成时",
  nodeRolledBack: "节点回滚时",
  nodePlanChanged: "节点排期变更时",
  roleChanged: "角色人员变更时",
  relationAdded: "关联工作项时",
  relationRemoved: "解除关联时",
  commentAdded: "有新评论时",
  taskCreated: "新建子任务时",
  taskUpdated: "子任务修改时",
  taskDone: "子任务完成时",
  taskDeleted: "子任务删除时",
  schedule: "定时触发",
  dateReached: "日期临近、到期或超期时",
  manual: "手动运行",
};
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WHEN_LABEL = { before: "临期（提前）", on: "到期当天", after: "超期" } as const;
const FREQUENCY_UNIT = { day: "天", week: "周", month: "个月" } as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const ACTION_LABEL: Record<AutomationAction["type"], string> = {
  setField: "修改字段",
  setRole: "设置角色成员",
  confirmNode: "完成节点",
  transitionStatus: "流转状态",
  notify: "发送通知",
  addComment: "添加评论",
  createTask: "新建子任务",
  createWorkItem: "新建工作项",
  terminate: "终止工作项",
  restore: "恢复工作项",
  httpRequest: "调用外部接口",
};
const RUN_LABEL: Record<string, string> = {
  succeeded: "成功",
  failed: "失败",
  running: "执行中",
  skipped: "跳过",
  pending: "等待发送",
};
const isNodeTrigger = (kind: string) => (NODE_TRIGGERS as readonly string[]).includes(kind);
const isTargetable = (type: AutomationAction["type"]) => (TARGETABLE_ACTIONS as readonly string[]).includes(type);

/** 类型当前发布的流程版本定义（取第一个有发布版本的模板）。 */
function definitionOf(type: AnyType | undefined): unknown {
  return type?.flowTemplates.find((t) => t.currentVersion)?.currentVersion?.definition;
}
/** 类型当前发布的节点流。 */
const flowOf = (type: AnyType | undefined): FlowDefinition | null => nodeFlowOf(definitionOf(type));
/** 类型当前发布的状态流。 */
const statusFlow = (type: AnyType | undefined): StatusFlowDefinition | null => statusFlowOf(definitionOf(type));

/** 一个类型能用的关联：从它出发的和指向它的（两个方向都算），以及在这个类型上看到的名称和另一端的类型。 */
function relationsOf(type: AnyType | undefined, defs: readonly RelDef[]) {
  if (!type) return [];
  return defs
    .filter((d) => d.fromTypeId === type.id || d.toTypeId === type.id)
    .map((d) => {
      const forward = d.fromTypeId === type.id;
      return {
        def: d,
        name: forward ? d.name : (d.reverseName ?? d.name),
        otherTypeId: forward ? d.toTypeId : d.fromTypeId,
      };
    });
}

/** 名字查找：节点、状态、字段、角色、关联、类型、成员。规则描述和表单都用。 */
function namesFor(
  type: AnyType | undefined,
  types: readonly AnyType[],
  defs: readonly RelDef[],
  members: Map<string, string>,
) {
  return {
    node: (key: string) => flowOf(type)?.nodes.find((n) => n.key === key)?.name ?? key,
    status: (key: string) => statusFlow(type)?.statuses.find((s) => s.key === key)?.name ?? key,
    field: (key: string) => type?.fields.find((f) => f.key === key)?.name ?? key,
    role: (key: string) => type?.roles.find((r) => r.key === key)?.name ?? key,
    relation: (id: string) => {
      const d = defs.find((x) => x.id === id);
      if (!d) return "已删除的关联";
      return type && d.toTypeId === type.id && d.fromTypeId !== type.id ? (d.reverseName ?? d.name) : d.name;
    },
    type: (id: string) => types.find((t) => t.id === id)?.name ?? "已删除的类型",
    user: (id: string) => members.get(id) ?? id,
  };
}
type Names = ReturnType<typeof namesFor>;

/** 收件人的显示名。 */
function recipientName(r: AutomationRecipient, names: Names): string {
  if (r === "creator") return "创建人";
  if (r === "actor") return "触发人";
  if (r === "currentNodeOwners") return "进行中节点的负责人";
  if (r.startsWith("role:")) return `角色「${names.role(r.slice(5))}」`;
  if (r.startsWith("field:")) return `「${names.field(r.slice(6))}」里的人`;
  if (r.startsWith("node:")) return `「${names.node(r.slice(5))}」负责人`;
  return names.user(r.slice(5));
}

/** 条件的一句话描述。 */
function describeCondition(
  condition: Condition,
  fieldName: (key: string) => string,
  show: (key: string, value: unknown) => string,
): string {
  const ops = { gt: "大于", gte: "不小于", lt: "小于", lte: "不大于" };
  switch (condition.kind) {
    case "equal":
      return `「${fieldName(condition.field)}」为 ${show(condition.field, condition.value)}`;
    case "notEqual":
      return `「${fieldName(condition.field)}」不为 ${show(condition.field, condition.value)}`;
    case "notEmpty":
      return `「${fieldName(condition.field)}」不为空`;
    case "compare":
      return `「${fieldName(condition.field)}」${ops[condition.op]} ${condition.value}`;
    default:
      return condition.items
        .map((c) => describeCondition(c, fieldName, show))
        .join(condition.kind === "all" ? "并且" : "或者");
  }
}

/** 触发时机的一句话描述。 */
function describeTrigger(trigger: AutomationTrigger, names: Names): string {
  const label = TRIGGER_LABEL[trigger.kind];
  switch (trigger.kind) {
    case "fieldChanged":
      return `「${names.field(trigger.field)}」变化时`;
    case "statusChanged": {
      if (!trigger.from && !trigger.to) return label;
      const from = trigger.from ? `从「${names.status(trigger.from)}」` : "";
      const to = trigger.to ? `变为「${names.status(trigger.to)}」` : "变化";
      return `状态${from}${to}时`;
    }
    case "roleChanged":
      return trigger.role ? `「${names.role(trigger.role)}」人员变更时` : label;
    case "schedule": {
      const at = `${String(trigger.hour).padStart(2, "0")}:00`;
      const every = trigger.every && trigger.every > 1 ? trigger.every : 1;
      const period =
        trigger.frequency === "week"
          ? `${every > 1 ? `每 ${every} 周的` : "每"}${(trigger.weekdays ?? []).map((d) => WEEKDAYS[d]).join("、")}`
          : trigger.frequency === "month"
            ? `${every > 1 ? `每 ${every} 个月的` : "每月"} ${(trigger.monthDays ?? []).join("、")} 号`
            : every > 1
              ? `每 ${every} 天`
              : "每天";
      const range =
        trigger.startDate || trigger.endDate
          ? `（${trigger.startDate ?? "现在"} 至 ${trigger.endDate ?? "长期"}）`
          : "";
      return `${period} ${at}${range}`;
    }
    case "dateReached": {
      const date = trigger.date.startsWith("node:")
        ? `「${names.node(trigger.date.slice(5))}」计划完成日`
        : `「${names.field(trigger.date)}」`;
      const at = `${String(trigger.hour).padStart(2, "0")}:00`;
      if (trigger.when === "before") return `${date}前 ${trigger.days} 天 ${at}`;
      if (trigger.when === "after") return `${date}超过 ${trigger.days} 天 ${at}`;
      return `${date}当天 ${at}`;
    }
    case "relationAdded":
    case "relationRemoved":
      return trigger.relation
        ? `${trigger.kind === "relationAdded" ? "关联" : "解除关联"}「${names.relation(trigger.relation)}」时`
        : label;
    case "manual":
      return "手动运行时";
    default: {
      const node = (trigger as { node?: string }).node;
      return node && isNodeTrigger(trigger.kind) ? `「${names.node(node)}」${label.replace(/^节点/, "")}` : label;
    }
  }
}

/** 取值来源的描述：「触发工作项的『X』」或「关联『Y』的『X』」。 */
function describeSource(source: ValueSource, names: Names, what: (key: string) => string) {
  return source.relation
    ? `关联「${names.relation(source.relation)}」的「${what(source.field)}」`
    : `触发工作项的「${what(source.field)}」`;
}

/** 一个动作的一句话描述。names 是触发类型的，forType 给出别的类型（作用对象、来源）的名字查找。 */
function describeAction(
  a: AutomationAction,
  names: Names,
  forType: (typeId: string | undefined) => Names,
  show: (key: string, value: unknown) => string,
  otherType: (relationId: string) => string | undefined,
): string {
  const targetNames = a.target ? forType(otherType(a.target.relation)) : names;
  const sourceNames = (source: ValueSource) => (source.relation ? forType(otherType(source.relation)) : names);
  const n = targetNames;
  const body = (() => {
    switch (a.type) {
      case "setField":
        return a.copy
          ? `把「${n.field(a.field)}」同步为${describeSource(a.copy, names, sourceNames(a.copy).field)}`
          : `把「${n.field(a.field)}」设为 ${(a.target ? String(a.value ?? "") : show(a.field, a.value)) || "空"}`;
      case "setRole":
        return a.copy
          ? `把「${n.role(a.role)}」同步为${describeSource(a.copy, names, sourceNames(a.copy).role)}`
          : `把「${n.role(a.role)}」设为 ${a.userIds.map(n.user).join("、") || "无人"}`;
      case "confirmNode":
        return `完成「${n.node(a.node)}」`;
      case "transitionStatus":
        return `流转到「${n.status(a.to)}」`;
      case "terminate":
        return a.reason ? `终止工作项（${a.reason}）` : "终止工作项";
      case "restore":
        return "恢复工作项";
      case "addComment":
        return `评论「${a.body}」`;
      case "createTask":
        return `在「${n.node(a.node)}」新建子任务「${a.name}」${a.assigneeId ? `给 ${n.user(a.assigneeId)}` : ""}`;
      case "createWorkItem":
        return `新建${names.type(a.typeId)}「${a.name}」${a.relationDefId ? `并按「${names.relation(a.relationDefId)}」关联` : ""}${a.fields?.length ? `，带 ${a.fields.length} 个字段值` : ""}`;
      case "notify":
        return `通知${a.to.map((r) => recipientName(r, n)).join("、")}：${a.text}`;
      case "httpRequest":
        return `调用外部接口 ${a.url}`;
    }
  })();
  if (!a.target) return body;
  const where = a.target.condition
    ? `（${describeCondition(a.target.condition, n.field, (_k, v) => String(v))}的）`
    : "";
  return `对关联「${names.relation(a.target.relation)}」的工作项${where}${body}`;
}

/** 规则的一句话描述，列表里用。 */
function describeRule(
  rule: Rule,
  types: readonly AnyType[],
  defs: readonly RelDef[],
  members: Map<string, string>,
): string {
  const trigger = rule.trigger as AutomationTrigger;
  const type = types.find((t) => t.id === trigger.typeId);
  const names = namesFor(type, types, defs, members);
  const forType = (typeId: string | undefined) =>
    namesFor(
      types.find((t) => t.id === typeId),
      types,
      defs,
      members,
    );
  const otherType = (relationId: string) => {
    const d = defs.find((x) => x.id === relationId);
    return d && (d.fromTypeId === type?.id ? d.toTypeId : d.fromTypeId);
  };
  const condition = rule.conditions as Condition | null;
  const fieldOf = (key: string) => type?.fields.find((f) => f.key === key);
  const show = (key: string, value: unknown) => {
    const f = fieldOf(key);
    return f ? formatFieldValue(f as Parameters<typeof formatFieldValue>[0], value, names.user) : String(value);
  };
  const given = condition ? `，且${describeCondition(condition, names.field, show)}` : "";
  const list = (actions: AutomationAction[]) =>
    actions.map((a) => describeAction(a, names, forType, show, otherType)).join("；");
  const branches = ((rule.branches as AutomationBranch[] | null) ?? []).map((b) =>
    b.condition
      ? `；否则如果${describeCondition(b.condition, names.field, show)}，${list(b.actions)}`
      : `；否则${list(b.actions)}`,
  );
  return `${type ? `${type.name}：` : ""}${describeTrigger(trigger, names)}${given}，${list(rule.actions as AutomationAction[])}${branches.join("")}`;
}

/** 空间配置里的「自动化」页签：规则列表、启用停用、执行记录、手动运行，以及新建规则的表单。只有管理员能改。 */
export function AutomationsPanel({ spaceId }: { spaceId: string }) {
  const zero = useZero();
  const [space, spaceResult] = useQuery(queries.spaces.byId({ id: spaceId }));
  const [rules] = useQuery(queries.automations.bySpace({ spaceId }));
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  if (!space)
    return (
      <p className="p-6 text-sm text-fg-muted">
        {spaceResult.type === "complete" ? "空间不存在或没有权限。" : "加载中…"}
      </p>
    );
  const isAdmin = space.members.some((m) => m.userId === zero.userID && m.role === "admin");
  const types: AnyType[] = [...space.workItemTypes, ...foreignTypes(space)];
  const defs = spaceRelationDefs(space);
  const members = new Map(space.members.map((m) => [m.userId, m.user?.name ?? m.userId]));

  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") {
        setError(outcome.error.message);
        return false;
      }
    return true;
  }

  /** 新建规则：浏览器端校验通过就算提交成功、清空表单；服务端万一拒绝，再把错误显示出来。 */
  async function create(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const { client, server } = zero.mutate(request);
    const local = await client;
    if (local.type === "error") {
      setError(local.error.message);
      return false;
    }
    server.then((outcome) => outcome.type === "error" && setError(outcome.error.message));
    return true;
  }

  return (
    <>
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Card>
        <CardHeader>
          <CardTitle>规则</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rules.length === 0 && <p className="text-sm text-fg-muted">还没有自动化规则。</p>}
          {rules.map((rule) => {
            const trigger = rule.trigger as AutomationTrigger;
            const triggerType = types.find((t) => t.id === trigger.typeId);
            return (
              <section key={rule.id} aria-label={rule.name} className="rounded-md border border-line-subtle p-3">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <h3 className="flex items-center gap-2 text-sm font-medium">
                      {rule.name}
                      {triggerType && "foreign" in triggerType && <Tag>跨空间</Tag>}
                    </h3>
                    <p className="text-sm text-fg-muted">{describeRule(rule, types, defs, members)}</p>
                    <p className="text-xs text-fg-subtle">以 {rule.creator?.name ?? "创建人"} 的身份执行</p>
                  </div>
                  {isAdmin && (
                    <>
                      <label className="flex items-center gap-1.5 text-sm">
                        <Checkbox
                          checked={rule.enabled ?? true}
                          onChange={(e) =>
                            run(
                              mutators.automation.update({
                                id: rule.id,
                                name: rule.name,
                                enabled: e.target.checked,
                                trigger,
                                condition: rule.conditions as Condition | null,
                                actions: rule.actions as AutomationAction[],
                                branches: rule.branches as AutomationBranch[] | null,
                              }),
                            )
                          }
                        />
                        启用
                      </label>
                      <Button variant="outline" onClick={() => setEditing(editing === rule.id ? null : rule.id)}>
                        编辑
                      </Button>
                      <Button variant="outline" onClick={() => run(mutators.automation.delete({ id: rule.id }))}>
                        删除
                      </Button>
                    </>
                  )}
                </div>
                {trigger.kind === "manual" && triggerType && (rule.enabled ?? true) && (
                  <ManualRun
                    ruleId={rule.id}
                    type={triggerType}
                    onRun={(workItemId) => run(mutators.automation.run({ ruleId: rule.id, workItemId }))}
                  />
                )}
                {editing === rule.id && (
                  <div className="mt-3">
                    <RuleForm
                      spaceId={spaceId}
                      types={types}
                      defs={defs}
                      members={members}
                      initial={rule}
                      onSubmit={async (request) => {
                        const ok = await run(request);
                        if (ok) setEditing(null);
                        return ok;
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                )}
                {rule.runs.length > 0 && (
                  <ul
                    aria-label="执行记录"
                    className="mt-2 flex flex-col gap-1 border-t border-line-subtle pt-2 text-xs"
                  >
                    {rule.runs.map((r) => (
                      <li key={r.id} className="flex gap-2">
                        <span className={r.status === "failed" ? "text-danger-600" : "text-success-600"}>
                          {RUN_LABEL[r.status] ?? r.status}
                        </span>
                        <span>{r.event?.workItem?.name ?? "—"}</span>
                        <span className="text-fg-subtle">{new Date(r.startedAt ?? 0).toLocaleString("zh-CN")}</span>
                        {r.error && <span className="text-danger-600">{r.error}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {rule.requests.length > 0 && (
                  <ul
                    aria-label="接口调用记录"
                    className="mt-2 flex flex-col gap-1 border-t border-line-subtle pt-2 text-xs"
                  >
                    {rule.requests.map((r) => (
                      <li key={r.id} className="flex flex-wrap gap-2">
                        <span
                          className={
                            r.status === "failed"
                              ? "text-danger-600"
                              : r.status === "succeeded"
                                ? "text-success-600"
                                : "text-fg-muted"
                          }
                        >
                          {RUN_LABEL[r.status ?? "pending"] ?? r.status}
                          {r.responseStatus ? ` HTTP ${r.responseStatus}` : ""}
                        </span>
                        <span>{r.workItem?.name ?? "—"}</span>
                        <span className="max-w-80 truncate text-fg-subtle" title={r.url}>
                          {r.url}
                        </span>
                        <span className="text-fg-subtle">{new Date(r.createdAt ?? 0).toLocaleString("zh-CN")}</span>
                        {(r.attempts ?? 0) > 1 && <span className="text-fg-subtle">试了 {r.attempts} 次</span>}
                        {r.error && <span className="text-danger-600">{r.error}</span>}
                        {r.responseBody && (
                          <span className="max-w-96 truncate text-fg-subtle" title={r.responseBody}>
                            返回：{r.responseBody}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </CardContent>
      </Card>

      {isAdmin && <RuleForm spaceId={spaceId} types={types} defs={defs} members={members} onSubmit={create} />}
    </>
  );
}

/** 手动运行：选一个这个类型的工作项，立即对它执行规则。 */
function ManualRun({ ruleId, type, onRun }: { ruleId: string; type: AnyType; onRun: (workItemId: string) => void }) {
  const [items] = useQuery(queries.workItems.bySpace({ spaceId: type.spaceId, filter: { typeIds: [type.id] } }));
  const [picked, setPicked] = useState("");
  const live = items.filter((i) => i.status !== "terminated");
  return (
    <fieldset className="mt-2 flex items-end gap-2" aria-label={`手动运行 ${ruleId}`}>
      <Label className="flex w-72 flex-col gap-1.5 text-xs">
        对哪个工作项运行
        <Select value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">选择工作项</option>
          {live.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
      </Label>
      <Button variant="outline" disabled={!picked} onClick={() => onRun(picked)}>
        <Play />
        运行
      </Button>
    </fieldset>
  );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Label className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      {label}
      {children}
    </Label>
  );
}

type Member = { userId: string; name: string };

/** 一个类型在表单里要用的东西：节点、状态、字段、角色、关联。 */
function typeParts(type: AnyType | undefined, defs: readonly RelDef[]) {
  return {
    type,
    nodes: flowOf(type)?.nodes ?? [],
    statuses: statusFlow(type)?.statuses ?? [],
    fields: type?.fields ?? [],
    roles: type?.roles ?? [],
    relations: relationsOf(type, defs),
  };
}
type TypeParts = ReturnType<typeof typeParts>;

const options = (items: readonly { key: string; name: string }[]) =>
  items.map((i) => (
    <option key={i.key} value={i.key}>
      {i.name}
    </option>
  ));

function RuleForm({
  spaceId,
  types,
  defs,
  members,
  initial,
  onSubmit,
  onCancel,
}: {
  spaceId: string;
  types: readonly AnyType[];
  defs: readonly RelDef[];
  members: Map<string, string>;
  /** 编辑已有规则时传入。 */
  initial?: Rule;
  onSubmit: (
    request: ReturnType<typeof mutators.automation.create | typeof mutators.automation.update>,
  ) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const ready = types.filter((t) => definitionOf(t));
  const start = initial?.trigger as AutomationTrigger | undefined;
  const [name, setName] = useState(initial?.name ?? "");
  const [typeId, setTypeId] = useState(start?.typeId ?? ready[0]?.id ?? "");
  const [trigger, setTrigger] = useState<AutomationTrigger>(start ?? { kind: "workItemCreated" });
  const [condition, setCondition] = useState<Condition | undefined>(
    (initial?.conditions as Condition | null) ?? undefined,
  );
  const [actions, setActions] = useState<AutomationAction[]>((initial?.actions as AutomationAction[]) ?? []);
  const [branches, setBranches] = useState<AutomationBranch[]>((initial?.branches as AutomationBranch[] | null) ?? []);

  const type = ready.find((t) => t.id === typeId) ?? ready[0];
  if (!type) return <p className="text-sm text-fg-muted">先给空间配置一个有已发布流程的工作项类型。</p>;
  const self = typeParts(type, defs);
  const { nodes, statuses, fields } = self;
  const userFields = fields.filter((f) => f.dataType === "user" || f.dataType === "singleUser");
  const memberList: Member[] = [...members].map(([userId, memberName]) => ({ userId, name: memberName }));
  const partsOf = (id: string | undefined) =>
    typeParts(
      types.find((t) => t.id === id),
      defs,
    );
  /** 关联另一端的类型（从触发类型看）。 */
  const otherEnd = (relationId: string | null | undefined) =>
    self.relations.find((r) => r.def.id === relationId)?.otherTypeId;
  // 动态时间触发可选的日期：日期类字段，以及每个节点的计划完成日
  const dateSources = [
    ...fields
      .filter((f) => f.dataType === "date" || f.dataType === "datetime" || f.dataType === "dateRange")
      .map((f) => ({ key: f.key, name: f.name })),
    ...nodes.map((n) => ({ key: `node:${n.key}`, name: `节点「${n.name}」计划完成` })),
  ];
  // 节点流类型没有状态，状态流类型没有节点：只列这个类型用得上的触发器和动作
  const triggerKinds = (Object.keys(TRIGGER_LABEL) as AutomationTrigger["kind"][]).filter((k) =>
    statuses.length ? !isNodeTrigger(k) : k !== "statusChanged",
  );
  const actionTypesFor = (parts: TypeParts, targeted: boolean) =>
    (Object.keys(ACTION_LABEL) as AutomationAction["type"][])
      .filter((t) => !targeted || isTargetable(t))
      .filter((t) => (parts.statuses.length ? t !== "confirmNode" && t !== "createTask" : t !== "transitionStatus"))
      .filter((t) => t !== "setRole" || parts.roles.length > 0);

  function setKind(kind: AutomationTrigger["kind"]) {
    if (kind === "fieldChanged") setTrigger({ kind, field: fields[0]?.key ?? "" });
    else if (kind === "schedule") setTrigger({ kind, frequency: "day", hour: 9 });
    else if (kind === "dateReached")
      setTrigger({ kind, date: dateSources[0]?.key ?? "", when: "before", days: 1, hour: 9 });
    else setTrigger({ kind } as AutomationTrigger);
  }

  /** 新动作的默认值；parts 是动作作用的类型，target 原样保留。 */
  function newAction(kind: AutomationAction["type"], parts: TypeParts, target?: ActionTarget | null): AutomationAction {
    const t = target ? { target } : {};
    switch (kind) {
      case "setField":
        return { type: kind, field: parts.fields[0]?.key ?? "", value: "", ...t };
      case "setRole":
        return { type: kind, role: parts.roles[0]?.key ?? "", userIds: [], ...t };
      case "confirmNode":
        return { type: kind, node: parts.nodes[0]?.key ?? "", ...t };
      case "transitionStatus":
        return { type: kind, to: parts.statuses[0]?.key ?? "", ...t };
      case "terminate":
        return { type: kind, reason: "", ...t };
      case "restore":
        return { type: kind, ...t };
      case "addComment":
        return { type: kind, body: "", ...t };
      case "createTask":
        return { type: kind, node: parts.nodes[0]?.key ?? "", name: "", assigneeId: null, ...t };
      case "createWorkItem":
        return { type: kind, typeId: type?.id ?? "", name: "{{name}} 的跟进", relationDefId: null, fields: [] };
      case "notify":
        return { type: kind, to: [], text: "「{{name}}」", ...t };
      case "httpRequest":
        return { type: kind, url: "https://", headers: [], body: "" };
    }
  }

  /** 字段值的输入：按字段类型给控件。 */
  function valueInput(
    field: TypeParts["fields"][number] | undefined,
    label: string,
    value: unknown,
    onChange: (value: FieldValueLiteral) => void,
  ) {
    return field ? (
      <FieldInput
        field={field}
        label={label}
        value={value}
        members={memberList}
        live
        // 自动化里不能设字段组，值总是简单值
        onChange={(v) => onChange(v as FieldValueLiteral)}
      />
    ) : null;
  }

  /** 「同步为」的来源选择：触发的工作项，或者它的某条关联。 */
  function sourceSelect(source: ValueSource, onChange: (next: ValueSource) => void, pick: "field" | "role") {
    const parts = source.relation ? partsOf(otherEnd(source.relation)) : self;
    const list = pick === "field" ? parts.fields : parts.roles;
    return (
      <>
        <Field label="来源工作项">
          <Select
            value={source.relation ?? ""}
            onChange={(e) => {
              const relation = e.target.value || null;
              const next = relation ? partsOf(otherEnd(relation)) : self;
              onChange({ relation, field: (pick === "field" ? next.fields : next.roles)[0]?.key ?? "" });
            }}
          >
            <option value="">触发的工作项</option>
            {self.relations.map((r) => (
              <option key={r.def.id} value={r.def.id}>
                {`关联「${r.name}」的第一个工作项`}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={pick === "field" ? "来源字段" : "来源角色"}>
          <Select value={source.field} onChange={(e) => onChange({ ...source, field: e.target.value })}>
            {options(list)}
          </Select>
        </Field>
      </>
    );
  }

  /** 一组动作的编辑区：主动作和每个分支都用它。是普通函数而不是组件，避免每次渲染都重新挂载丢掉输入焦点。 */
  function renderActions(list: AutomationAction[], setList: (next: AutomationAction[]) => void, prefix = "") {
    const update = (i: number, next: AutomationAction) => setList(list.map((a, j) => (j === i ? next : a)));
    return (
      <div className="flex flex-col gap-3">
        {list.map((action, i) => {
          const parts = action.target ? partsOf(otherEnd(action.target.relation)) : self;
          const kinds = actionTypesFor(parts, !!action.target);
          const fieldOptions = options(parts.fields);
          const nodeOptions = options(parts.nodes);
          const memberOptions = memberList.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ));
          const recipients: { value: AutomationRecipient; label: string }[] = [
            { value: "creator", label: "创建人" },
            { value: "actor", label: "触发人" },
            ...(parts.nodes.length ? [{ value: "currentNodeOwners" as const, label: "进行中节点的负责人" }] : []),
            ...parts.roles.map((r) => ({ value: `role:${r.key}` as const, label: `角色：${r.name}` })),
            ...parts.fields
              .filter((f) => f.dataType === "user" || f.dataType === "singleUser")
              .map((f) => ({ value: `field:${f.key}` as const, label: `字段：${f.name}` })),
            ...parts.nodes.map((n) => ({ value: `node:${n.key}` as const, label: `节点负责人：${n.name}` })),
            ...memberList.map((m) => ({ value: `user:${m.userId}` as const, label: m.name })),
          ];
          return (
            <fieldset
              // biome-ignore lint/suspicious/noArrayIndexKey: 动作没有自己的 id，按位置编辑
              key={i}
              aria-label={`${prefix}动作 ${i + 1}`}
              className="grid grid-cols-3 items-end gap-3 rounded-md border border-line-subtle p-3"
            >
              <Field label="作用于">
                <Select
                  value={action.target?.relation ?? ""}
                  onChange={(e) => {
                    const relation = e.target.value;
                    const target = relation ? { relation, condition: null } : null;
                    const nextParts = relation ? partsOf(otherEnd(relation)) : self;
                    const keep = actionTypesFor(nextParts, !!relation).includes(action.type) ? action.type : "setField";
                    update(i, newAction(keep, nextParts, target));
                  }}
                >
                  <option value="">触发的工作项</option>
                  {self.relations.map((r) => (
                    <option key={r.def.id} value={r.def.id}>
                      {`关联「${r.name}」的工作项${partsOf(r.otherTypeId).type && "foreign" in (partsOf(r.otherTypeId).type ?? {}) ? "（跨空间）" : ""}`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="动作类型">
                <Select
                  value={action.type}
                  onChange={(e) =>
                    update(i, newAction(e.target.value as AutomationAction["type"], parts, action.target))
                  }
                >
                  {kinds.map((t) => (
                    <option key={t} value={t}>
                      {ACTION_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <span />
              {action.target && (
                <div className="col-span-3">
                  <ConditionEditor
                    label="只作用于满足条件的关联工作项（不加表示全部）"
                    value={action.target.condition ?? undefined}
                    fields={parts.fields}
                    onChange={(c) =>
                      update(i, {
                        ...action,
                        target: { relation: action.target?.relation ?? "", condition: c ?? null },
                      })
                    }
                  />
                </div>
              )}
              {action.type === "setField" && (
                <>
                  <Field label="字段">
                    <Select
                      value={action.field}
                      onChange={(e) => update(i, { ...action, field: e.target.value, value: "" })}
                    >
                      {fieldOptions}
                    </Select>
                  </Field>
                  <Field label="取值方式">
                    <Select
                      value={action.copy ? "copy" : "fixed"}
                      onChange={(e) =>
                        update(i, {
                          ...action,
                          value: "",
                          copy:
                            e.target.value === "copy"
                              ? { relation: null, field: action.target ? action.field : (fields[0]?.key ?? "") }
                              : null,
                        })
                      }
                    >
                      <option value="fixed">固定值</option>
                      <option value="copy">同步为别的工作项的字段</option>
                    </Select>
                  </Field>
                  {action.copy ? (
                    <div className="col-span-3 grid grid-cols-3 gap-3">
                      {sourceSelect(action.copy, (copy) => update(i, { ...action, copy }), "field")}
                    </div>
                  ) : (
                    <Field label="设为">
                      {valueInput(
                        parts.fields.find((f) => f.key === action.field),
                        "设为",
                        action.value,
                        (value) => update(i, { ...action, value }),
                      )}
                    </Field>
                  )}
                </>
              )}
              {action.type === "setRole" && (
                <>
                  <Field label="角色">
                    <Select value={action.role} onChange={(e) => update(i, { ...action, role: e.target.value })}>
                      {options(parts.roles)}
                    </Select>
                  </Field>
                  <Field label="取值方式">
                    <Select
                      value={action.copy ? "copy" : "fixed"}
                      onChange={(e) =>
                        update(i, {
                          ...action,
                          userIds: [],
                          copy: e.target.value === "copy" ? { relation: null, field: self.roles[0]?.key ?? "" } : null,
                        })
                      }
                    >
                      <option value="fixed">指定成员</option>
                      <option value="copy">同步为别的工作项的角色</option>
                    </Select>
                  </Field>
                  {action.copy ? (
                    <div className="col-span-3 grid grid-cols-3 gap-3">
                      {sourceSelect(action.copy, (copy) => update(i, { ...action, copy }), "role")}
                    </div>
                  ) : (
                    <div className="col-span-3">
                      <MemberChecks
                        members={memberList}
                        selected={action.userIds}
                        onChange={(userIds) => update(i, { ...action, userIds })}
                      />
                    </div>
                  )}
                </>
              )}
              {action.type === "confirmNode" && (
                <Field label="节点">
                  <Select value={action.node} onChange={(e) => update(i, { ...action, node: e.target.value })}>
                    {nodeOptions}
                  </Select>
                </Field>
              )}
              {action.type === "transitionStatus" && (
                <Field label="流转到">
                  <Select value={action.to} onChange={(e) => update(i, { ...action, to: e.target.value })}>
                    {options(parts.statuses)}
                  </Select>
                </Field>
              )}
              {action.type === "terminate" && (
                <Field label="终止原因">
                  <Input
                    value={action.reason ?? ""}
                    onChange={(e) => update(i, { ...action, reason: e.target.value })}
                  />
                </Field>
              )}
              {action.type === "addComment" && (
                <Field label="评论内容">
                  <Input value={action.body} onChange={(e) => update(i, { ...action, body: e.target.value })} />
                </Field>
              )}
              {action.type === "createTask" && (
                <>
                  <Field label="节点">
                    <Select value={action.node} onChange={(e) => update(i, { ...action, node: e.target.value })}>
                      {nodeOptions}
                    </Select>
                  </Field>
                  <Field label="子任务名称">
                    <Input value={action.name} onChange={(e) => update(i, { ...action, name: e.target.value })} />
                  </Field>
                  <Field label="负责人">
                    <Select
                      value={action.assigneeId ?? ""}
                      onChange={(e) => update(i, { ...action, assigneeId: e.target.value || null })}
                    >
                      <option value="">不指定</option>
                      {memberOptions}
                    </Select>
                  </Field>
                </>
              )}
              {action.type === "createWorkItem" &&
                (() => {
                  const created = partsOf(action.typeId);
                  const rows = action.fields ?? [];
                  const setRows = (next: NewItemField[]) => update(i, { ...action, fields: next });
                  return (
                    <>
                      <Field label="新工作项类型">
                        <Select
                          value={action.typeId}
                          onChange={(e) =>
                            update(i, { ...action, typeId: e.target.value, relationDefId: null, fields: [] })
                          }
                        >
                          {ready
                            .filter((t) => !("foreign" in t))
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                        </Select>
                      </Field>
                      <Field label="新工作项名称">
                        <Input value={action.name} onChange={(e) => update(i, { ...action, name: e.target.value })} />
                      </Field>
                      <Field label="关联方式">
                        <Select
                          value={action.relationDefId ?? ""}
                          onChange={(e) => update(i, { ...action, relationDefId: e.target.value || null })}
                        >
                          <option value="">不关联</option>
                          {self.relations
                            .filter((r) => r.otherTypeId === action.typeId)
                            .map((r) => (
                              <option key={r.def.id} value={r.def.id}>
                                {r.name}
                              </option>
                            ))}
                        </Select>
                      </Field>
                      <fieldset aria-label="新工作项的字段值" className="col-span-3 flex flex-col gap-2">
                        <legend className="mb-1 text-sm font-medium">新工作项的字段值</legend>
                        {rows.map((row, ri) => {
                          const setRow = (next: NewItemField) => setRows(rows.map((r, j) => (j === ri ? next : r)));
                          return (
                            <fieldset
                              // biome-ignore lint/suspicious/noArrayIndexKey: 按位置编辑
                              key={ri}
                              aria-label={`字段值 ${ri + 1}`}
                              className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2"
                            >
                              <Field label="新工作项的字段">
                                <Select
                                  value={row.field}
                                  onChange={(e) => setRow({ field: e.target.value, value: "" })}
                                >
                                  {options(created.fields)}
                                </Select>
                              </Field>
                              <Field label="取值">
                                <Select
                                  value={row.from != null ? "copy" : "fixed"}
                                  onChange={(e) =>
                                    setRow(
                                      e.target.value === "copy"
                                        ? {
                                            field: row.field,
                                            from: fields.find((f) => f.key === row.field)?.key ?? fields[0]?.key ?? "",
                                          }
                                        : { field: row.field, value: "" },
                                    )
                                  }
                                >
                                  <option value="fixed">固定值</option>
                                  <option value="copy">拷触发工作项的字段</option>
                                </Select>
                              </Field>
                              {row.from != null ? (
                                <Field label="触发工作项的字段">
                                  <Select value={row.from} onChange={(e) => setRow({ ...row, from: e.target.value })}>
                                    {options(fields)}
                                  </Select>
                                </Field>
                              ) : (
                                <Field label="值">
                                  {valueInput(
                                    created.fields.find((f) => f.key === row.field),
                                    "值",
                                    row.value,
                                    (value) => setRow({ ...row, value }),
                                  )}
                                </Field>
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                aria-label={`移除字段值 ${ri + 1}`}
                                onClick={() => setRows(rows.filter((_, j) => j !== ri))}
                              >
                                <X />
                              </Button>
                            </fieldset>
                          );
                        })}
                        <Button
                          type="button"
                          variant="ghost"
                          className="self-start"
                          onClick={() => setRows([...rows, { field: created.fields[0]?.key ?? "", value: "" }])}
                        >
                          + 字段值
                        </Button>
                      </fieldset>
                    </>
                  );
                })()}
              {action.type === "notify" && (
                <>
                  <Field label="通知内容">
                    <Input value={action.text} onChange={(e) => update(i, { ...action, text: e.target.value })} />
                  </Field>
                  <fieldset aria-label="收件人" className="col-span-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    <legend className="mb-1 text-sm font-medium">收件人</legend>
                    {recipients.map((r) => (
                      <label key={r.value} className="flex items-center gap-1">
                        <Checkbox
                          aria-label={`通知 ${r.label}`}
                          checked={action.to.includes(r.value)}
                          onChange={(e) =>
                            update(i, {
                              ...action,
                              to: e.target.checked ? [...action.to, r.value] : action.to.filter((v) => v !== r.value),
                            })
                          }
                        />
                        {r.label}
                      </label>
                    ))}
                  </fieldset>
                </>
              )}
              {action.type === "httpRequest" &&
                (() => {
                  const headers = action.headers ?? [];
                  const setHeaders = (next: RequestHeader[]) => update(i, { ...action, headers: next });
                  return (
                    <>
                      <Field label="接口地址（POST）" className="col-span-2">
                        <Input value={action.url} onChange={(e) => update(i, { ...action, url: e.target.value })} />
                      </Field>
                      <span />
                      <fieldset aria-label="请求头" className="col-span-3 flex flex-col gap-2">
                        <legend className="mb-1 text-sm font-medium">请求头</legend>
                        {headers.map((h, hi) => (
                          <div
                            // biome-ignore lint/suspicious/noArrayIndexKey: 按位置编辑
                            key={hi}
                            className="grid grid-cols-[1fr_2fr_auto] items-end gap-2"
                          >
                            <Input
                              aria-label={`请求头 ${hi + 1} 名称`}
                              placeholder="Authorization"
                              value={h.name}
                              onChange={(e) =>
                                setHeaders(headers.map((x, j) => (j === hi ? { ...x, name: e.target.value } : x)))
                              }
                            />
                            <Input
                              aria-label={`请求头 ${hi + 1} 的值`}
                              value={h.value}
                              onChange={(e) =>
                                setHeaders(headers.map((x, j) => (j === hi ? { ...x, value: e.target.value } : x)))
                              }
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              aria-label={`移除请求头 ${hi + 1}`}
                              onClick={() => setHeaders(headers.filter((_, j) => j !== hi))}
                            >
                              <X />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          className="self-start"
                          onClick={() => setHeaders([...headers, { name: "", value: "" }])}
                        >
                          + 请求头
                        </Button>
                      </fieldset>
                      <Field label="请求体（不填发标准 JSON）" className="col-span-3">
                        <Textarea
                          rows={4}
                          className="font-mono text-xs"
                          placeholder={'{"text": "「{{name}}」状态：{{status}}"}'}
                          value={action.body ?? ""}
                          onChange={(e) => update(i, { ...action, body: e.target.value })}
                        />
                      </Field>
                      <p className="col-span-3 text-xs text-fg-subtle">
                        规则执行成功后在后台发出，失败会在 10 秒到 13 分钟内重试 5 次；不能调用内网地址。标准 JSON
                        包含规则、事件、工作项和它的全部字段值。
                      </p>
                    </>
                  );
                })()}
              <Button
                type="button"
                variant="outline"
                className="col-start-3 justify-self-end"
                onClick={() => setList(list.filter((_, j) => j !== i))}
              >
                移除动作
              </Button>
            </fieldset>
          );
        })}
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => setList([...list, newAction("setField", self)])}
        >
          {prefix ? `给${prefix}添加动作` : "添加动作"}
        </Button>
      </div>
    );
  }

  const clean = (list: AutomationAction[]) =>
    list.map((a) => {
      if (a.type === "setField" && a.value === "") return { ...a, value: null };
      if (a.type === "createWorkItem")
        return {
          ...a,
          fields: (a.fields ?? []).map((f) => (f.from == null && f.value === "" ? { ...f, value: null } : f)),
        };
      if (a.type === "httpRequest")
        return { ...a, headers: (a.headers ?? []).filter((h) => h.name.trim()), body: a.body?.trim() ? a.body : null };
      return a;
    });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = {
      name,
      trigger: { ...trigger, typeId: type?.id } as AutomationTrigger,
      condition: condition ?? null,
      actions: clean(actions),
      branches: condition ? branches.map((b) => ({ condition: b.condition ?? null, actions: clean(b.actions) })) : [],
    };
    const ok = await onSubmit(
      initial
        ? mutators.automation.update({ id: initial.id, enabled: initial.enabled ?? true, ...body })
        : mutators.automation.create({ id: newId(), spaceId, ...body }),
    );
    if (ok && !initial) {
      setName("");
      setCondition(undefined);
      setActions([]);
      setBranches([]);
    }
  }

  const fieldOptions = options(fields);
  const nodeOptions = options(nodes);
  const statusOptions = options(statuses);
  const roleOptions = options(type.roles);
  void userFields;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initial ? `编辑规则「${initial.name}」` : "新建规则"}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="规则名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="工作项类型">
              <Select
                value={type.id}
                onChange={(e) => {
                  setTypeId(e.target.value);
                  setTrigger({ kind: "workItemCreated" });
                  setCondition(undefined);
                  setActions([]);
                  setBranches([]);
                }}
              >
                {ready.map((t) => (
                  <option key={t.id} value={t.id}>
                    {"foreign" in t ? `${t.name}（跨空间）` : t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="触发时机">
              <Select value={trigger.kind} onChange={(e) => setKind(e.target.value as AutomationTrigger["kind"])}>
                {triggerKinds.map((k) => (
                  <option key={k} value={k}>
                    {TRIGGER_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            {isNodeTrigger(trigger.kind) && (
              <Field label="触发节点">
                <Select
                  value={(trigger as { node?: string }).node ?? ""}
                  onChange={(e) => setTrigger({ ...trigger, node: e.target.value || undefined } as AutomationTrigger)}
                >
                  <option value="">任意节点</option>
                  {nodeOptions}
                </Select>
              </Field>
            )}
            {trigger.kind === "fieldChanged" && (
              <Field label="触发字段">
                <Select value={trigger.field} onChange={(e) => setTrigger({ ...trigger, field: e.target.value })}>
                  {fieldOptions}
                </Select>
              </Field>
            )}
            {trigger.kind === "roleChanged" && (
              <Field label="触发角色">
                <Select
                  value={trigger.role ?? ""}
                  onChange={(e) => setTrigger({ ...trigger, role: e.target.value || undefined })}
                >
                  <option value="">任意角色</option>
                  {roleOptions}
                </Select>
              </Field>
            )}
            {(trigger.kind === "relationAdded" || trigger.kind === "relationRemoved") && (
              <Field label="触发关联">
                <Select
                  value={trigger.relation ?? ""}
                  onChange={(e) => setTrigger({ ...trigger, relation: e.target.value || undefined })}
                >
                  <option value="">任意关联</option>
                  {self.relations.map((r) => (
                    <option key={r.def.id} value={r.def.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
          {"foreign" in type && (
            <p className="text-xs text-fg-subtle">
              跨空间自动化：这个类型在别的空间，那里的工作项发生变化时触发这条规则。保存需要你同时是两个空间的管理员。
            </p>
          )}
          {trigger.kind === "manual" && (
            <p className="text-xs text-fg-subtle">保存后在规则列表里选一个工作项运行，可以用来测试规则或批量补数据。</p>
          )}
          {trigger.kind === "schedule" && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-3">
                <Field label="频率">
                  <Select
                    value={trigger.frequency}
                    onChange={(e) =>
                      setTrigger({
                        ...trigger,
                        frequency: e.target.value as "day" | "week" | "month",
                        weekdays: e.target.value === "week" ? [1] : undefined,
                        monthDays: e.target.value === "month" ? [1] : undefined,
                      })
                    }
                  >
                    <option value="day">每天</option>
                    <option value="week">每周</option>
                    <option value="month">每月</option>
                  </Select>
                </Field>
                <Field label={`每隔几${FREQUENCY_UNIT[trigger.frequency]}`}>
                  <Input
                    type="number"
                    min={1}
                    value={trigger.every ?? 1}
                    onChange={(e) => {
                      const every = Math.max(1, Math.floor(Number(e.target.value) || 1));
                      setTrigger({ ...trigger, every: every > 1 ? every : undefined });
                    }}
                  />
                </Field>
                <Field label="时间">
                  <Select
                    value={String(trigger.hour)}
                    onChange={(e) => setTrigger({ ...trigger, hour: Number(e.target.value) })}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={String(h)}>{`${String(h).padStart(2, "0")}:00`}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="生效开始日">
                  <Input
                    type="date"
                    value={trigger.startDate ?? ""}
                    onChange={(e) => setTrigger({ ...trigger, startDate: e.target.value || undefined })}
                  />
                </Field>
                <Field label="生效结束日">
                  <Input
                    type="date"
                    value={trigger.endDate ?? ""}
                    onChange={(e) => setTrigger({ ...trigger, endDate: e.target.value || undefined })}
                  />
                </Field>
              </div>
              {trigger.frequency === "week" && (
                <fieldset aria-label="每周哪几天" className="flex flex-wrap gap-3 text-sm">
                  {WEEKDAYS.map((label, d) => (
                    <label key={label} className="flex items-center gap-1">
                      <Checkbox
                        checked={trigger.weekdays?.includes(d) ?? false}
                        onChange={(e) =>
                          setTrigger({
                            ...trigger,
                            weekdays: e.target.checked
                              ? [...(trigger.weekdays ?? []), d].sort()
                              : (trigger.weekdays ?? []).filter((x) => x !== d),
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              )}
              {trigger.frequency === "month" && (
                <Field label="每月几号（逗号分隔）">
                  <Input
                    defaultValue={(trigger.monthDays ?? []).join(",")}
                    onChange={(e) =>
                      setTrigger({
                        ...trigger,
                        monthDays: e.target.value
                          .split(/[,，\s]+/)
                          .map(Number)
                          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31),
                      })
                    }
                  />
                </Field>
              )}
              <p className="text-xs text-fg-subtle">
                按空间时区，在选中的时间对这个类型里每个没终止的工作项检查一次执行条件，满足就执行。隔几周、几个月从生效开始日算起。
              </p>
            </div>
          )}
          {trigger.kind === "dateReached" && (
            <div className="grid grid-cols-4 gap-3">
              <Field label="按哪个日期">
                <Select value={trigger.date} onChange={(e) => setTrigger({ ...trigger, date: e.target.value })}>
                  {dateSources.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="什么时候">
                <Select
                  value={trigger.when}
                  onChange={(e) => {
                    const when = e.target.value as "before" | "on" | "after";
                    setTrigger({ ...trigger, when, days: when === "on" ? 0 : Math.max(trigger.days, 1) });
                  }}
                >
                  {Object.entries(WHEN_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              {trigger.when !== "on" && (
                <Field label="天数">
                  <Input
                    type="number"
                    min={1}
                    value={trigger.days}
                    onChange={(e) => setTrigger({ ...trigger, days: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </Field>
              )}
              <Field label="时间">
                <Select
                  value={String(trigger.hour)}
                  onChange={(e) => setTrigger({ ...trigger, hour: Number(e.target.value) })}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={String(h)}>{`${String(h).padStart(2, "0")}:00`}</option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          {trigger.kind === "statusChanged" && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="原状态">
                <Select
                  value={trigger.from ?? ""}
                  onChange={(e) => setTrigger({ ...trigger, from: e.target.value || undefined })}
                >
                  <option value="">任意状态</option>
                  {statusOptions}
                </Select>
              </Field>
              <Field label="新状态">
                <Select
                  value={trigger.to ?? ""}
                  onChange={(e) => setTrigger({ ...trigger, to: e.target.value || undefined })}
                >
                  <option value="">任意状态</option>
                  {statusOptions}
                </Select>
              </Field>
            </div>
          )}

          <ConditionEditor
            label="执行条件（不加表示总是执行）"
            value={condition}
            fields={fields}
            onChange={setCondition}
          />

          <div className="flex flex-col gap-3">
            <h4 className="text-sm font-medium text-fg">动作</h4>
            <p className="text-xs text-fg-subtle">
              文本里可以写 {"{{name}}"}（名称）、{"{{id}}"}、{"{{status}}"}、{"{{field:字段 key}}"}
              ，执行时换成触发工作项的值（作用到关联工作项上时也是）。
              动作可以作用到关联的工作项上（包括别的空间的），以规则创建人的身份执行。
            </p>
            {renderActions(actions, setActions)}
          </div>

          {(condition || branches.length > 0) && (
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-medium text-fg">条件分支</h4>
              <p className="text-xs text-fg-subtle">
                执行条件不满足时，按顺序找第一个条件满足的分支执行；分支不加条件就是「否则」。
              </p>
              {branches.map((branch, bi) => (
                <section
                  // biome-ignore lint/suspicious/noArrayIndexKey: 分支没有自己的 id，按位置编辑
                  key={bi}
                  aria-label={`分支 ${bi + 1}`}
                  className="flex flex-col gap-3 rounded-md border border-dashed border-line p-3"
                >
                  <div className="flex items-center justify-between">
                    <h5 className="text-sm font-medium">{`分支 ${bi + 1}`}</h5>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setBranches(branches.filter((_, j) => j !== bi))}
                    >
                      删除分支
                    </Button>
                  </div>
                  <ConditionEditor
                    label="分支条件（不加表示否则）"
                    value={branch.condition ?? undefined}
                    fields={fields}
                    onChange={(c) =>
                      setBranches(branches.map((x, j) => (j === bi ? { ...x, condition: c ?? null } : x)))
                    }
                  />
                  {renderActions(
                    branch.actions,
                    (next) => setBranches(branches.map((x, j) => (j === bi ? { ...x, actions: next } : x))),
                    `分支 ${bi + 1} `,
                  )}
                </section>
              ))}
              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => setBranches([...branches, { condition: null, actions: [] }])}
              >
                添加分支
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            <Button type="submit">保存规则</Button>
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                取消
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function MemberChecks({
  members,
  selected,
  onChange,
}: {
  members: Member[];
  selected: readonly string[];
  onChange: (userIds: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {members.map((m) => (
        <label key={m.userId} className="flex items-center gap-1">
          <Checkbox
            checked={selected.includes(m.userId)}
            onChange={(e) =>
              onChange(e.target.checked ? [...selected, m.userId] : selected.filter((u) => u !== m.userId))
            }
          />
          {m.name}
        </label>
      ))}
    </div>
  );
}
