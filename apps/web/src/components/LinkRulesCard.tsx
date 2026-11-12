import { Popconfirm } from "@douyinfe/semi-ui";
import { nodeFlowOf } from "@fp/engine";
import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";
import { newId } from "@/lib/utils";

type Kind = "field" | "nodeDrive" | "nodeSchedule";
type Config =
  | { kind: "field"; sourceField: string; targetField: string }
  | { kind: "nodeDrive"; sourceNode: string; targetNode: string; mode: "complete" | "allow" }
  | { kind: "nodeSchedule"; sourceNode: string; targetNode: string };

interface TypeInfo {
  id: string;
  name: string;
  fields: readonly { key: string; name: string; dataType: string; formula?: unknown }[];
  relationDefs: readonly {
    id: string;
    name: string;
    reverseName: string | null;
    fromTypeId: string;
    toTypeId: string;
  }[];
  flowTemplates: readonly { currentVersion?: { definition: unknown } | null }[];
}

export interface LinkRuleRow {
  id: string;
  name: string;
  relationDefId: string;
  sourceSide: "from" | "to";
  config: Config | (Config & { sourceNodeName?: string });
  enabled: boolean | null;
}

const KIND_LABEL: Record<Kind, string> = { field: "字段同步", nodeDrive: "节点驱动", nodeSchedule: "排期同步" };

/** 类型所有流程模板当前版本里的节点。 */
function nodesOf(type: TypeInfo | undefined) {
  const nodes = new Map<string, string>();
  for (const t of type?.flowTemplates ?? [])
    for (const n of nodeFlowOf(t.currentVersion?.definition)?.nodes ?? [])
      if (!nodes.has(n.key)) nodes.set(n.key, n.name);
  return [...nodes].map(([key, name]) => ({ key, name }));
}

/**
 * 空间关联：挂在关系上的联动规则。源头一端变了，关联的另一端跟着变：
 * 字段同步、节点驱动（完成即完成 / 才允许完成）、节点排期同步。只有空间管理员可以改。
 */
