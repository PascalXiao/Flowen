import {
  availableOptions,
  canEditRoleMembers,
  conditionView,
  type Day,
  dayFromIso,
  dayInTimeZone,
  dayToIso,
  evaluate,
  type FieldDataType,
  FlowGraph,
  fieldStates,
  formatFieldValue,
  type LayoutItem,
  type LayoutSection,
  type NodeState,
  nodeFlowOf,
  resolveLayout,
  roleAppears,
  roleRemovable,
  type StatusActor,
  StatusFlow,
  type StatusFlowDefinition,
  statusFlowOf,
  WorkCalendar,
} from "@fp/engine";
import { fieldViewRoles, hasAnyRole, mutators, queries } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, Navigate, useNavigate, useParams } from "@tanstack/react-router";
import { Background, Controls, type Edge, MarkerType, type Node, Position, ReactFlow } from "@xyflow/react";
import { Check, ChevronRight, CircleCheck, CircleDashed, CircleDot, Diamond, Eye, Star, Undo2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ActivityCard } from "@/components/ActivityCard";
import { useActiveSpace } from "@/components/AppShell";
import { AttachmentsCard } from "@/components/AttachmentsCard";
import { CommentsCard } from "@/components/CommentsCard";
import { CompleteNodeDialog, needsCompletionDialog } from "@/components/CompleteNodeDialog";
import { FieldInput, type FieldInputValue, FieldLabel, type FieldMember } from "@/components/FieldInput";
import { GanttChart } from "@/components/GanttChart";
import { NodeTasks } from "@/components/NodeTasks";
import { RelationsCard } from "@/components/RelationsCard";
import { RolePicker, toggled } from "@/components/RolePicker";
import { CATEGORY_LABEL, StatusDiagram } from "@/components/StatusDiagram";
import { SubItems } from "@/components/SubItems";
import { UserChip } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ErrorBanner, Panel } from "@/components/ui/page";
import { Tabs } from "@/components/ui/tabs";
import { StageTag, StatusTag, Tag } from "@/components/ui/tag";
import { layoutByDepth } from "@/flow-demo/layout";
import { withLineOptions } from "@/lib/fields";
import { nodeGanttRows } from "@/lib/gantt";
import { cn, newId } from "@/lib/utils";

/** 流程图节点的样式：进行中蓝色描边，已完成绿色，未开始灰色，被裁剪的虚线。 */
const STATE_STYLE: Record<NodeState, string> = {
  notStarted: "!border-line",
  inProgress: "!border-brand-500 !ring-3 !ring-brand-100",
  completed: "!border-success-500/50",
  skipped: "!border-dashed !border-line !bg-canvas !text-fg-subtle",
};

const STATE_ICON: Record<NodeState, ReactNode> = {
  notStarted: <CircleDashed className="size-4 shrink-0 text-fg-subtle" />,
  inProgress: <CircleDot className="size-4 shrink-0 text-brand-500" />,
  completed: <CircleCheck className="size-4 shrink-0 text-success-600" />,
  skipped: <CircleDashed className="size-4 shrink-0 text-fg-disabled" />,
};

const STATE_LABEL: Record<NodeState, string> = {
  notStarted: "未开始",
  inProgress: "进行中",
  completed: "已完成",
  skipped: "已跳过",
};

export function WorkItemPage() {
  const { itemId } = useParams({ from: "/app/spaces/$spaceId/$typeKey/detail/$itemId" });
  return <WorkItemView itemId={itemId} />;
}

/** 只有工作项 id 的地址：查到它的空间和类型，换成「空间/工作项/detail/id」的地址。 */
export function ItemRedirect() {
  const { itemId } = useParams({ from: "/app/items/$itemId" });
  const [item, result] = useQuery(queries.workItems.byId({ id: itemId }));
  if (item?.type)
    return (
      <Navigate
        to="/spaces/$spaceId/$typeKey/detail/$itemId"
        params={{ spaceId: item.spaceId, typeKey: item.type.key, itemId }}
        replace
      />
    );
  return (
    <p className="p-6 text-sm text-fg-subtle">{result.type === "complete" ? "工作项不存在或没有权限。" : "加载中…"}</p>
  );
}

