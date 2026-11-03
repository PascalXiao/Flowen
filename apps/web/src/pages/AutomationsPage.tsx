import {
  type AutomationAction,
  type AutomationRecipient,
  type AutomationTrigger,
  type Condition,
  type FlowDefinition,
  formatFieldValue,
  NODE_TRIGGERS,
  nodeFlowOf,
  type StatusFlowDefinition,
  statusFlowOf,
} from "@fp/engine";
import { mutators, queries } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { type FormEvent, type ReactNode, useState } from "react";
import { ConditionEditor } from "@/components/ConditionEditor";
import { FieldInput } from "@/components/FieldInput";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Label, Select } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";
import { newId } from "@/lib/utils";

type Space = NonNullable<QueryResultType<ReturnType<typeof queries.spaces.byId>>>;
type ItemType = Space["workItemTypes"][number];
type Rule = QueryResultType<ReturnType<typeof queries.automations.bySpace>>[number];

const TRIGGER_LABEL: Record<AutomationTrigger["kind"], string> = {
  workItemCreated: "工作项创建后",
  workItemCompleted: "工作项完成时",
  workItemTerminated: "工作项终止时",
  workItemRestored: "工作项恢复时",
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
  taskDone: "子任务完成时",
};
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
};
const RUN_LABEL: Record<string, string> = { succeeded: "成功", failed: "失败", running: "执行中", skipped: "跳过" };
const isNodeTrigger = (kind: string) => (NODE_TRIGGERS as readonly string[]).includes(kind);

/** 类型当前发布的流程版本定义（取第一个有发布版本的模板）。 */
function definitionOf(type: ItemType | undefined): unknown {
  return type?.flowTemplates.find((t) => t.currentVersion)?.currentVersion?.definition;
}
/** 类型当前发布的节点流。 */
const flowOf = (type: ItemType | undefined): FlowDefinition | null => nodeFlowOf(definitionOf(type));
/** 类型当前发布的状态流。 */
const statusFlow = (type: ItemType | undefined): StatusFlowDefinition | null => statusFlowOf(definitionOf(type));

/** 名字查找：节点、状态、字段、角色、关联、类型、成员。规则描述和表单都用。 */
function namesFor(type: ItemType | undefined, types: ItemType[], members: Map<string, string>) {
  const defs = types.flatMap((t) => t.relationDefs);
  return {
    node: (key: string) => flowOf(type)?.nodes.find((n) => n.key === key)?.name ?? key,
    status: (key: string) => statusFlow(type)?.statuses.find((s) => s.key === key)?.name ?? key,
    field: (key: string) => type?.fields.find((f) => f.key === key)?.name ?? key,
    role: (key: string) => type?.roles.find((r) => r.key === key)?.name ?? key,
    relation: (id: string) => defs.find((d) => d.id === id)?.name ?? "已删除的关联",
    type: (id: string) => types.find((t) => t.id === id)?.name ?? "已删除的类型",
    user: (id: string) => members.get(id) ?? id,
  };
}

/** 收件人的显示名。 */
function recipientName(r: AutomationRecipient, names: ReturnType<typeof namesFor>): string {
  if (r === "creator") return "创建人";
  if (r === "actor") return "触发人";
  if (r.startsWith("role:")) return `角色「${names.role(r.slice(5))}」`;
  if (r.startsWith("field:")) return `「${names.field(r.slice(6))}」里的人`;
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
function describeTrigger(trigger: AutomationTrigger, names: ReturnType<typeof namesFor>): string {
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
    case "relationAdded":
    case "relationRemoved":
      return trigger.relation
        ? `${trigger.kind === "relationAdded" ? "关联" : "解除关联"}「${names.relation(trigger.relation)}」时`
        : label;
    default: {
      const node = (trigger as { node?: string }).node;
      return node && isNodeTrigger(trigger.kind) ? `「${names.node(node)}」${label.replace(/^节点/, "")}` : label;
    }
  }
}