export function LinkRulesCard({
  spaceId,
  types,
  rules,
  canManage,
}: {
  spaceId: string;
  /** 本空间的类型，加上跨空间关联另一端的类型（名称带空间名）。 */
  types: readonly TypeInfo[];
  rules: readonly LinkRuleRow[];
  canManage: boolean;
}) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);
  const defs = types.flatMap((t) => t.relationDefs);
  const type = (id: string) => types.find((t) => t.id === id);
  const typeName = (id: string) => type(id)?.name ?? "?";

  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const outcome = await zero.mutate(request).client;
    if (outcome.type === "error") setError(outcome.error.message);
    return outcome.type !== "error";
  }

  /** 规则的源和目标：类型、在源头看到的关系名。 */
  const ends = (rule: Pick<LinkRuleRow, "relationDefId" | "sourceSide">) => {
    const def = defs.find((d) => d.id === rule.relationDefId);
    if (!def) return null;
    return rule.sourceSide === "from"
      ? { source: def.fromTypeId, target: def.toTypeId, via: def.name }
      : { source: def.toTypeId, target: def.fromTypeId, via: def.reverseName ?? `${def.name}（反向）` };
  };
  const describe = (rule: LinkRuleRow) => {
    const e = ends(rule);
    if (!e) return "关系已删除";
    const c = rule.config;
    const fieldName = (typeId: string, key: string) => type(typeId)?.fields.find((f) => f.key === key)?.name ?? key;
    const nodeName = (typeId: string, key: string) => nodesOf(type(typeId)).find((n) => n.key === key)?.name ?? key;
    switch (c.kind) {
      case "field":
        return `「${fieldName(e.source, c.sourceField)}」同步到「${fieldName(e.target, c.targetField)}」`;
      case "nodeDrive":
        return `「${nodeName(e.source, c.sourceNode)}」完成后，「${nodeName(e.target, c.targetNode)}」${c.mode === "complete" ? "即完成" : "才允许完成"}`;
      case "nodeSchedule":
        return `「${nodeName(e.source, c.sourceNode)}」的排期同步到「${nodeName(e.target, c.targetNode)}」`;
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle>空间关联</CardTitle>
          <CardDescription>
            关联起来的工作项之间按规则联动：源头一端的字段、节点完成、节点排期变了，关联的另一端自动跟着变。
            联动以创建规则的管理员的身份执行。
          </CardDescription>
        </div>
        {canManage && defs.length > 0 && <CreateRule spaceId={spaceId} types={types} onCreate={run} />}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {defs.length === 0 && (
          <p className="text-sm text-fg-muted">还没有关系。先在「工作项 → 高级设置 → 关系管理」里建一条关系。</p>
        )}
        <table aria-label="联动规则" className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-subtle text-left text-xs text-fg-muted">
              <th className="py-2 font-normal">名称</th>
              <th className="py-2 font-normal">关联</th>
              <th className="py-2 font-normal">规则</th>
              <th className="py-2 font-normal">启用</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => {
              const e = ends(rule);
              return (
                <tr key={rule.id} aria-label={rule.name} className="border-b border-line-subtle last:border-0">
                  <td className="py-2 pr-3">{rule.name}</td>
                  <td className="py-2 pr-3 text-fg-muted">
                    {e ? `${typeName(e.source)} →（${e.via}）→ ${typeName(e.target)}` : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="mr-1.5 text-xs text-fg-subtle">{KIND_LABEL[rule.config.kind]}</span>
                    {describe(rule)}
                  </td>
                  <td className="py-2">
                    <Checkbox
                      aria-label={`启用 ${rule.name}`}
                      checked={rule.enabled !== false}
                      disabled={!canManage}
                      onChange={(ev) => run(mutators.linkRule.setEnabled({ id: rule.id, enabled: ev.target.checked }))}
                    />
                  </td>
                  <td className="py-2 text-right">
                    {canManage && (
                      <Popconfirm
                        title={`删除规则「${rule.name}」？`}
                        content="已经同步过去的数据不会变回去。"
                        okText="删除"
                        okType="danger"
                        onConfirm={() => run(mutators.linkRule.delete({ id: rule.id }))}
                      >
                        <Button variant="ghost" size="sm">
                          删除
                        </Button>
                      </Popconfirm>
                    )}
                  </td>
                </tr>
              );
            })}
            {rules.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-fg-muted">
                  还没有联动规则。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function CreateRule({
  spaceId,
  types,
  onCreate,
}: {
  spaceId: string;
  types: readonly TypeInfo[];
  onCreate: (request: Parameters<ReturnType<typeof useZero>["mutate"]>[0]) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const defs = types.flatMap((t) => t.relationDefs);
  const type = (id: string) => types.find((t) => t.id === id);
  const typeName = (id: string) => type(id)?.name ?? "?";
  // 每条关系两个方向：从本端到对端，或反过来
  const directions = defs.flatMap((d) => [
    { value: `${d.id}|from`, label: `${typeName(d.fromTypeId)} → ${typeName(d.toTypeId)}（${d.name}）` },
    {
      value: `${d.id}|to`,
      label: `${typeName(d.toTypeId)} → ${typeName(d.fromTypeId)}（${d.reverseName ?? `${d.name}，反向`}）`,
    },
  ]);
  const [direction, setDirection] = useState(directions[0]?.value ?? "");
  const [kind, setKind] = useState<Kind>("field");
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<"complete" | "allow">("allow");

  const [defId, side] = direction.split("|") as [string, "from" | "to"];
  const def = defs.find((d) => d.id === defId);
  const sourceType = type((side === "from" ? def?.fromTypeId : def?.toTypeId) ?? "");
  const targetType = type((side === "from" ? def?.toTypeId : def?.fromTypeId) ?? "");
  const sourceFields = sourceType?.fields ?? [];
  const sourceField = sourceFields.find((f) => f.key === source);
  // 目标字段：同类型、不是公式
  const targetFields = (targetType?.fields ?? []).filter(
    (f) => !f.formula && (!sourceField || f.dataType === sourceField.dataType),
  );
  const sourceOptions = kind === "field" ? sourceFields : nodesOf(sourceType);
  const targetOptions = kind === "field" ? targetFields : nodesOf(targetType);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    const config: Config =
      kind === "field"
        ? { kind, sourceField: source, targetField: target }
        : kind === "nodeDrive"
          ? { kind, sourceNode: source, targetNode: target, mode }
          : { kind, sourceNode: source, targetNode: target };
    if (
      await onCreate(
        mutators.linkRule.create({ id: newId(), spaceId, name, relationDefId: defId, sourceSide: side, config }),
      )
    )
      setOpen(false);
  }

  const reset = () => {
    setSource("");
    setTarget("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>新建规则</Button>
      </DialogTrigger>
      <DialogContent title="新建联动规则">
        <form className="flex flex-col gap-3" onSubmit={create}>
          <Field label="规则名称">
            <Input name="name" required maxLength={50} />
          </Field>
          <Field label="关联" hint="源头 → 跟着变的一端，沿哪条关系">
            <Select
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value);
                reset();
              }}
            >
              {directions.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="规则类型">
            <Select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as Kind);
                reset();
              }}
            >
              <option value="field">字段同步</option>
              <option value="nodeDrive">节点驱动</option>
              <option value="nodeSchedule">排期同步</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={kind === "field" ? "源字段" : "源节点"}>
              <Select
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  if (kind === "field") setTarget("");
                }}
              >
                <option value="">请选择</option>
                {sourceOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={kind === "field" ? "目标字段" : "目标节点"}>
              <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">请选择</option>
                {targetOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {kind === "nodeDrive" && (
            <Field label="驱动方式">
              <Select value={mode} onChange={(e) => setMode(e.target.value as "complete" | "allow")}>
                <option value="allow">源节点完成后，目标节点才允许完成</option>
                <option value="complete">源节点完成后，目标节点即完成</option>
              </Select>
            </Field>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!source || !target}>
              确定
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
