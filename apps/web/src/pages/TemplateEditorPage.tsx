import {
  type CompletionMode,
  type FlowDefinition,
  FlowGraph,
  type NodeDefinition,
  statusFlowOf,
  validateFlow,
} from "@fp/engine";
import { checkReferences, flowVersionId, mutators, queries } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import {
  addEdge,
  Background,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { ConditionEditor } from "@/components/ConditionEditor";
import { flowConditionFields, NodeAdvancedEditor, StageRulesEditor } from "@/components/NodeAdvancedEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Label, Select } from "@/components/ui/input";
import { Tag } from "@/components/ui/tag";
import { layoutByDepth } from "@/flow-demo/layout";
import { cn, newId } from "@/lib/utils";
import { StatusFlowEditor } from "@/pages/StatusFlowEditor";

export type Template = NonNullable<QueryResultType<ReturnType<typeof queries.templates.byId>>>;
export type TypeConfig = NonNullable<Template["type"]>;
/** 画布上的节点：data 是节点定义里除坐标以外的部分。 */
type NodeData = Omit<NodeDefinition, "position">;
type EditorNode = Node<NodeData>;

const COMPLETION: { value: CompletionMode; label: string }[] = [
  { value: "singleConfirm", label: "单人确认" },
  { value: "allConfirm", label: "会签（全部负责人确认）" },
  { value: "auto", label: "自动（卡点满足后完成）" },
  { value: "subItemDriven", label: "子工作项驱动" },
];

/** 流程模板编辑器：在画布上增删节点和连线，右侧编辑节点属性；保存为草稿，校验通过后发布。 */
export function TemplateEditorPage() {
  const { templateId } = useParams({ from: "/app/spaces/$spaceId/setting/workObject/$typeKey/workflow/$templateId" });
  const [template, result] = useQuery(queries.templates.byId({ id: templateId }));
  const latest = template?.versions[0];
  useActiveSpace(template?.type?.spaceId);

  if (!template || !latest || !template.type)
    return (
      <p className="p-6 text-sm text-fg-muted">{result.type === "complete" ? "模板不存在或没有权限。" : "加载中…"}</p>
    );
  // 换了版本（比如在已发布版本上保存出新草稿）时重新载入编辑器
  const states = statusFlowOf(latest.definition);
  if (states) return <StatusFlowEditor key={latest.id} template={template} type={template.type} base={states} />;
  return <Editor key={latest.id} template={template} type={template.type} />;
}

function toCanvas(definition: FlowDefinition): { nodes: EditorNode[]; edges: Edge[] } {
  const auto = layoutByDepth(new FlowGraph(definition));
  return {
    nodes: definition.nodes.map(({ position, ...data }) => ({
      id: data.key,
      position: position ?? auto.get(data.key) ?? { x: 0, y: 0 },
      data,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    })),
    edges: definition.edges.map(toEdge),
  };
}

function toEdge({ from, to }: { from: string; to: string }): Edge {
  return {
    id: `${from}->${to}`,
    source: from,
    target: to,
    type: "smoothstep",
    style: { stroke: "var(--color-fg-disabled)", strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-fg-disabled)" },
  };
}

function toDefinition(
  base: FlowDefinition,
  nodes: EditorNode[],
  edges: Edge[],
  stageRules: NonNullable<FlowDefinition["stageRules"]>,
): FlowDefinition {
  return {
    key: base.key,
    version: base.version,
    nodes: nodes.map((n) => ({ ...n.data, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } })),
    edges: edges.map((e) => ({ from: e.source, to: e.target })),
    ...(stageRules.length > 0 && { stageRules }),
  };
}

