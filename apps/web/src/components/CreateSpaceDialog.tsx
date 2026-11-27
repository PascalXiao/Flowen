import { mutators, queries, TEMPLATE_SCOPE_LABEL } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useNavigate } from "@tanstack/react-router";
import { Copy, FilePlus2, LayoutTemplate } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { api, postJson } from "@/lib/api";
import { cn, newId } from "@/lib/utils";

/** 官方模板：内置的示例流程（新品开发「项目」），建空白空间后导入。 */
export const DEMO_TEMPLATE = "official:demo";

type Mode = "blank" | "template" | "copy";

/**
 * 新建空间：空白空间、从模板新建（官方、企业、个人模板）、复制我管理的空间（只复制配置）。
 * 和飞书一样，空间名称之外的配置都来自模板或被复制的空间。
 */
export function CreateSpaceDialog({
  open,
  onOpenChange,
  initialTemplate,
  initialCopyFrom,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTemplate?: string;
  initialCopyFrom?: string;
}) {
  const zero = useZero();
  const navigate = useNavigate();
  const [templates] = useQuery(queries.spaceTemplates.visible());
  const [spaces] = useQuery(queries.spaces.panoramaSources());
  const managed = spaces.filter((s) => s.members.some((m) => m.userId === zero.userID && m.role === "admin"));
  const [mode, setMode] = useState<Mode>("blank");
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string>(DEMO_TEMPLATE);
  const [copyFrom, setCopyFrom] = useState("");
  const [copy, setCopy] = useState({ views: true, charts: true, members: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 只在打开时按传入的初始值设一次（空间列表后到也不覆盖用户已经改的）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 同上
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (initialTemplate) {
      setMode("template");
      setTemplateId(initialTemplate);
    } else if (initialCopyFrom) {
      setMode("copy");
      setCopyFrom(initialCopyFrom);
      const source = spaces.find((s) => s.id === initialCopyFrom);
      if (source) setName(`${source.name} 副本`);
    }
  }, [open, initialTemplate, initialCopyFrom]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    const id = newId();
    try {
      if (mode === "blank") {
        // 空白空间乐观创建，留在空间列表
        zero.mutate(mutators.space.create({ id, name: trimmed }));
        setName("");
        onOpenChange(false);
        return;
      }
      if (mode === "template" && templateId === DEMO_TEMPLATE) {
        const { server } = zero.mutate(mutators.space.create({ id, name: trimmed }));
        const result = await server;
        if (result.type === "error") throw new Error(result.error.message);
        const res = await api(`/api/spaces/${id}/import-demo`, { method: "POST" });
        if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "导入模板失败。");
      } else if (mode === "template") {
        await postJson("/api/spaces/from-template", { templateId, id, name: trimmed });
      } else {
        if (!copyFrom) throw new Error("请选择要复制的空间。");
        await postJson(`/api/spaces/${copyFrom}/copy`, { id, name: trimmed, ...copy });
      }
      setName("");
      onOpenChange(false);
      navigate({ to: "/spaces/$spaceId", params: { spaceId: id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败。");
    } finally {
      setBusy(false);
    }
  }

  const choices = [
    {
      id: DEMO_TEMPLATE,
      name: "新品开发（示例流程）",
      scope: "官方模板",
      description: "工作项类型「项目」：48 个节点的标准新品开发流程、字段和角色。",
    },
    ...templates.map((t) => ({
      id: t.id,
      name: t.name,
      scope: TEMPLATE_SCOPE_LABEL[t.scope as "personal" | "org"],
      description:
        t.description ||
        `${t.summary.types.map((x) => x.name).join("、") || "没有工作项类型"}${t.summary.items ? ` · ${t.summary.items} 个实例` : ""}`,
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="新建空间" className="max-w-xl">
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <Segmented
            label="新建方式"
            value={mode}
            onChange={(next) => {
              setMode(next);
              setError(null);
            }}
            items={[
              [
                "blank",
                <>
                  <FilePlus2 />
                  空白空间
                </>,
              ],
              [
                "template",
                <>
                  <LayoutTemplate />
                  使用模板
                </>,
              ],
              [
                "copy",
                <>
                  <Copy />
                  复制空间
                </>,
              ],
            ]}
          />
          {mode === "template" && (
            <fieldset aria-label="选择模板" className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {choices.map((c) => (
                <label
                  key={c.id}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5",
                    templateId === c.id ? "border-accent bg-brand-50/40" : "border-line-subtle hover:bg-hover",
                  )}
                >
                  <input
                    type="radio"
                    name="template"
                    className="fl-radio mt-0.5"
                    checked={templateId === c.id}
                    onChange={() => setTemplateId(c.id)}
                    aria-label={c.name}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium text-sm">{c.name}</span>
                      <Tag tone={c.scope === "官方模板" ? "teal" : c.scope === "企业模板" ? "violet" : "neutral"}>
                        {c.scope}
                      </Tag>
                    </span>
                    <span className="truncate text-fg-subtle text-xs">{c.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {mode === "copy" && (
            <div className="flex flex-col gap-3">
              <fieldset aria-label="要复制的空间" className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {managed.length === 0 && <p className="text-fg-subtle text-sm">你还没有管理的空间。</p>}
                {managed.map((s) => (
                  <label
                    key={s.id}
                    className={cn(
                      "flex h-9 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm",
                      copyFrom === s.id ? "border-accent bg-brand-50/40" : "border-line-subtle hover:bg-hover",
                    )}
                  >
                    <input
                      type="radio"
                      name="copyFrom"
                      className="fl-radio"
                      checked={copyFrom === s.id}
                      onChange={() => {
                        setCopyFrom(s.id);
                        if (!name.trim()) setName(`${s.name} 副本`);
                      }}
                      aria-label={s.name}
                    />
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto text-fg-subtle text-xs">{s.workItemTypes.length} 个工作项类型</span>
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="text-fg-muted">
                  复制工作项类型、字段、角色、流程、页面布局、权限、关联、层级、联动和自动化规则，不复制工作项。
                </span>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  <Checkbox checked={copy.views} onChange={(e) => setCopy({ ...copy, views: e.target.checked })}>
                    公共视图
                  </Checkbox>
                  <Checkbox checked={copy.charts} onChange={(e) => setCopy({ ...copy, charts: e.target.checked })}>
                    度量图表
                  </Checkbox>
                  <Checkbox checked={copy.members} onChange={(e) => setCopy({ ...copy, members: e.target.checked })}>
                    成员和用户组成员
                  </Checkbox>
                </div>
              </div>
            </div>
          )}
          <Field label="空间名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus />
          </Field>
          {error && <p className="text-danger-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "创建中…" : "创建"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