/** 一个动作的一句话描述。 */
function describeAction(
  a: AutomationAction,
  names: ReturnType<typeof namesFor>,
  show: (key: string, value: unknown) => string,
): string {
  switch (a.type) {
    case "setField":
      return `把「${names.field(a.field)}」设为 ${show(a.field, a.value) || "空"}`;
    case "setRole":
      return `把「${names.role(a.role)}」设为 ${a.userIds.map(names.user).join("、") || "无人"}`;
    case "confirmNode":
      return `完成「${names.node(a.node)}」`;
    case "transitionStatus":
      return `流转到「${names.status(a.to)}」`;
    case "terminate":
      return a.reason ? `终止工作项（${a.reason}）` : "终止工作项";
    case "restore":
      return "恢复工作项";
    case "addComment":
      return `评论「${a.body}」`;
    case "createTask":
      return `在「${names.node(a.node)}」新建子任务「${a.name}」${a.assigneeId ? `给 ${names.user(a.assigneeId)}` : ""}`;
    case "createWorkItem":
      return `新建${names.type(a.typeId)}「${a.name}」${a.relationDefId ? `并按「${names.relation(a.relationDefId)}」关联` : ""}`;
    case "notify":
      return `通知${a.to.map((r) => recipientName(r, names)).join("、")}：${a.text}`;
  }
}

/** 规则的一句话描述，列表里用。 */
function describeRule(rule: Rule, types: ItemType[], members: Map<string, string>): string {
  const trigger = rule.trigger as AutomationTrigger;
  const type = types.find((t) => t.id === trigger.typeId);
  const names = namesFor(type, types, members);
  const condition = rule.conditions as Condition | null;
  const fieldOf = (key: string) => type?.fields.find((f) => f.key === key);
  const show = (key: string, value: unknown) => {
    const f = fieldOf(key);
    return f ? formatFieldValue(f, value, names.user) : String(value);
  };
  const given = condition ? `，且${describeCondition(condition, names.field, show)}` : "";
  const then = (rule.actions as AutomationAction[]).map((a) => describeAction(a, names, show)).join("；");
  return `${type ? `${type.name}：` : ""}${describeTrigger(trigger, names)}${given}，${then}`;
}

/** 空间配置里的「自动化」页签：规则列表、启用停用、执行记录，以及新建规则的表单。只有管理员能改。 */
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
  const types = [...space.workItemTypes];
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

  return (
    <>
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Card>
        <CardHeader>
          <CardTitle>规则</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rules.length === 0 && <p className="text-sm text-fg-muted">还没有自动化规则。</p>}
          {rules.map((rule) => (
            <section key={rule.id} aria-label={rule.name} className="rounded-md border border-line-subtle p-3">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <h3 className="text-sm font-medium">{rule.name}</h3>
                  <p className="text-sm text-fg-muted">{describeRule(rule, types, members)}</p>
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
                              trigger: rule.trigger as AutomationTrigger,
                              condition: rule.conditions as Condition | null,
                              actions: rule.actions as AutomationAction[],
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
              {editing === rule.id && (
                <div className="mt-3">
                  <RuleForm
                    spaceId={spaceId}
                    types={types}
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
                <ul aria-label="执行记录" className="mt-2 flex flex-col gap-1 border-t border-line-subtle pt-2 text-xs">
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
            </section>
          ))}
        </CardContent>
      </Card>

      {isAdmin && <RuleForm spaceId={spaceId} types={types} members={members} onSubmit={run} />}
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Label className="flex flex-col gap-1.5">
      {label}
      {children}
    </Label>
  );
}

type Member = { userId: string; name: string };