function Editor({ template, type }: { template: Template; type: TypeConfig }) {
  const zero = useZero();
  const latest = template.versions[0] as Template["versions"][number];
  const base = latest.definition as FlowDefinition;
  const initial = useMemo(() => toCanvas(base), [base]);
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [dirty, setDirty] = useState(false);
  const [stageRules, setStageRules] = useState(base.stageRules ?? []);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const isAdmin = type.space?.members.some((m) => m.role === "admin") ?? false;
  const definition = toDefinition(base, nodes, edges, stageRules);
  const validation = validateFlow(definition);
  const errors = [
    ...validation.errors,
    ...checkReferences(
      definition,
      type.roles.map((r) => r.key),
      type.fields.map((f) => f.key),
    ),
  ];
  const selectedNode = nodes.find((n) => n.selected);
  const selectedEdge = edges.find((e) => e.selected);
  const draftId = latest.publishedAt ? flowVersionId(template.id, latest.version + 1) : latest.id;

  const edit =
    <T,>(fn: (prev: T) => T) =>
    (prev: T) => {
      setDirty(true);
      return fn(prev);
    };
  const updateNode = (key: string, patch: Partial<NodeData>) =>
    setNodes(edit((prev) => prev.map((n) => (n.id === key ? { ...n, data: { ...n.data, ...patch } } : n))));

  function addNode() {
    const key = `n_${newId().slice(0, 8)}`;
    const anchor = selectedNode ?? nodes[nodes.length - 1];
    const position = anchor ? { x: anchor.position.x + 240, y: anchor.position.y } : { x: 0, y: 0 };
    setNodes(
      edit((prev) => [
        ...prev.map((n) => ({ ...n, selected: false })),
        {
          id: key,
          position,
          data: { key, name: "新节点", completion: "singleConfirm", ownerRoles: [] },
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          selected: true,
        },
      ]),
    );
    // 从选中的节点连过来，省一步拖线
    if (anchor?.selected) setEdges((prev) => [...prev, toEdge({ from: anchor.id, to: key })]);
  }

  async function mutate(request: Parameters<typeof zero.mutate>[0]): Promise<boolean> {
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") {
        setMessage({ kind: "error", text: outcome.error.message });
        return false;
      }
    return true;
  }

  async function save(): Promise<boolean> {
    setMessage(null);
    const ok = await mutate(mutators.flowTemplate.saveDraft({ templateId: template.id, definition }));
    if (ok) {
      setDirty(false);
      setMessage({ kind: "info", text: "草稿已保存。" });
    }
    return ok;
  }

  async function publish() {
    if (dirty || !latest.publishedAt) {
      if (!(await save())) return;
    }
    if (await mutate(mutators.flowTemplate.publish({ versionId: draftId }))) {
      setMessage({ kind: "info", text: "已发布。之后新建的工作项会用这个版本，已有的工作项不受影响。" });
    }
  }

  const status = latest.publishedAt
    ? `v${latest.version} 已发布${template.currentVersionId === latest.id ? "（当前版本）" : ""}`
    : `v${latest.version} 草稿`;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-1 border-b border-line-subtle bg-surface px-6 py-3">
        <nav aria-label="位置" className="flex items-center gap-1 text-xs text-fg-subtle">
          <Link
            to="/spaces/$spaceId/setting/$tab"
            params={{ spaceId: type.spaceId, tab: "workObjectSetting" }}
            className="hover:text-brand-500"
          >
            空间配置
          </Link>
          <ChevronRight className="size-3" />
          <Link
            to="/spaces/$spaceId/setting/workObject/$typeKey"
            params={{ spaceId: type.spaceId, typeKey: type.key }}
            search={{ menuTab: "workflow" }}
            className="hover:text-brand-500"
          >
            {type.name}
          </Link>
        </nav>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-xl font-semibold">{template.name}</h1>
          <Tag tone={latest.publishedAt ? "success" : "warning"}>{status}</Tag>
          {dirty && <span className="text-xs text-warning-600">有未保存的修改</span>}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" onClick={addNode} disabled={!isAdmin}>
              <Plus />
              添加节点
            </Button>
            <Button variant="outline" onClick={save} disabled={!isAdmin || !dirty}>
              保存草稿
            </Button>
            <Button
              onClick={publish}
              disabled={!isAdmin || errors.length > 0 || (!dirty && latest.publishedAt !== null)}
            >
              发布
            </Button>
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex-1">
          <ReactFlow
            nodes={nodes.map((n) => ({
              ...n,
              data: { ...n.data, label: <NodeLabel data={n.data} type={type} /> },
              className: cn(
                "!w-[200px] !rounded-lg !border !border-line !bg-surface !px-3 !py-2 !text-left !shadow-card",
                n.data.completion === "auto" ? "!border-dashed" : "",
                n.selected && "!border-brand-500 !ring-3 !ring-brand-100",
              ),
            }))}
            edges={edges}
            onNodesChange={(changes) => {
              if (changes.some((c) => c.type === "position" || c.type === "remove")) setDirty(true);
              onNodesChange(changes);
            }}
            onEdgesChange={(changes) => {
              if (changes.some((c) => c.type === "remove")) setDirty(true);
              onEdgesChange(changes);
            }}
            onConnect={(connection) =>
              setEdges(
                edit((prev) =>
                  addEdge({ ...connection, ...toEdge({ from: connection.source, to: connection.target }) }, prev),
                ),
              )
            }
            nodesDraggable={isAdmin}
            nodesConnectable={isAdmin}
            elementsSelectable
            deleteKeyCode={isAdmin ? ["Backspace", "Delete"] : null}
            defaultViewport={{ x: 40, y: 80, zoom: 1 }}
            minZoom={0.1}
            proOptions={{ hideAttribution: true }}
            className="bg-canvas"
          >
            <Background color="var(--color-line)" gap={20} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line-subtle bg-canvas p-4">
          {message && (
            <p
              role={message.kind === "error" ? "alert" : "status"}
              className={cn(
                "rounded-md px-3 py-2 text-sm",
                message.kind === "error" ? "bg-danger-50 text-danger-600" : "bg-success-50 text-success-600",
              )}
            >
              {message.text}
            </p>
          )}
          {!isAdmin && <p className="text-sm text-fg-muted">只有空间管理员可以编辑模板。</p>}

          {selectedNode && (
            <NodePanel
              key={selectedNode.id}
              data={selectedNode.data}
              type={type}
              readOnly={!isAdmin}
              onChange={(patch) => updateNode(selectedNode.id, patch)}
              onDelete={() => {
                setNodes(edit((prev) => prev.filter((n) => n.id !== selectedNode.id)));
                setEdges((prev) => prev.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
              }}
            />
          )}
          {!selectedNode && selectedEdge && isAdmin && (
            <Card>
              <CardHeader>
                <CardTitle>连线</CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEdges(edit((prev) => prev.filter((e) => e.id !== selectedEdge.id)))}
                >
                  删除连线
                </Button>
              </CardContent>
            </Card>
          )}
          {!selectedNode && !selectedEdge && (
            <p className="text-sm text-fg-muted">
              点选节点编辑属性；从节点右侧的圆点拖到另一个节点左侧连线；选中后按 Delete 删除。
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle>状态计算规则</CardTitle>
            </CardHeader>
            <CardContent>
              <StageRulesEditor
                value={stageRules}
                conditionFields={flowConditionFields(definition, type.fields)}
                readOnly={!isAdmin}
                onChange={(next) => {
                  setStageRules(next);
                  setDirty(true);
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>检查</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {errors.length === 0 && validation.warnings.length === 0 && (
                <p className="text-success-600">没有发现问题，可以发布。</p>
              )}
              <ul aria-label="错误" className="flex flex-col gap-1 text-danger-600">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              <ul aria-label="提醒" className="flex flex-col gap-1 text-warning-600">
                {validation.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function NodeLabel({ data, type }: { data: NodeData; type: TypeConfig }) {
  const roleName = (key: string) => type.roles.find((r) => r.key === key)?.name ?? key;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="truncate text-[13px] font-medium">{data.name}</div>
      <div className="truncate text-xs text-fg-muted">
        {data.ownerRoles.map(roleName).join("、") || COMPLETION.find((c) => c.value === data.completion)?.label}
      </div>
      {(data.visibility || data.gate || data.stageOnArrival || data.form || data.tasks) && (
        <div className="truncate text-xs text-brand-500">
          {[
            data.visibility && "有出现条件",
            data.gate && "有卡点",
            data.form && "有表单",
            data.tasks && `${data.tasks.length} 个子任务`,
            data.stageOnArrival && `阶段：${data.stageOnArrival}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
    </div>
  );
}

function NodePanel({
  data,
  type,
  readOnly,
  onChange,
  onDelete,
}: {
  data: NodeData;
  type: TypeConfig;
  readOnly: boolean;
  onChange: (patch: Partial<NodeData>) => void;
  onDelete: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>节点</CardTitle>
      </CardHeader>
      <CardContent>
        <fieldset disabled={readOnly} className="flex flex-col gap-3">
          <Label className="flex flex-col gap-1.5">
            节点名称
            <Input value={data.name} onChange={(e) => onChange({ name: e.target.value })} />
          </Label>
          <Label className="flex flex-col gap-1.5">
            完成方式
            <Select
              value={data.completion}
              onChange={(e) => onChange({ completion: e.target.value as CompletionMode })}
            >
              {COMPLETION.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-fg">负责角色</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {type.roles.map((r) => (
                <Label key={r.key} className="flex items-center gap-1.5 font-normal">
                  <Checkbox
                    checked={data.ownerRoles.includes(r.key)}
                    onChange={(e) =>
                      onChange({
                        ownerRoles: e.target.checked
                          ? [...data.ownerRoles, r.key]
                          : data.ownerRoles.filter((k) => k !== r.key),
                      })
                    }
                  />
                  {r.name}
                </Label>
              ))}
              {type.roles.length === 0 && <span className="text-sm text-fg-muted">类型里还没有角色。</span>}
            </div>
          </fieldset>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-fg">可操作角色</legend>
            <p className="text-xs text-fg-subtle">除负责人和空间管理员外，还能回滚到这个节点、调整它排期的角色。</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {type.roles.map((r) => {
                const operators = data.operatorRoles ?? [];
                return (
                  <Label key={r.key} className="flex items-center gap-1.5 font-normal">
                    <Checkbox
                      aria-label={`可操作：${r.name}`}
                      checked={operators.includes(r.key)}
                      onChange={(e) => {
                        const next = e.target.checked ? [...operators, r.key] : operators.filter((k) => k !== r.key);
                        onChange({ operatorRoles: next.length > 0 ? next : undefined });
                      }}
                    />
                    {r.name}
                  </Label>
                );
              })}
            </div>
          </fieldset>
          <Label className="flex flex-col gap-1.5">
            预估工期（工作日）
            <Input
              type="number"
              min={0}
              value={data.duration ?? ""}
              placeholder={data.completion === "auto" ? "0（里程碑）" : "1"}
              onChange={(e) => onChange({ duration: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </Label>
          <Label className="flex flex-col gap-1.5">
            到达时设置阶段
            <Input
              value={data.stageOnArrival ?? ""}
              placeholder="不改阶段"
              onChange={(e) => onChange({ stageOnArrival: e.target.value || undefined })}
            />
          </Label>
          <ConditionEditor
            label="出现条件（不满足时跳过这个节点）"
            value={data.visibility}
            fields={type.fields}
            onChange={(visibility) => onChange({ visibility })}
          />
          <ConditionEditor
            label="卡点（满足后才能完成）"
            value={data.gate}
            fields={type.fields}
            onChange={(gate) => onChange({ gate })}
          />
          <FormEditor value={data.form ?? []} fields={type.fields} onChange={(form) => onChange({ form })} />
          <TasksEditor value={data.tasks ?? []} onChange={(tasks) => onChange({ tasks })} />
          <RelatedInfoEditor value={data.relatedInfo ?? []} onChange={(relatedInfo) => onChange({ relatedInfo })} />
          <NodeAdvancedEditor data={data} fields={type.fields} roles={type.roles} onChange={onChange} />
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg-subtle">键：{data.key}</span>
            <Button variant="ghost" size="sm" className="text-danger-600" onClick={onDelete}>
              删除节点
            </Button>
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}

/** 完成表单：负责人确认完成时要填的字段，可以设为必填。 */
function FormEditor({
  value,
  fields,
  onChange,
}: {
  value: NonNullable<NodeData["form"]>;
  fields: TypeConfig["fields"];
  onChange: (form: NodeData["form"]) => void;
}) {
  const set = (next: typeof value) => onChange(next.length > 0 ? next : undefined);
  // 公式字段由系统计算，不能放进表单
  const unused = fields.filter((f) => f.dataType !== "formula" && !value.some((v) => v.field === f.key));
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium text-fg">完成表单（确认完成时填写）</legend>
      {value.map((item) => {
        const field = fields.find((f) => f.key === item.field);
        return (
          <div key={item.field} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{field?.name ?? `${item.field}（不存在）`}</span>
            <Label className="flex items-center gap-1 font-normal text-fg-muted">
              <Checkbox
                aria-label={`${field?.name ?? item.field}必填`}
                checked={item.required === true}
                onChange={(e) =>
                  set(value.map((v) => (v.field === item.field ? { field: v.field, required: e.target.checked } : v)))
                }
              />
              必填
            </Label>
            <button
              type="button"
              aria-label={`从表单移除${field?.name ?? item.field}`}
              className="px-1 text-fg-subtle hover:text-danger-600"
              onClick={() => set(value.filter((v) => v.field !== item.field))}
            >
              ×
            </button>
          </div>
        );
      })}
      {unused.length > 0 && (
        <Select
          aria-label="添加表单字段"
          value=""
          onChange={(e) => e.target.value && set([...value, { field: e.target.value, required: true }])}
        >
          <option value="">+ 添加字段</option>
          {unused.map((f) => (
            <option key={f.key} value={f.key}>
              {f.name}
            </option>
          ))}
        </Select>
      )}
    </fieldset>
  );
}

/** 预置子任务：新建工作项时为节点建好的待办。 */
/** 节点上的关联信息：负责人确认时参考的、关联工作项上的字段（关联名 + 对端字段名）。 */
function RelatedInfoEditor({
  value,
  onChange,
}: {
  value: { relation: string; field: string }[];
  onChange: (info: { relation: string; field: string }[] | undefined) => void;
}) {
  const [relation, setRelation] = useState("");
  const [field, setField] = useState("");
  const set = (next: typeof value) => onChange(next.length > 0 ? next : undefined);
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium text-fg">关联信息（确认时参考）</legend>
      {value.map((info, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 同一关联可能取多个字段，按位置编辑
        <div key={i} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">
            {info.relation} · {info.field}
          </span>
          <button
            type="button"
            aria-label={`删除关联信息${info.relation} ${info.field}`}
            className="px-1 text-fg-subtle hover:text-danger-600"
            onClick={() => set(value.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!relation.trim() || !field.trim()) return;
          set([...value, { relation: relation.trim(), field: field.trim() }]);
          setField("");
        }}
      >
        <Input
          aria-label="关联名"
          placeholder="关联名"
          value={relation}
          onChange={(e) => setRelation(e.target.value)}
        />
        <Input
          aria-label="对端字段"
          placeholder="对端字段名"
          value={field}
          onChange={(e) => setField(e.target.value)}
        />
        <Button type="submit" variant="outline" size="sm" className="h-8">
          添加关联信息
        </Button>
      </form>
    </fieldset>
  );
}

function TasksEditor({ value, onChange }: { value: string[]; onChange: (tasks: string[] | undefined) => void }) {
  const [draft, setDraft] = useState("");
  const set = (next: string[]) => onChange(next.length > 0 ? next : undefined);
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium text-fg">预置子任务</legend>
      {value.map((name, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 子任务名可能重复，按位置编辑
        <div key={i} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <button
            type="button"
            aria-label={`删除预置子任务${name}`}
            className="px-1 text-fg-subtle hover:text-danger-600"
            onClick={() => set(value.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          set([...value, draft.trim()]);
          setDraft("");
        }}
      >
        <Input
          aria-label="预置子任务名称"
          placeholder="子任务名称"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button type="submit" variant="outline" size="sm" className="h-8">
          添加
        </Button>
      </form>
    </fieldset>
  );
}
