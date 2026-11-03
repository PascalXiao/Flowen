import {
  type StatusCategory,
  type StatusFlowDefinition,
  type TransitionDefinition,
  validateStatusFlow,
} from "@fp/engine";
import { checkReferences, flowVersionId, mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronRight, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ConditionEditor } from "@/components/ConditionEditor";
import { CATEGORY_LABEL, StatusDiagram } from "@/components/StatusDiagram";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Tag } from "@/components/ui/tag";
import { cn, newId } from "@/lib/utils";
import type { Template, TypeConfig } from "@/pages/TemplateEditorPage";

const CATEGORIES = Object.entries(CATEGORY_LABEL) as [StatusCategory, string][];

/** 状态流模板编辑器：上面是状态流图，下面编辑状态和流转；保存为草稿，校验通过后发布。 */
export function StatusFlowEditor({
  template,
  type,
  base,
}: {
  template: Template;
  type: TypeConfig;
  base: StatusFlowDefinition;
}) {
  const zero = useZero();
  const latest = template.versions[0] as Template["versions"][number];
  const [definition, setDefinition] = useState(base);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const isAdmin = type.space?.members.some((m) => m.role === "admin") ?? false;
  const validation = validateStatusFlow(definition);
  const errors = [
    ...validation.errors,
    ...checkReferences(
      definition,
      type.roles.map((r) => r.key),
      type.fields.map((f) => f.key),
    ),
  ];
  const draftId = latest.publishedAt ? flowVersionId(template.id, latest.version + 1) : latest.id;
  const nameOf = (key: string) => definition.statuses.find((s) => s.key === key)?.name ?? key;

  const change = (next: StatusFlowDefinition) => {
    setDefinition(next);
    setDirty(true);
  };
  const setStatus = (key: string, patch: Partial<StatusFlowDefinition["statuses"][number]>) =>
    change({ ...definition, statuses: definition.statuses.map((s) => (s.key === key ? { ...s, ...patch } : s)) });
  const setTransition = (t: TransitionDefinition, patch: Partial<TransitionDefinition>) =>
    change({
      ...definition,
      transitions: definition.transitions.map((x) => (x === t ? { ...x, ...patch } : x)),
    });

  function addStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    change({
      ...definition,
      statuses: [...definition.statuses, { key: `s_${newId().slice(0, 8)}`, name, category: "doing" }],
    });
    form.reset();
  }

  function addTransition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const from = String(data.get("from") ?? "");
    const to = String(data.get("to") ?? "");
    if (!from || !to) return;
    change({ ...definition, transitions: [...definition.transitions, { from, to }] });
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
    if (await mutate(mutators.flowTemplate.publish({ versionId: draftId })))
      setMessage({ kind: "info", text: "已发布。之后新建的工作项会用这个版本，已有的工作项不受影响。" });
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
          <Tag tone="violet">状态流</Tag>
          <Tag tone={latest.publishedAt ? "success" : "warning"}>{status}</Tag>
          {dirty && <span className="text-xs text-warning-600">有未保存的修改</span>}
          <div className="ml-auto flex items-center gap-2">
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
        <fieldset disabled={!isAdmin} className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto bg-canvas p-6">
          <StatusDiagram
            definition={definition}
            className="h-56 overflow-hidden rounded-lg border border-line-subtle"
          />

          <Card>
            <CardHeader>
              <CardTitle>状态</CardTitle>
              <CardDescription>
                第一个状态是新工作项的初始状态。进入“已完成”“已关闭”类的状态时工作项结束。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul
                aria-label="状态列表"
                className="flex flex-col divide-y divide-line-subtle rounded-md border border-line-subtle"
              >
                {definition.statuses.map((s, i) => (
                  <li key={s.key} className="flex h-11 items-center gap-2 px-3">
                    <Input
                      aria-label={`第 ${i + 1} 个状态的名称`}
                      value={s.name}
                      onChange={(e) => setStatus(s.key, { name: e.target.value })}
                      className="h-8 w-48"
                    />
                    <Select
                      aria-label={`${s.name}的类别`}
                      value={s.category}
                      onChange={(e) => setStatus(s.key, { category: e.target.value as StatusCategory })}
                      className="w-28"
                    >
                      {CATEGORIES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                    {i === 0 && <Tag tone="brand">初始状态</Tag>}
                    <button
                      type="button"
                      aria-label={`删除状态${s.name}`}
                      className="ml-auto text-fg-subtle hover:text-danger-600"
                      onClick={() =>
                        change({
                          ...definition,
                          statuses: definition.statuses.filter((x) => x.key !== s.key),
                          transitions: definition.transitions.filter((t) => t.from !== s.key && t.to !== s.key),
                        })
                      }
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              <form className="flex gap-2" onSubmit={addStatus}>
                <Input name="name" aria-label="新状态名称" placeholder="新状态名称，例如：待验证" className="w-64" />
                <Button type="submit" variant="outline">
                  添加状态
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>流转</CardTitle>
              <CardDescription>
                工作项只能沿这里列出的方向流转。不勾角色表示空间成员都能操作；空间管理员总是可以。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul
                aria-label="流转列表"
                className="flex flex-col divide-y divide-line-subtle rounded-md border border-line-subtle"
              >
                {definition.transitions.map((t) => {
                  const label = `${nameOf(t.from)} → ${nameOf(t.to)}`;
                  return (
                    <li key={`${t.from}->${t.to}`} aria-label={label} className="flex flex-col gap-2 p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{nameOf(t.from)}</span>
                        <ArrowRight className="size-4 text-fg-subtle" />
                        <span className="font-medium">{nameOf(t.to)}</span>
                        <button
                          type="button"
                          aria-label={`删除流转${label}`}
                          className="ml-auto text-fg-subtle hover:text-danger-600"
                          onClick={() =>
                            change({ ...definition, transitions: definition.transitions.filter((x) => x !== t) })
                          }
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-fg-muted">可操作的角色：</span>
                        {type.roles.map((r) => {
                          const on = t.roles?.includes(r.key) ?? false;
                          return (
                            <button
                              key={r.key}
                              type="button"
                              aria-pressed={on}
                              aria-label={`${label}：${r.name}`}
                              className={cn(
                                "h-6 rounded-full border px-2.5 text-xs",
                                on
                                  ? "border-brand-500 bg-brand-50 text-brand-500"
                                  : "border-line text-fg-muted hover:bg-hover",
                              )}
                              onClick={() => {
                                const roles = on
                                  ? (t.roles ?? []).filter((k) => k !== r.key)
                                  : [...(t.roles ?? []), r.key];
                                setTransition(t, { roles: roles.length > 0 ? roles : undefined });
                              }}
                            >
                              {r.name}
                            </button>
                          );
                        })}
                        {!t.roles?.length && <span className="text-xs text-fg-subtle">（所有成员）</span>}
                      </div>
                      <ConditionEditor
                        label={`流转条件（满足后才能流转）`}
                        value={t.gate}
                        fields={type.fields}
                        onChange={(gate) => setTransition(t, { gate })}
                      />
                    </li>
                  );
                })}
              </ul>
              <form className="flex items-center gap-2" onSubmit={addTransition}>
                <Select name="from" aria-label="流转起点" className="w-36">
                  {definition.statuses.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <ArrowRight className="size-4 text-fg-subtle" />
                <Select name="to" aria-label="流转终点" className="w-36">
                  {definition.statuses.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="outline">
                  添加流转
                </Button>
              </form>
            </CardContent>
          </Card>
        </fieldset>
        <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line-subtle bg-canvas p-4">
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