/** 工作项详情：整页打开，或在列表右侧的抽屉里打开（内容一样）。 */
export function WorkItemView({ itemId }: { itemId: string }) {
  const zero = useZero();
  const [item, result] = useQuery(queries.workItems.byId({ id: itemId }));
  // 空间成员和角色定义：改角色成员时用
  const [space] = useQuery(item ? queries.spaces.byId({ id: item.spaceId }) : undefined);
  const definition = nodeFlowOf(item?.flowVersion?.definition);
  const graph = useMemo(() => (definition ? new FlowGraph(definition) : null), [definition]);
  // 状态流类型的工作项：没有节点，只有状态和流转
  const statusDefinition = statusFlowOf(item?.flowVersion?.definition);
  const calendarConfig = item?.space?.calendar;
  const calendar = useMemo(() => WorkCalendar.fromConfig(calendarConfig), [calendarConfig]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"flow" | "gantt">("flow");
  const [error, setError] = useState<string | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  /** 正在填完成表单的节点。 */
  const [completing, setCompleting] = useState<string | null>(null);
  /** 当前打开的详情页签。 */
  const [tab, setTab] = useState<string | null>(null);
  /** 终止弹窗：选的原因和补充说明。 */
  const [terminating, setTerminating] = useState(false);
  const [abortReason, setAbortReason] = useState("取消，现在先不做了");
  const [abortDetail, setAbortDetail] = useState("");
  /** 复制弹窗：新工作项的名称。 */
  const [copyName, setCopyName] = useState<string | null>(null);
  const navigate = useNavigate();
  useActiveSpace(item?.spaceId);
  // 打开就记一次浏览（列表的「最近浏览」页签用）
  const loaded = !!item;
  useEffect(() => {
    if (loaded) zero.mutate(mutators.mark.visit({ workItemId: itemId }));
  }, [loaded, itemId, zero]);

  if (!item)
    return (
      <p className="p-6 text-sm text-fg-subtle">
        {result.type === "complete" ? "工作项不存在或没有权限。" : "加载中…"}
      </p>
    );

  const me = String(zero.userID);
  const isAdmin = item.space?.members.some((m) => m.role === "admin") ?? false;
  // 访客只能查看和评论；服务端会再校验一遍
  const canWrite = !(item.space?.members.some((m) => m.role === "guest") ?? true);
  const myRoles = item.roleMembers.filter((m) => m.userId === me).map((m) => m.roleKey);
  const states = new Map(item.nodes.map((n) => [n.nodeKey, n]));
  const users = new Map(item.roleMembers.map((m) => [m.userId, m.user?.name ?? m.userId]));
  const roleUsers: Record<string, string[]> = {};
  for (const m of item.roleMembers) roleUsers[m.roleKey] = [...(roleUsers[m.roleKey] ?? []), m.userId];
  const inProgress = graph?.nodes.filter((n) => states.get(n.key)?.state === "inProgress") ?? [];
  const selectedNode = selected ? graph?.nodes.find((n) => n.key === selected) : undefined;
  // 子工作项按驱动的节点分组；上级工作项是指向自己的子工作项关系
  const children = (nodeKey: string) =>
    item.outgoing.flatMap((r) => (r.parentNodeKey === nodeKey && r.to ? [r.to] : []));
  const parent = item.incoming.find((r) => r.parentNodeKey && r.from)?.from;
  const spaceTypes = space?.workItemTypes.map((t) => ({ id: t.id, name: t.name })) ?? [];

  /** 先在浏览器里乐观执行；被拒绝时（本地或服务端）把原因显示出来。 */
  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") return setError(outcome.error.message);
  }
  /** 节点负责人、担任节点可操作角色的人和空间管理员可以回滚、改排期；服务端会再校验一遍。 */
  const canOperate = (nodeKey: string) =>
    canWrite &&
    (isAdmin ||
      (states.get(nodeKey)?.owners ?? []).includes(me) ||
      (graph?.node(nodeKey).operatorRoles ?? []).some((r) => myRoles.includes(r)));
  /** 已到达的节点可以回滚。 */
  const canRollback = (nodeKey: string) => {
    const runtime = states.get(nodeKey);
    const reached = runtime?.state === "completed" || runtime?.state === "inProgress";
    return reached && canOperate(nodeKey);
  };
  const setPlan = (nodeKey: string, start?: Day, end?: Day) =>
    run(
      mutators.node.setPlan({
        workItemId: item.id,
        nodeKey,
        ...(start !== undefined && end !== undefined && { start: dayToIso(start), end: dayToIso(end) }),
      }),
    );
  const canPlan = canOperate;
  // 有完成表单、完成结论或节点字段的节点先弹窗填写
  const confirm = (nodeKey: string) =>
    graph && needsCompletionDialog(graph.node(nodeKey))
      ? setCompleting(nodeKey)
      : run(mutators.node.confirm({ workItemId: item.id, nodeKey }));
  const press = (nodeKey: string, buttonKey: string) =>
    run(mutators.node.press({ workItemId: item.id, nodeKey, buttonKey }));
  /** 节点的结论显示名。 */
  const conclusionLabel = (nodeKey: string) => {
    const value = states.get(nodeKey)?.conclusion;
    return value ? (graph?.node(nodeKey).conclusion?.options.find((o) => o.value === value)?.label ?? value) : null;
  };
  // 模板有了新版本时可以升级（工作项负责人和空间管理员）
  const template = space?.workItemTypes
    .flatMap((t) => t.flowTemplates)
    .find((t) => t.id === item.flowVersion?.templateId);
  const canUpgrade = !!graph && !!template?.currentVersionId && template.currentVersionId !== item.flowVersionId;
  const rollback = (nodeKey: string) => run(mutators.node.rollback({ workItemId: item.id, nodeKey }));
  // 终止、冻结：工作项负责人（担任「是负责人」的角色）和空间管理员
  const ownerRoleKeys = (item.type?.roles ?? []).filter((r) => r.config?.isOwner).map((r) => r.key);
  const canManageItem = canWrite && (isAdmin || ownerRoleKeys.some((r) => myRoles.includes(r)));
  const frozen = !!item.frozen;

  const members = space?.members.map((m) => ({ userId: m.userId, name: m.user?.name ?? m.userId })) ?? [];
  // 访客不能担任角色
  const assignable = members.filter((m) => space?.members.find((x) => x.userId === m.userId)?.role !== "guest");
  const nameOf = (userId: string) => members.find((m) => m.userId === userId)?.name ?? users.get(userId) ?? userId;
  const today = dayInTimeZone(Date.now(), item.space?.timezone ?? "Asia/Shanghai");
  const nodeTasks = (nodeKey: string, nodeName: string, readOnly: boolean) => (
    <NodeTasks
      workItemId={item.id}
      nodeKey={nodeKey}
      nodeName={nodeName}
      tasks={item.tasks.filter((t) => t.nodeKey === nodeKey)}
      members={members}
      today={today}
      readOnly={readOnly}
    />
  );
  const completingNode = completing ? graph?.nodes.find((n) => n.key === completing) : undefined;
  const typeName = space?.workItemTypes.find((t) => t.id === item.typeId)?.name;
  // 进行中节点的负责角色排在前面，其余的默认收起
  const activeRoles = new Set(inProgress.flatMap((n) => n.ownerRoles));
  // 角色按出现规则（和这个工作项上手动的增删）决定显示哪些；不出现的可以「添加角色」
  const allRoles = space?.workItemTypes.find((t) => t.id === item.typeId)?.roles ?? [];
  const roleView = conditionView(
    withLineOptions(item.type?.fields ?? [], item.space?.businessLines),
    Object.fromEntries(item.fieldValues.map((f) => [f.fieldKey, f.value])),
  );
  const shownRoles = allRoles.filter(
    (r) => roleAppears(r, roleView, item.roleOverrides) || (roleUsers[r.key]?.length ?? 0) > 0,
  );
  const typeRoles = [...shownRoles].sort((a, b) => Number(activeRoles.has(b.key)) - Number(activeRoles.has(a.key)));
  const who = { isAdmin, isCreator: item.createdBy === me, roles: myRoles };

  // 详情页按类型的页面布局渲染：页签 → 分组 → 字段和控件
  const typeFields = withLineOptions(item.type?.fields ?? [], item.space?.businessLines);
  const record = Object.fromEntries(item.fieldValues.map((f) => [f.fieldKey, f.value]));
  const layout = resolveLayout(typeFields, item.type?.detailLayout);
  const tabs = layout.tabs.filter(
    (t) => (t.system !== "nodes" || graph) && (!t.showWhen || evaluate(t.showWhen, roleView)),
  );
  const currentTab = tabs.find((t) => t.key === tab) ?? tabs[0];
  const tabLabel = (t: (typeof tabs)[number]) =>
    t.system === "comments" && item.comments.length ? `${t.name} ${item.comments.length}` : t.name;

  const rolesBlock = space ? (
    <div className="flex flex-col gap-2">
      <RolePicker
        roles={(rolesOpen ? typeRoles : typeRoles.slice(0, ROLES_FOLDED)).map((r) => ({
          key: r.key,
          name: r.name,
          single: !!r.config?.single,
          isOwner: !!r.config?.isOwner,
          readOnly: !canWrite || !canEditRoleMembers(r, who),
          removable: canWrite && (isAdmin || roleRemovable(r)),
        }))}
        members={assignable}
        value={roleUsers}
        onToggle={(roleKey, userId, selected) =>
          run(
            mutators.role.set({
              workItemId: item.id,
              roleKey,
              userIds: toggled(
                roleUsers[roleKey],
                userId,
                selected,
                !!allRoles.find((r) => r.key === roleKey)?.config?.single,
              ),
            }),
          )
        }
        onRemove={(roleKey) => run(mutators.role.setPresence({ workItemId: item.id, roleKey, present: false }))}
        addable={canWrite ? allRoles.filter((r) => !shownRoles.includes(r)) : []}
        onAdd={(roleKey) => run(mutators.role.setPresence({ workItemId: item.id, roleKey, present: true }))}
      />
      {typeRoles.length > ROLES_FOLDED && (
        <Button
          variant="link"
          size="sm"
          className="w-fit"
          onClick={() => setRolesOpen(!rolesOpen)}
          aria-expanded={rolesOpen}
        >
          {rolesOpen ? "收起" : `展开全部 ${typeRoles.length} 个角色`}
        </Button>
      )}
    </div>
  ) : null;

  type Linked = NonNullable<(typeof item.outgoing)[number]["to"]>;
  /** 对端工作项上一个字段的显示文字；「名称」是工作项自己的名称。 */
  const linkedTexts = (others: readonly (Linked | undefined)[], field: string) =>
    others.flatMap((w) => {
      if (!w) return [];
      if (field === "名称") return [w.name];
      const def = w.type?.fields.find((f) => f.key === field || f.name === field);
      const value = def && w.fieldValues.find((v) => v.fieldKey === def.key)?.value;
      if (!def || value === null || value === undefined) return [];
      const text = formatFieldValue(
        { name: def.name, dataType: def.dataType as FieldDataType, options: def.options, config: def.config },
        value,
        (id: string) => members.find((m) => m.userId === id)?.name ?? id,
      );
      return text ? [text] : [];
    });
  /** 按本端看到的关联名找关联的工作项（本端建的用关联名，对端建的用对端字段名）。 */
  const linkedByName = (relation: string) => [
    ...item.outgoing.filter((r) => r.def?.name === relation).map((r) => r.to),
    ...item.incoming.filter((r) => (r.def?.reverseName ?? r.def?.name) === relation).map((r) => r.from),
  ];

  const timeZone = item.space?.timezone ?? "Asia/Shanghai";
  /** 节点上的估分、实际工时输入（失焦时保存）。 */
  const effortView = (node: {
    key: string;
    name: string;
    effort?: { points?: boolean; hours?: "show" | "required" };
  }) => {
    if (!node.effort?.points && !node.effort?.hours) return null;
    const runtime = states.get(node.key);
    const editable = canPlan(node.key);
    const save = (key: "points" | "actualHours", raw: string) => {
      const value = raw.trim() === "" ? null : Number(raw);
      if (value !== null && !Number.isFinite(value)) return;
      if ((runtime?.[key] ?? null) === value) return;
      run(mutators.node.setEffort({ workItemId: item.id, nodeKey: node.key, [key]: value }));
    };
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {node.effort.points && (
          <label className="flex items-center gap-1.5">
            <span className="text-fg-muted">估分：</span>
            <Input
              key={`p-${runtime?.points ?? ""}`}
              type="number"
              min={0}
              aria-label={`${node.name}估分`}
              className="h-7 w-24"
              defaultValue={runtime?.points ?? ""}
              readOnly={!editable}
              onBlur={(e) => save("points", e.target.value)}
            />
          </label>
        )}
        {node.effort.hours && (
          <label className="flex items-center gap-1.5">
            <span className="text-fg-muted">
              实际工时{node.effort.hours === "required" && <span className="text-danger-500">*</span>}：
            </span>
            <Input
              key={`h-${runtime?.actualHours ?? ""}`}
              type="number"
              min={0}
              aria-label={`${node.name}实际工时`}
              className="h-7 w-24"
              defaultValue={runtime?.actualHours ?? ""}
              readOnly={!editable}
              onBlur={(e) => save("actualHours", e.target.value)}
            />
            <span className="text-fg-subtle">小时</span>
          </label>
        )}
      </div>
    );
  };
  /** 节点信息：某个节点的负责人、排期（能排期的人可以改）、结论。流程里没有这个节点时不显示。 */
  const nodeInfoView = (ref: string, info: readonly string[] | undefined, label: string | undefined, key: string) => {
    const def = graph?.nodes.find((n) => n.key === ref || n.name === ref);
    if (!def) return null;
    const runtime = states.get(def.key);
    const parts = info?.length ? info : ["owner", "schedule"];
    const day = (ms: number | null | undefined) => (ms == null ? "" : dayToIso(dayInTimeZone(ms, timeZone)));
    const start = day(runtime?.plannedStart);
    const end = day(runtime?.plannedEnd);
    const editable = canPlan(def.key);
    const name = label || def.name;
    return (
      <div
        key={key}
        role="group"
        aria-label={`节点信息 ${name}`}
        className="flex flex-col gap-1 rounded border border-line px-2.5 py-2 text-sm"
      >
        <span className="font-medium">{name}</span>
        {parts.includes("owner") && (
          <span className="flex flex-wrap items-center gap-1">
            <span className="text-fg-muted">负责人：</span>
            {(runtime?.owners ?? []).length === 0 && <span className="text-fg-subtle">未设置</span>}
            {(runtime?.owners ?? []).map((u) => (
              <UserChip key={u} id={u} name={nameOf(u)} />
            ))}
          </span>
        )}
        {parts.includes("schedule") && (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-fg-muted">排期：</span>
            <Input
              type="date"
              aria-label={`${name}计划开始`}
              className="h-7 w-36"
              value={start}
              readOnly={!editable}
              onChange={(e) =>
                e.target.value && setPlan(def.key, dayFromIso(e.target.value), dayFromIso(end || e.target.value))
              }
            />
            <span>~</span>
            <Input
              type="date"
              aria-label={`${name}计划结束`}
              className="h-7 w-36"
              value={end}
              readOnly={!editable}
              onChange={(e) =>
                e.target.value && setPlan(def.key, dayFromIso(start || e.target.value), dayFromIso(e.target.value))
              }
            />
          </span>
        )}
        {parts.includes("conclusion") && (
          <span>
            <span className="text-fg-muted">结论：</span>
            {conclusionLabel(def.key) ?? <span className="text-fg-subtle">—</span>}
            {runtime?.comment && <span className="text-fg-muted">（{runtime.comment}）</span>}
          </span>
        )}
      </div>
    );
  };

  /** 布局里的一项：字段、提示文字或控件。 */
  const renderItem = (it: LayoutItem, index: number) => {
    switch (it.kind) {
      case "field":
        return (
          <LayoutField
            key={`f-${it.field}-${index}`}
            item={it}
            item_={item}
            fields={typeFields}
            record={record}
            members={members}
            isAdmin={isAdmin}
            myRoles={myRoles}
            labelPosition={layout.labelPosition}
            onSet={(fieldKey, value) => run(mutators.fieldValue.set({ workItemId: item.id, fieldKey, value }))}
          />
        );
      case "text":
        return (
          <p
            key={`t-${index}`}
            role="note"
            className={cn(
              "col-span-full rounded-md px-3 py-2 text-sm",
              it.tone === "warning" ? "bg-warning-50 text-warning-600" : "bg-brand-50 text-brand-600",
            )}
          >
            {it.text}
          </p>
        );
      case "relation":
      case "relations": {
        const defs = (item.type?.relationDefs ?? []).filter(
          (d) => it.kind === "relations" || d.id === it.relationDefId,
        );
        // 别的工作项指向本工作项、并且在本端有字段名的互相关联
        const reverseDefs = (space?.workItemTypes ?? [])
          .flatMap((t) => t.relationDefs)
          .filter(
            (d) =>
              d.toTypeId === item.typeId && d.reverseName && (it.kind === "relations" || d.id === it.relationDefId),
          )
          .map((d) => ({
            id: d.id,
            name: d.reverseName ?? d.name,
            fromTypeId: d.fromTypeId,
            cardinality: d.reverseCardinality ?? ("many" as const),
          }));
        return (
          <div key={`r-${index}`} className="col-span-full">
            <RelationsCard
              workItemId={item.id}
              spaceId={item.spaceId}
              defs={defs}
              reverseDefs={reverseDefs}
              outgoing={item.outgoing
                .filter((r) => it.kind === "relations" || r.relationDefId === it.relationDefId)
                .map((r) => ({ ...r, item: r.to }))}
              incoming={item.incoming
                .filter((r) => it.kind === "relations" || r.relationDefId === it.relationDefId)
                .map((r) => ({ ...r, item: r.from }))}
              {...(it.kind === "relation" && it.title && { title: it.title })}
            />
          </div>
        );
      }
      case "relatedField": {
        // 关联信息：沿这个关联取对端工作项的字段，只读
        const others = [
          ...item.outgoing.filter((r) => r.relationDefId === it.relationDefId).map((r) => r.to),
          ...item.incoming.filter((r) => r.relationDefId === it.relationDefId).map((r) => r.from),
        ].filter((w) => !!w);
        const values = linkedTexts(others, it.field);
        const label = it.label || others[0]?.type?.fields.find((f) => f.key === it.field)?.name || it.field;
        return (
          <div
            key={`rf-${index}`}
            className={cn(
              "flex min-w-0 gap-2 text-sm",
              layout.labelPosition === "top" ? "flex-col gap-1" : "items-start",
            )}
          >
            <span className="w-28 shrink-0 truncate pt-1.5 text-fg-muted" title={label}>
              {label}
            </span>
            <span aria-label={label} className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-1.5">
              {values.join("、") || <span className="text-fg-subtle">—</span>}
            </span>
          </div>
        );
      }
      case "nodeInfo":
        return nodeInfoView(it.node, it.info, it.label, `ni-${index}`);
      case "nodeTable": {
        // 指定了流程类型的，只在这个流程类型的工作项上显示
        if (it.template && template?.name !== it.template) return null;
        const defs = it.nodes.flatMap((ref) => graph?.nodes.filter((n) => n.key === ref || n.name === ref) ?? []);
        if (defs.length === 0) return null;
        const title = it.title || "节点";
        return (
          <div key={`nt-${index}`} className="col-span-full overflow-x-auto">
            <table aria-label={title} className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-line-subtle text-left text-xs text-fg-muted">
                  <th className="h-8 px-1.5 font-normal">节点</th>
                  <th className="px-1.5 font-normal">状态</th>
                  <th className="px-1.5 font-normal">负责人</th>
                  <th className="px-1.5 font-normal">结论</th>
                  <th className="px-1.5 font-normal">意见</th>
                </tr>
              </thead>
              <tbody>
                {defs.map((n) => {
                  const runtime = states.get(n.key);
                  return (
                    <tr key={n.key} className="border-b border-line-subtle last:border-0">
                      <td className="h-9 px-1.5">{n.name}</td>
                      <td className="px-1.5">
                        <NodeStateTag state={runtime?.state ?? "notStarted"} />
                      </td>
                      <td className="px-1.5">
                        {(runtime?.owners ?? []).map((u) => nameOf(u)).join("、") || (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </td>
                      <td className="px-1.5">{conclusionLabel(n.key) ?? <span className="text-fg-subtle">—</span>}</td>
                      <td className="px-1.5 whitespace-pre-wrap">
                        {runtime?.comment || <span className="text-fg-subtle">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }
      case "relationTable": {
        const rows = [
          ...item.outgoing.filter((r) => r.relationDefId === it.relationDefId).map((r) => r.to),
          ...item.incoming.filter((r) => r.relationDefId === it.relationDefId).map((r) => r.from),
        ].filter((w): w is Linked => !!w);
        const def =
          (item.type?.relationDefs ?? []).find((d) => d.id === it.relationDefId) ??
          (space?.workItemTypes ?? []).flatMap((t) => t.relationDefs).find((d) => d.id === it.relationDefId);
        const title =
          it.title ||
          (def && "reverseName" in def && def.toTypeId === item.typeId ? def.reverseName : def?.name) ||
          "关联工作项";
        // 对端类型的字段（同一种关联的对端都是一个类型）
        const otherFields = rows[0]?.type?.fields ?? [];
        return (
          <div key={`rt-${index}`} className="col-span-full overflow-x-auto">
            <table aria-label={title} className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-line-subtle text-left text-xs text-fg-muted">
                  {it.columns.map((c) => (
                    <th key={c} className="h-8 px-1.5 font-normal">
                      {otherFields.find((f) => f.key === c)?.name ?? c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="border-b border-line-subtle last:border-0">
                    {it.columns.map((c) => {
                      if (c === "名称")
                        return (
                          <td key={c} className="h-9 px-1.5">
                            <Link
                              to="/items/$itemId"
                              params={{ itemId: w.id }}
                              className="text-brand-500 hover:underline"
                            >
                              {w.name}
                            </Link>
                          </td>
                        );
                      if (c === "状态")
                        return (
                          <td key={c} className="px-1.5">
                            <StatusTag status={w.status} />
                          </td>
                        );
                      const f = w.type?.fields.find((x) => x.key === c || x.name === c);
                      if (!f)
                        return (
                          <td key={c} className="px-1.5 text-fg-subtle">
                            —
                          </td>
                        );
                      const value = w.fieldValues.find((v) => v.fieldKey === f.key)?.value ?? null;
                      return (
                        <td key={c} className="min-w-32 px-1 py-1 align-top">
                          <FieldInput
                            field={{
                              key: f.key,
                              name: f.name,
                              dataType: f.dataType,
                              options: f.options,
                              config: f.config,
                            }}
                            value={value}
                            label={`${w.name} ${f.name}`}
                            members={members}
                            readOnly={!canWrite || f.dataType === "formula" || f.dataType === "relation"}
                            onChange={(v) =>
                              run(mutators.fieldValue.set({ workItemId: w.id, fieldKey: f.key, value: v }))
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={it.columns.length} className="h-9 px-1.5 text-fg-subtle">
                      还没有关联的工作项。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      }
      case "subItems":
        return (
          <div key={`s-${index}`} className="col-span-full">
            <SubItemsTable items={item.outgoing.flatMap((r) => (r.parentNodeKey && r.to ? [r.to] : []))} />
          </div>
        );
      case "roles":
        return (
          <div key={`ro-${index}`} className="col-span-full">
            {rolesBlock}
          </div>
        );
      case "attachments":
        return (
          <div key={`a-${index}`} className="col-span-full">
            <AttachmentsCard
              workItemId={item.id}
              attachments={item.attachments.filter((a) => !a.fieldKey)}
              me={me}
              isAdmin={isAdmin}
              canWrite={canWrite}
            />
          </div>
        );
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas">
      <header className="flex flex-col gap-1 border-b border-line-subtle bg-surface px-6 pt-4 pb-3">
        <nav aria-label="位置" className="flex items-center gap-1 text-xs text-fg-subtle">
          <Link to="/spaces/$spaceId" params={{ spaceId: item.spaceId }} className="hover:text-brand-500">
            {space?.name ?? "空间"}
          </Link>
          {typeName && (
            <>
              <ChevronRight className="size-3" />
              <Link
                to="/spaces/$spaceId/$typeKey"
                params={{ spaceId: item.spaceId, typeKey: item.type?.key ?? "" }}
                className="hover:text-brand-500"
              >
                {typeName}
              </Link>
            </>
          )}
          {parent && (
            <>
              <ChevronRight className="size-3" />
              <Link to="/items/$itemId" params={{ itemId: parent.id }} className="hover:text-brand-500">
                上级工作项：{parent.name}
              </Link>
            </>
          )}
        </nav>
        <div className="flex min-h-8 items-center gap-2.5">
          <h1 className="truncate text-xl font-semibold">{item.name}</h1>
          <StatusTag status={item.status} />
          {(() => {
            const marked = new Set(item.marks.map((m) => m.kind));
            const toggle = (kind: "follow" | "star") =>
              run(mutators.mark.set({ workItemId: item.id, kind, on: !marked.has(kind) }));
            return (
              <span className="flex items-center gap-1">
                <Button size="sm" variant="ghost" aria-pressed={marked.has("follow")} onClick={() => toggle("follow")}>
                  <Eye />
                  {marked.has("follow") ? "已关注" : "关注"}
                </Button>
                <Button size="sm" variant="ghost" aria-pressed={marked.has("star")} onClick={() => toggle("star")}>
                  <Star className={marked.has("star") ? "fill-warning-500 text-warning-500" : undefined} />
                  {marked.has("star") ? "已收藏" : "收藏"}
                </Button>
              </span>
            );
          })()}
          {canWrite && (
            <Button size="sm" variant="ghost" onClick={() => setCopyName(`${item.name} 副本`)}>
              复制
            </Button>
          )}
          {canManageItem && (
            <span className="flex items-center gap-1">
              {item.status === "terminated" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => run(mutators.workItem.restore({ workItemId: item.id }))}
                >
                  恢复
                </Button>
              ) : (
                item.status !== "completed" && (
                  <Button size="sm" variant="ghost" onClick={() => setTerminating(true)}>
                    终止
                  </Button>
                )
              )}
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={frozen}
                onClick={() => run(mutators.workItem.setFrozen({ workItemId: item.id, frozen: !frozen }))}
              >
                {frozen ? "解冻" : "冻结"}
              </Button>
            </span>
          )}
          {canUpgrade && canWrite && (
            <Button size="sm" variant="outline" onClick={() => run(mutators.node.upgrade({ workItemId: item.id }))}>
              升级到模板最新版本
            </Button>
          )}
          {item.stage && <StageTag stage={item.stage} />}
          <span className="ml-auto text-xs text-fg-subtle">
            创建于 {formatTime(item.createdAt)} · 更新于 {formatTime(item.updatedAt)}
          </span>
        </div>
      </header>

      {error && (
        <div className="px-6 pt-4">
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}
      {item.status === "terminated" && (
        <p role="note" className="mx-6 mt-4 rounded-md bg-surface px-3 py-2 text-sm text-fg-muted">
          工作项已终止{item.terminateReason ? `，原因：${item.terminateReason}` : ""}。
        </p>
      )}
      {frozen && (
        <p role="note" className="mx-6 mt-4 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-600">
          工作项已冻结，字段、节点和状态都不能修改，解冻后恢复。
        </p>
      )}
      <Dialog open={copyName !== null} onOpenChange={(open) => !open && setCopyName(null)}>
        <DialogContent title="复制工作项" description="同一类型、同一流程，字段、角色和关联按类型的复制配置带过去。">
          <div className="flex flex-col gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">新工作项名称</span>
              <Input aria-label="新工作项名称" value={copyName ?? ""} onChange={(e) => setCopyName(e.target.value)} />
            </label>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="outline">取消</Button>
              </DialogClose>
              <Button
                disabled={!copyName?.trim()}
                onClick={async () => {
                  const id = newId();
                  const name = copyName?.trim() ?? "";
                  setCopyName(null);
                  setError(null);
                  const { client, server } = zero.mutate(mutators.workItem.copy({ sourceId: item.id, id, name }));
                  for (const outcome of [await client, await server])
                    if (outcome.type === "error") return setError(outcome.error.message);
                  navigate({ to: "/items/$itemId", params: { itemId: id } });
                }}
              >
                复制
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={terminating} onOpenChange={setTerminating}>
        <DialogContent title="终止工作项" description="终止后工作项不再推进，可以随时恢复。">
          <div className="flex flex-col gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">终止原因</span>
              <select
                aria-label="终止原因"
                className="h-8 rounded border border-line bg-surface px-2"
                value={abortReason}
                onChange={(e) => setAbortReason(e.target.value)}
              >
                {["取消，现在先不做了", "重复/合并，与其他在做工作项一同推进", "其他"].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">补充说明</span>
              <Input aria-label="补充终止原因" value={abortDetail} onChange={(e) => setAbortDetail(e.target.value)} />
            </label>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="outline">取消</Button>
              </DialogClose>
              <Button
                variant="danger"
                onClick={async () => {
                  setTerminating(false);
                  const reason = [abortReason, abortDetail.trim()].filter(Boolean).join("：");
                  await run(mutators.workItem.terminate({ workItemId: item.id, reason }));
                }}
              >
                确认终止
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {!canWrite && (
        <p role="note" className="mx-6 mt-4 rounded-md bg-surface px-3 py-2 text-sm text-fg-muted">
          你是这个空间的访客，只能查看和评论。
        </p>
      )}

      {/* 流程：顶部横向流程图（或状态图），可以切到甘特图 */}
      <section aria-label="流程" className="border-b border-line-subtle bg-surface">
        {graph && (
          <Tabs
            className="px-6"
            label="工作项视图"
            value={view}
            onChange={setView}
            items={[
              ["flow", "节点流程"],
              ["gantt", "甘特图"],
            ]}
          />
        )}
        {statusDefinition && (
          <StatusDiagram definition={statusDefinition} current={item.flowStatus ?? undefined} className="h-52" />
        )}
        {graph && view === "flow" && (
          <div className="h-56">
            <Diagram graph={graph} states={states} selected={selected} onSelect={setSelected} />
          </div>
        )}
        {graph && view === "gantt" && (
          <div className="h-[460px]">
            <Schedule
              graph={graph}
              nodes={item.nodes}
              timeZone={item.space?.timezone ?? "Asia/Shanghai"}
              calendar={calendar}
              canPlan={canPlan}
              onPlan={setPlan}
            />
          </div>
        )}
      </section>

      {/* 节点卡片：当前进行中的节点和点选的节点（状态流是当前状态和可以流转到的状态） */}
      <fieldset disabled={!canWrite || frozen} className="contents">
        <div className="grid items-start gap-4 px-6 py-4 lg:grid-cols-2">
          {statusDefinition && (
            <Card>
              <StatusPanel
                definition={statusDefinition}
                current={item.flowStatus}
                actor={{ userId: me, roles: myRoles, isAdmin }}
                fields={record}
                onTransition={(to) => run(mutators.workItem.transition({ workItemId: item.id, to }))}
              />
            </Card>
          )}
          {graph && (
            <Card>
              <Panel title="当前节点" aria-label="当前节点">
                <div className="flex flex-col gap-3">
                  {inProgress.map((node) => {
                    const runtime = states.get(node.key);
                    const owners = runtime?.owners ?? [];
                    const confirmed = new Set(runtime?.confirmations.map((c) => c.userId));
                    const bySubItems = node.completion === "subItemDriven";
                    // 子工作项驱动的节点自动完成，只有空间管理员能手动完成
                    const canConfirm = bySubItems
                      ? isAdmin && !owners.includes(me)
                      : (owners.includes(me) && !confirmed.has(me)) || (isAdmin && !owners.includes(me));
                    return (
                      <section
                        key={node.key}
                        aria-label={node.name}
                        className="flex flex-col gap-2.5 rounded-lg border border-brand-200 bg-brand-50/40 p-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className="size-2 rounded-full bg-brand-500" />
                          <span className="font-medium">{node.name}</span>
                          <span className="ml-auto text-xs text-fg-subtle">{COMPLETION_LABEL[node.completion]}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-fg-muted">负责人：</span>
                          {owners.length === 0 && <span className="text-fg-subtle">无（自动）</span>}
                          {owners.map((u) => (
                            <span key={u} className="inline-flex items-center gap-1">
                              <UserChip id={u} name={nameOf(u)} />
                              {confirmed.has(u) && <Check aria-label="已确认" className="size-3.5 text-success-600" />}
                            </span>
                          ))}
                        </div>
                        {effortView(node)}
                        {node.relatedInfo?.length ? (
                          <dl
                            aria-label={`${node.name}的关联信息`}
                            className="flex flex-col gap-1 rounded bg-surface px-2.5 py-2"
                          >
                            {node.relatedInfo.map((info) => {
                              const text = linkedTexts(linkedByName(info.relation), info.field).join("、");
                              return (
                                <div key={`${info.relation}-${info.field}`} className="flex gap-2">
                                  <dt className="w-28 shrink-0 truncate text-fg-muted" title={info.field}>
                                    {info.field}
                                  </dt>
                                  <dd
                                    aria-label={info.field}
                                    className="min-w-0 flex-1 whitespace-pre-wrap break-words"
                                  >
                                    {text || <span className="text-fg-subtle">—</span>}
                                  </dd>
                                </div>
                              );
                            })}
                          </dl>
                        ) : null}
                        {node.nodeInfo?.length ? (
                          <div className="flex flex-col gap-1.5">
                            {node.nodeInfo.map((n, i) =>
                              nodeInfoView(n.node, n.info, undefined, `${node.key}-ni-${i}`),
                            )}
                          </div>
                        ) : null}
                        {bySubItems && (
                          <SubItems
                            workItemId={item.id}
                            nodeKey={node.key}
                            nodeName={node.name}
                            items={children(node.key)}
                            types={spaceTypes}
                            canCreate
                          />
                        )}
                        {nodeTasks(node.key, node.name, false)}
                        {(canConfirm || (node.buttons?.length && canWrite)) && (
                          <div className="flex flex-wrap gap-2">
                            {canConfirm && (
                              <Button size="sm" onClick={() => confirm(node.key)}>
                                {bySubItems ? "手动完成" : "确认完成"}
                              </Button>
                            )}
                            {node.buttons?.map((b) => (
                              <Button
                                key={b.key}
                                size="sm"
                                variant={
                                  b.style === "primary" ? "default" : b.style === "warning" ? "danger" : "outline"
                                }
                                onClick={() => press(node.key, b.key)}
                              >
                                {b.label}
                              </Button>
                            ))}
                          </div>
                        )}
                      </section>
                    );
                  })}
                  {inProgress.length === 0 && (
                    <p className="text-fg-subtle">
                      {item.status === "completed" ? "流程已走完。" : "没有进行中的节点。"}
                    </p>
                  )}
                </div>
              </Panel>
            </Card>
          )}
          {selectedNode && (
            <Card>
              <Panel title={selectedNode.name} aria-label="选中的节点">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-fg-muted">状态：</span>
                    <NodeStateTag state={states.get(selectedNode.key)?.state ?? "notStarted"} />
                    {selectedNode.milestone && <Tag tone="violet">里程碑</Tag>}
                  </div>
                  {conclusionLabel(selectedNode.key) && (
                    <div className="flex flex-col gap-1">
                      <span>
                        <span className="text-fg-muted">完成结论：</span>
                        {conclusionLabel(selectedNode.key)}
                      </span>
                      {states.get(selectedNode.key)?.comment && (
                        <span className="text-fg-muted">意见：{states.get(selectedNode.key)?.comment}</span>
                      )}
                    </div>
                  )}
                  {(selectedNode.fields ?? []).map((f) => {
                    const v = states.get(selectedNode.key)?.fields?.[f.key];
                    return (
                      <span key={f.key}>
                        <span className="text-fg-muted">{f.name}：</span>
                        {v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join("、") : String(v)}
                      </span>
                    );
                  })}
                  {selectedNode.completion === "subItemDriven" &&
                    states.get(selectedNode.key)?.state !== "inProgress" && (
                      <SubItems
                        workItemId={item.id}
                        nodeKey={selectedNode.key}
                        nodeName={selectedNode.name}
                        items={children(selectedNode.key)}
                        types={spaceTypes}
                        canCreate={false}
                      />
                    )}
                  {states.get(selectedNode.key)?.state !== "inProgress" &&
                    nodeTasks(
                      selectedNode.key,
                      selectedNode.name,
                      states.get(selectedNode.key)?.state !== "notStarted",
                    )}
                  {canRollback(selectedNode.key) && (
                    <div>
                      <Button size="sm" variant="outline" onClick={() => rollback(selectedNode.key)}>
                        <Undo2 />
                        回滚到此节点
                      </Button>
                    </div>
                  )}
                </div>
              </Panel>
            </Card>
          )}
        </div>
      </fieldset>

      {/* 页签：按页面布局；自定义页签里是分组，系统页签是节点详情、评论、动态 */}
      <section aria-label="详情" className="mx-6 mb-6 rounded-lg border border-line-subtle bg-surface">
        <Tabs
          className="px-5"
          label="详情页签"
          value={currentTab?.key ?? ""}
          onChange={setTab}
          items={tabs.map((t) => [t.key, tabLabel(t)] as const)}
        />
        {currentTab && !currentTab.system && (
          <fieldset disabled={!canWrite || frozen} className="contents">
            {(currentTab.sections ?? []).map((section) => {
              // 只放了一个自带标题的控件（关联、附件）的分组，直接显示控件，不再套一层分组标题
              const only = section.items.length === 1 ? section.items[0] : undefined;
              if (only && (only.kind === "relations" || only.kind === "relation" || only.kind === "attachments"))
                return <div key={section.name}>{renderItem(only, 0)}</div>;
              return (
                <LayoutSectionView key={section.name} section={section}>
                  {section.items.map(renderItem)}
                </LayoutSectionView>
              );
            })}
          </fieldset>
        )}
        {currentTab?.system === "nodes" && graph && (
          <NodesTable
            graph={graph}
            nodes={item.nodes}
            nameOf={nameOf}
            timeZone={item.space?.timezone ?? "Asia/Shanghai"}
          />
        )}
        {currentTab?.system === "comments" && (
          <div className="px-5 py-4">
            <CommentsCard workItemId={item.id} comments={item.comments} members={members} />
          </div>
        )}
        {currentTab?.system === "activity" && (
          <div className="px-5 py-4">
            <ActivityCard
              workItemId={item.id}
              context={{
                nodeName: (key) => graph?.nodes.find((n) => n.key === key)?.name ?? key,
                statusName: (key) => statusDefinition?.statuses.find((s) => s.key === key)?.name ?? key,
                fields: item.type?.fields ?? [],
                roles: allRoles,
                relationDefs: item.type?.relationDefs ?? [],
                userName: nameOf,
                itemName: (id) =>
                  item.outgoing.find((r) => r.toId === id)?.to?.name ??
                  item.incoming.find((r) => r.fromId === id)?.from?.name,
              }}
            />
          </div>
        )}
      </section>

      {completingNode && (
        <CompleteNodeDialog
          workItemId={item.id}
          node={completingNode}
          fields={item.type?.fields ?? []}
          values={new Map(item.fieldValues.map((f) => [f.fieldKey, f.value]))}
          nodeValues={states.get(completingNode.key)?.fields ?? {}}
          members={members}
          open
          onOpenChange={(open) => !open && setCompleting(null)}
        />
      )}
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-lg border border-line-subtle bg-surface">{children}</div>;
}

const formatTime = (ms: number | null | undefined) =>
  ms
    ? new Date(ms).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

/** 布局里的一个分组：标题可以点开收起；两栏布局时字段两两并排。 */
function LayoutSectionView({ section, children }: { section: LayoutSection; children: ReactNode }) {
  const [open, setOpen] = useState(!section.collapsed);
  const count = section.items.filter((i) => i.kind === "field").length;
  return (
    <Panel
      title={section.name}
      aria-label={section.name}
      actions={
        <Button
          variant="link"
          size="sm"
          aria-expanded={open}
          aria-label={`${open ? "收起" : "展开"}${section.name}`}
          onClick={() => setOpen(!open)}
        >
          {open ? "收起" : count ? `展开 ${count} 个字段` : "展开"}
        </Button>
      }
    >
      {open && (
        <div className={cn("grid gap-x-8 gap-y-2.5", section.columns !== 1 && "lg:grid-cols-2")}>{children}</div>
      )}
    </Panel>
  );
}

/** 状态流工作项的当前状态和可以流转到的状态；条件不满足的按钮置灰。 */
function StatusPanel({
  definition,
  current,
  actor,
  fields,
  onTransition,
}: {
  definition: StatusFlowDefinition;
  current: string | null;
  actor: StatusActor;
  fields: Record<string, unknown>;
  onTransition: (to: string) => void;
}) {
  const flow = new StatusFlow(definition);
  const status = current ? definition.statuses.find((s) => s.key === current) : undefined;
  const options = current ? flow.available(current, actor) : [];
  return (
    <Panel title="当前状态" aria-label="当前状态">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{status?.name ?? "—"}</span>
          {status && <Tag tone="neutral">{CATEGORY_LABEL[status.category]}</Tag>}
        </div>
        {options.length > 0 ? (
          <fieldset className="flex flex-wrap gap-2" aria-label="流转到">
            {options.map((t) => {
              const target = flow.status(t.to);
              const ready = !t.gate || evaluate(t.gate, fields);
              return (
                <Button
                  key={t.to}
                  size="sm"
                  variant="outline"
                  disabled={!ready}
                  title={ready ? undefined : "流转条件还没满足"}
                  onClick={() => onTransition(t.to)}
                >
                  {target.name}
                </Button>
              );
            })}
          </fieldset>
        ) : (
          <p className="text-fg-subtle">没有你可以操作的流转。</p>
        )}
      </div>
    </Panel>
  );
}

/** 角色多的类型（如 OEM 有 16 个）默认只显示前几个。 */
const ROLES_FOLDED = 5;

const COMPLETION_LABEL: Record<string, string> = {
  auto: "自动完成",
  singleConfirm: "单人确认",
  allConfirm: "会签",
  subItemDriven: "子工作项驱动",
};

function NodeStateTag({ state }: { state: NodeState }) {
  const tone = ({ notStarted: "neutral", inProgress: "brand", completed: "success", skipped: "neutral" } as const)[
    state
  ];
  return <Tag tone={tone}>{STATE_LABEL[state]}</Tag>;
}

type NodeRow = Item["nodes"][number];

/** 甘特图加排期明细表。拖动横条或改表里的日期都会把节点设成“手动”，后续节点自动顺延。 */
function Schedule({
  graph,
  nodes,
  timeZone,
  calendar,
  canPlan,
  onPlan,
}: {
  graph: FlowGraph;
  nodes: readonly NodeRow[];
  timeZone: string;
  calendar: WorkCalendar;
  canPlan: (nodeKey: string) => boolean;
  onPlan: (nodeKey: string, start?: Day, end?: Day) => void;
}) {
  const today = dayInTimeZone(Date.now(), timeZone);
  const { rows, deps } = nodeGanttRows(graph, nodes, { timeZone, canPlan: (n) => canPlan(n.nodeKey) });

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="min-h-0 flex-[3]">
        <GanttChart rows={rows} deps={deps} calendar={calendar} today={today} onChange={onPlan} />
      </div>
      <details open className="min-h-0 flex-[2] overflow-auto border-t border-line-subtle">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold select-none">排期明细</summary>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-line-subtle bg-canvas/60 text-left text-xs text-fg-muted">
              <th className="h-8 px-4 font-normal">节点</th>
              <th className="font-normal">计划开始</th>
              <th className="font-normal">计划结束</th>
              <th className="font-normal">实际</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} aria-label={row.label} className="border-b border-line-subtle hover:bg-hover/50">
                <td className="h-10 px-4">
                  {row.label}
                  {row.pinned && (
                    <Tag tone="warning" className="ml-2">
                      手动
                    </Tag>
                  )}
                </td>
                {(["start", "end"] as const).map((side) => (
                  <td key={side}>
                    <Input
                      type="date"
                      aria-label={side === "start" ? "计划开始" : "计划结束"}
                      className="h-7 w-36 disabled:border-transparent disabled:bg-transparent disabled:text-fg"
                      value={dayToIso(row[side])}
                      disabled={!row.editable}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const day = dayFromIso(e.target.value);
                        // 改开始日期时整体平移、工期不变；改结束日期时只改结束
                        if (side === "start") onPlan(row.key, day, day + (row.end - row.start));
                        else onPlan(row.key, row.start, Math.max(row.start, day));
                      }}
                    />
                  </td>
                ))}
                <td className="text-fg-muted tabular-nums">
                  {row.actualStart !== null ? dayToIso(row.actualStart) : ""}
                  {row.actualEnd !== null ? ` → ${dayToIso(row.actualEnd)}` : ""}
                </td>
                <td className="pr-4 text-right">
                  {row.pinned && row.editable && (
                    <Button variant="ghost" size="sm" onClick={() => onPlan(row.key)}>
                      恢复自动
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

type Item = NonNullable<QueryResultType<ReturnType<typeof queries.workItems.byId>>>;

type FieldDefRow = NonNullable<Item["type"]>["fields"][number];

/**
 * 布局里的一个字段：显示名（可在布局里改）、附加说明、编辑控件。
 * 配了可见角色、自己又看不到的字段不显示（值也不会同步过来）；配了可改角色、自己不能改的字段只读。
 * 字段规则（有效性、条件显示）和布局上的显示条件不满足时也不显示。
 */
function LayoutField({
  item,
  item_: workItem,
  fields,
  record,
  members,
  isAdmin,
  myRoles,
  labelPosition,
  onSet,
}: {
  item: Extract<LayoutItem, { kind: "field" }>;
  item_: Item;
  fields: readonly FieldDefRow[];
  record: Record<string, unknown>;
  members: readonly FieldMember[];
  isAdmin: boolean;
  myRoles: string[];
  labelPosition: "side" | "top";
  onSet: (fieldKey: string, value: FieldInputValue) => void;
}) {
  const field = fields.find((f) => f.key === item.field);
  if (!field) return null;
  const allowed = (roles: readonly string[]) => isAdmin || hasAnyRole(roles, myRoles);
  const viewRoles = fieldViewRoles(field);
  if (viewRoles && !allowed(viewRoles)) return null;
  const state = fieldStates(fields, record)[field.key];
  if (state?.visible === false) return null;
  if (item.showWhen && !evaluate(item.showWhen, conditionView(fields, record))) return null;
  const value = record[field.key] ?? null;
  const wide =
    item.wide || field.dataType === "richText" || field.dataType === "textarea" || field.dataType === "fieldGroup";
  const top = labelPosition === "top" || wide;
  const name = item.label || field.name;
  return (
    <div
      className={cn(
        "grid min-w-0 gap-1.5",
        wide && "col-span-full",
        !top && "grid-cols-[9rem_minmax(0,1fr)] items-center gap-3",
      )}
    >
      <span className="min-w-0 overflow-hidden text-fg-muted" title={name}>
        <FieldLabel name={name} required={state?.required} description={field.config?.description} />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <FieldInput
          field={field}
          label={name}
          value={value}
          members={members}
          options={availableOptions(field, record, value)}
          workItemId={workItem.id}
          attachments={workItem.attachments.map((a) => ({ id: a.id, name: a.name, size: a.size }))}
          readOnly={!allowed(field.editRoles ?? [])}
          onChange={(v) => onSet(field.key, v)}
        />
        {item.hint && <span className="text-xs text-fg-subtle">{item.hint}</span>}
      </div>
    </div>
  );
}

/** 子工作项表格：名称、状态、阶段。 */
function SubItemsTable({
  items,
}: {
  items: readonly { id: string; name: string; status: string | null; stage: string | null }[];
}) {
  return (
    <table aria-label="子工作项" className="w-full text-sm">
      <thead>
        <tr className="border-b border-line-subtle text-left text-xs text-fg-muted">
          <th className="h-8 font-normal">子工作项</th>
          <th className="font-normal">状态</th>
          <th className="font-normal">阶段</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={i.id} className="border-b border-line-subtle last:border-0">
            <td className="h-9">
              <Link to="/items/$itemId" params={{ itemId: i.id }} className="text-brand-500 hover:underline">
                {i.name}
              </Link>
            </td>
            <td>
              <StatusTag status={i.status} />
            </td>
            <td>
              <StageTag stage={i.stage} />
            </td>
          </tr>
        ))}
        {items.length === 0 && (
          <tr>
            <td colSpan={3} className="h-9 text-fg-subtle">
              还没有子工作项。
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** 节点详情页签：所有节点的状态、负责人、计划和实际日期。 */
function NodesTable({
  graph,
  nodes,
  nameOf,
  timeZone,
}: {
  graph: FlowGraph;
  nodes: readonly NodeRow[];
  nameOf: (userId: string) => string;
  timeZone: string;
}) {
  const { rows } = nodeGanttRows(graph, nodes, { timeZone, canPlan: () => false });
  const byKey = new Map(nodes.map((n) => [n.nodeKey, n]));
  return (
    <div className="overflow-x-auto px-5 py-3">
      <table aria-label="节点详情" className="w-full text-sm">
        <thead>
          <tr className="border-b border-line-subtle text-left text-xs text-fg-muted">
            <th className="h-8 font-normal">节点</th>
            <th className="font-normal">状态</th>
            <th className="font-normal">负责人</th>
            <th className="font-normal">计划</th>
            <th className="font-normal">实际</th>
          </tr>
        </thead>
        <tbody>
          {graph.nodes.map((n) => {
            const runtime = byKey.get(n.key);
            const row = rows.find((r) => r.key === n.key);
            return (
              <tr key={n.key} className="border-b border-line-subtle last:border-0">
                <td className="h-10 pr-4">{n.name}</td>
                <td className="pr-4">
                  <NodeStateTag state={runtime?.state ?? "notStarted"} />
                </td>
                <td className="pr-4">{(runtime?.owners ?? []).map(nameOf).join("、") || "—"}</td>
                <td className="pr-4 text-fg-muted tabular-nums">
                  {row ? `${dayToIso(row.start)} → ${dayToIso(row.end)}` : "—"}
                </td>
                <td className="text-fg-muted tabular-nums">
                  {row?.actualStart != null ? dayToIso(row.actualStart) : ""}
                  {row?.actualEnd != null ? ` → ${dayToIso(row.actualEnd)}` : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 节点流程图：从左到右，进行中的节点放在视野左侧。点节点在下面的节点卡片里看详情、回滚。 */
function Diagram({
  graph,
  states,
  selected,
  onSelect,
}: {
  graph: FlowGraph;
  states: Map<string, { state: NodeState | null; conclusion?: string | null }>;
  selected: string | null;
  onSelect: (nodeKey: string) => void;
}) {
  const positions = useMemo(() => layoutByDepth(graph), [graph]);
  // 流程图很宽，缩到一屏放不下。打开时以第一个进行中的节点为准，放在左侧偏上
  const [viewport] = useState(() => {
    const zoom = 0.9;
    const current = graph.nodes.find((n) => states.get(n.key)?.state === "inProgress");
    const at = (current && positions.get(current.key)) ?? { x: 0, y: 0 };
    return { x: 280 - at.x * zoom, y: 90 - at.y * zoom, zoom };
  });
  const nodes: Node[] = graph.nodes.map((n) => {
    const state = states.get(n.key)?.state ?? "notStarted";
    return {
      id: n.key,
      position: positions.get(n.key) ?? { x: 0, y: 0 },
      // 先给出尺寸，节点不用等测量就能显示（页面切换时测量偶尔不触发，节点会一直隐藏）
      initialWidth: 184,
      initialHeight: 36,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: (
          <div className="flex items-center gap-2 text-left" title={`${n.name}（${STATE_LABEL[state]}）`}>
            {n.milestone ? <Diamond className="size-4 shrink-0 text-violet-600" /> : STATE_ICON[state]}
            <span className={cn("min-w-0 flex-1 truncate", state === "skipped" && "line-through")}>{n.name}</span>
            {(() => {
              // 有完成结论的已完成节点，显示结论（已通过 / 未通过）
              const value = states.get(n.key)?.conclusion;
              const option = value ? n.conclusion?.options.find((o) => o.value === value) : undefined;
              return option ? (
                <span
                  className={cn("shrink-0 text-xs", option.passed === false ? "text-danger-600" : "text-success-600")}
                >
                  {option.label}
                </span>
              ) : null;
            })()}
            <span className="sr-only">{STATE_LABEL[state]}</span>
          </div>
        ),
      },
      className: cn(
        "!w-[184px] !rounded-lg !border !bg-surface !px-3 !py-2 !text-[13px] !text-fg !shadow-card",
        STATE_STYLE[state],
        selected === n.key && "!border-brand-500",
      ),
    };
  });
  const edges: Edge[] = graph.definition.edges.map((e) => {
    const done = states.get(e.from)?.state === "completed";
    return {
      id: `${e.from}->${e.to}`,
      source: e.from,
      target: e.to,
      type: "smoothstep",
      style: { stroke: done ? "var(--color-success-500)" : "var(--color-fg-disabled)", strokeWidth: 1.5 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: done ? "var(--color-success-500)" : "var(--color-fg-disabled)",
      },
    };
  });
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      defaultViewport={viewport}
      minZoom={0.1}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodeClick={(_, node) => onSelect(node.id)}
      proOptions={{ hideAttribution: true }}
      className="readonly bg-canvas"
    >
      <Background color="var(--color-line)" gap={20} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