function RuleForm({
  spaceId,
  types,
  members,
  initial,
  onSubmit,
  onCancel,
}: {
  spaceId: string;
  types: ItemType[];
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

  const type = ready.find((t) => t.id === typeId) ?? ready[0];
  if (!type) return <p className="text-sm text-fg-muted">先给空间配置一个有已发布流程的工作项类型。</p>;
  const nodes = flowOf(type)?.nodes ?? [];
  const statuses = statusFlow(type)?.statuses ?? [];
  const fields = type.fields;
  const userFields = fields.filter((f) => f.dataType === "user" || f.dataType === "singleUser");
  const memberList: Member[] = [...members].map(([userId, memberName]) => ({ userId, name: memberName }));
  const allDefs = types.flatMap((t) => t.relationDefs);
  // 节点流类型没有状态，状态流类型没有节点：只列这个类型用得上的触发器和动作
  const triggerKinds = (Object.keys(TRIGGER_LABEL) as AutomationTrigger["kind"][]).filter((k) =>
    statuses.length ? !isNodeTrigger(k) : k !== "statusChanged",
  );
  const actionTypes = (Object.keys(ACTION_LABEL) as AutomationAction["type"][]).filter((t) =>
    statuses.length ? t !== "confirmNode" && t !== "createTask" : t !== "transitionStatus",
  );

  function setKind(kind: AutomationTrigger["kind"]) {
    if (kind === "fieldChanged") setTrigger({ kind, field: fields[0]?.key ?? "" });
    else setTrigger({ kind } as AutomationTrigger);
  }

  function newAction(kind: AutomationAction["type"]): AutomationAction {
    switch (kind) {
      case "setField":
        return { type: kind, field: fields[0]?.key ?? "", value: "" };
      case "setRole":
        return { type: kind, role: type?.roles[0]?.key ?? "", userIds: [] };
      case "confirmNode":
        return { type: kind, node: nodes[0]?.key ?? "" };
      case "transitionStatus":
        return { type: kind, to: statuses[0]?.key ?? "" };
      case "terminate":
        return { type: kind, reason: "" };
      case "restore":
        return { type: kind };
      case "addComment":
        return { type: kind, body: "" };
      case "createTask":
        return { type: kind, node: nodes[0]?.key ?? "", name: "", assigneeId: null };
      case "createWorkItem":
        return { type: kind, typeId: type?.id ?? "", name: "{{name}} 的跟进", relationDefId: null };
      case "notify":
        return { type: kind, to: [], text: "「{{name}}」" };
    }
  }
  const updateAction = (i: number, next: AutomationAction) =>
    setActions((prev) => prev.map((a, j) => (j === i ? next : a)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = {
      name,
      trigger: { ...trigger, typeId: type?.id } as AutomationTrigger,
      condition: condition ?? null,
      actions: actions.map((a) => (a.type === "setField" && a.value === "" ? { ...a, value: null } : a)),
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
    }
  }

  const options = (items: readonly { key: string; name: string }[]) =>
    items.map((i) => (
      <option key={i.key} value={i.key}>
        {i.name}
      </option>
    ));
  const fieldOptions = options(fields);
  const nodeOptions = options(nodes);
  const statusOptions = options(statuses);
  const roleOptions = options(type.roles);
  const memberOptions = memberList.map((m) => (
    <option key={m.userId} value={m.userId}>
      {m.name}
    </option>
  ));
  const recipients: { value: AutomationRecipient; label: string }[] = [
    { value: "creator", label: "创建人" },
    { value: "actor", label: "触发人" },
    ...type.roles.map((r) => ({ value: `role:${r.key}` as const, label: `角色：${r.name}` })),
    ...userFields.map((f) => ({ value: `field:${f.key}` as const, label: `字段：${f.name}` })),
    ...memberList.map((m) => ({ value: `user:${m.userId}` as const, label: m.name })),
  ];

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
                }}
              >
                {ready.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
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
                  {type.relationDefs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
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
            <p className="text-xs text-fg-subtle">文本里写 {"{{name}}"} 会换成触发的工作项名称。</p>
            {actions.map((action, i) => (
              <fieldset
                // biome-ignore lint/suspicious/noArrayIndexKey: 动作没有自己的 id，按位置编辑
                key={i}
                aria-label={`动作 ${i + 1}`}
                className="grid grid-cols-3 items-end gap-3 rounded-md border border-line-subtle p-3"
              >
                <Field label="动作类型">
                  <Select
                    value={action.type}
                    onChange={(e) => updateAction(i, newAction(e.target.value as AutomationAction["type"]))}
                  >
                    {actionTypes.map((t) => (
                      <option key={t} value={t}>
                        {ACTION_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {action.type === "setField" && (
                  <>
                    <Field label="字段">
                      <Select
                        value={action.field}
                        onChange={(e) => updateAction(i, { ...action, field: e.target.value, value: "" })}
                      >
                        {fieldOptions}
                      </Select>
                    </Field>
                    <Field label="设为">
                      {(() => {
                        const target = fields.find((f) => f.key === action.field);
                        return target ? (
                          <FieldInput
                            field={target}
                            label="设为"
                            value={action.value}
                            members={memberList}
                            live
                            // 自动化里不能设字段组，值总是简单值
                            onChange={(value) => updateAction(i, { ...action, value: value as typeof action.value })}
                          />
                        ) : null;
                      })()}
                    </Field>
                  </>
                )}
                {action.type === "setRole" && (
                  <>
                    <Field label="角色">
                      <Select
                        value={action.role}
                        onChange={(e) => updateAction(i, { ...action, role: e.target.value })}
                      >
                        {roleOptions}
                      </Select>
                    </Field>
                    <MemberChecks
                      members={memberList}
                      selected={action.userIds}
                      onChange={(userIds) => updateAction(i, { ...action, userIds })}
                    />
                  </>
                )}
                {action.type === "confirmNode" && (
                  <Field label="节点">
                    <Select value={action.node} onChange={(e) => updateAction(i, { ...action, node: e.target.value })}>
                      {nodeOptions}
                    </Select>
                  </Field>
                )}
                {action.type === "transitionStatus" && (
                  <Field label="流转到">
                    <Select value={action.to} onChange={(e) => updateAction(i, { ...action, to: e.target.value })}>
                      {statusOptions}
                    </Select>
                  </Field>
                )}
                {action.type === "terminate" && (
                  <Field label="终止原因">
                    <Input
                      value={action.reason ?? ""}
                      onChange={(e) => updateAction(i, { ...action, reason: e.target.value })}
                    />
                  </Field>
                )}
                {action.type === "addComment" && (
                  <Field label="评论内容">
                    <Input value={action.body} onChange={(e) => updateAction(i, { ...action, body: e.target.value })} />
                  </Field>
                )}
                {action.type === "createTask" && (
                  <>
                    <Field label="节点">
                      <Select
                        value={action.node}
                        onChange={(e) => updateAction(i, { ...action, node: e.target.value })}
                      >
                        {nodeOptions}
                      </Select>
                    </Field>
                    <Field label="子任务名称">
                      <Input
                        value={action.name}
                        onChange={(e) => updateAction(i, { ...action, name: e.target.value })}
                      />
                    </Field>
                    <Field label="负责人">
                      <Select
                        value={action.assigneeId ?? ""}
                        onChange={(e) => updateAction(i, { ...action, assigneeId: e.target.value || null })}
                      >
                        <option value="">不指定</option>
                        {memberOptions}
                      </Select>
                    </Field>
                  </>
                )}
                {action.type === "createWorkItem" && (
                  <>
                    <Field label="新工作项类型">
                      <Select
                        value={action.typeId}
                        onChange={(e) => updateAction(i, { ...action, typeId: e.target.value, relationDefId: null })}
                      >
                        {ready.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="新工作项名称">
                      <Input
                        value={action.name}
                        onChange={(e) => updateAction(i, { ...action, name: e.target.value })}
                      />
                    </Field>
                    <Field label="关联方式">
                      <Select
                        value={action.relationDefId ?? ""}
                        onChange={(e) => updateAction(i, { ...action, relationDefId: e.target.value || null })}
                      >
                        <option value="">不关联</option>
                        {allDefs
                          .filter(
                            (d) =>
                              (d.fromTypeId === type.id && d.toTypeId === action.typeId) ||
                              (d.toTypeId === type.id && d.fromTypeId === action.typeId),
                          )
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.fromTypeId === type.id ? d.name : (d.reverseName ?? d.name)}
                            </option>
                          ))}
                      </Select>
                    </Field>
                  </>
                )}
                {action.type === "notify" && (
                  <>
                    <Field label="通知内容">
                      <Input
                        value={action.text}
                        onChange={(e) => updateAction(i, { ...action, text: e.target.value })}
                      />
                    </Field>
                    <fieldset aria-label="收件人" className="col-span-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                      <legend className="mb-1 text-sm font-medium">收件人</legend>
                      {recipients.map((r) => (
                        <label key={r.value} className="flex items-center gap-1">
                          <Checkbox
                            aria-label={`通知 ${r.label}`}
                            checked={action.to.includes(r.value)}
                            onChange={(e) =>
                              updateAction(i, {
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
                <Button
                  type="button"
                  variant="outline"
                  className="col-start-3 justify-self-end"
                  onClick={() => setActions((prev) => prev.filter((_, j) => j !== i))}
                >
                  移除动作
                </Button>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => setActions((prev) => [...prev, newAction("setField")])}
            >
              添加动作
            </Button>
          </div>

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
