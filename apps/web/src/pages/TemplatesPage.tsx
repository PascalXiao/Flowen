import { demoSample } from "@fp/engine";
import { mutators, queries, TEMPLATE_SCOPE_LABEL } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Eye, LayoutTemplate, Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { CreateSpaceDialog, DEMO_TEMPLATE } from "@/components/CreateSpaceDialog";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { EmptyState, PageBody, PageHeader } from "@/components/ui/page";
import { Tabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { useIsOrgAdmin } from "@/lib/org";

type Summary = {
  types: { name: string; flowMode: "node" | "state"; fields: number; roles: number; templates: number }[];
  views: string[];
  charts: string[];
  items: number;
  automations: number;
};
interface Card {
  id: string;
  name: string;
  description: string | null;
  scope: "official" | "org" | "personal";
  author: { id: string; name: string } | null;
  summary: Summary;
  updatedAt: number | null;
  mine: boolean;
}

const SCOPE_TAG = {
  official: ["官方模板", "teal"],
  org: ["企业模板", "violet"],
  personal: ["个人模板", "neutral"],
} as const;

/** 官方模板：内置的示例流程。 */
const OFFICIAL: Card = {
  id: DEMO_TEMPLATE,
  name: "新品开发（示例流程）",
  description: `从概念、立项、开发到上市的标准新品开发流程，含 ${demoSample.demoFlow.nodes.length} 个节点、流程字段和角色。`,
  scope: "official",
  author: null,
  summary: {
    types: [
      {
        name: "项目",
        flowMode: "node",
        fields: Object.keys(demoSample.F).length,
        roles: new Set(demoSample.demoFlow.nodes.flatMap((n) => n.ownerRoles)).size,
        templates: 1,
      },
    ],
    views: [],
    charts: [],
    items: 0,
    automations: 0,
  },
  updatedAt: null,
  mine: false,
};

const TABS = [
  ["all", "全部"],
  ["official", "官方模板"],
  ["org", "企业模板"],
  ["personal", "我的模板"],
] as const;

/**
 * 模板中心：官方模板、企业模板（企业管理员发布，所有人可用）、我的模板（自己存的个人模板）。
 * 预览看模板里有哪些工作项类型、视图、图表、实例；用模板新建空间。在空间配置的「空间信息」里存为模板。
 */
export function TemplatesPage() {
  useActiveSpace(null);
  const zero = useZero();
  const orgAdmin = useIsOrgAdmin();
  const [rows] = useQuery(queries.spaceTemplates.visible());
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("all");
  const [using, setUsing] = useState<string | null>(null);
  const [preview, setPreview] = useState<Card | null>(null);
  const [editing, setEditing] = useState<Card | null>(null);

  const cards: Card[] = [
    OFFICIAL,
    ...rows.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      scope: t.scope as "org" | "personal",
      author: t.creator ? { id: t.creator.id, name: t.creator.name } : null,
      summary: t.summary as Summary,
      updatedAt: t.updatedAt,
      mine: t.createdBy === zero.userID,
    })),
  ];
  const shown = cards.filter((c) => tab === "all" || (tab === "personal" ? c.scope === "personal" : c.scope === tab));

  return (
    <>
      <PageHeader title="模板中心" tabs={<Tabs label="模板范围" value={tab} onChange={setTab} items={TABS} />} />
      <PageBody>
        <p className="text-fg-muted text-sm">
          用模板新建空间，直接得到配好的工作项类型、流程、字段、角色、视图和自动化。在空间配置的「空间信息」里可以把空间存为模板。
        </p>
        {shown.length === 0 ? (
          <EmptyState
            title={tab === "personal" ? "还没有自己的模板" : "还没有企业模板"}
            description="到空间配置的「空间信息」里点「存为模板」。"
          />
        ) : (
          <ul aria-label="模板列表" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((c) => {
              const [scopeLabel, tone] = SCOPE_TAG[c.scope];
              const canEdit = c.scope !== "official" && (c.mine || orgAdmin);
              return (
                <li
                  key={c.id}
                  aria-label={c.name}
                  className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface p-4 shadow-card"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-pressed text-fg-muted">
                      <LayoutTemplate className="size-4.5" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">{c.name}</span>
                        <Tag tone={tone}>{scopeLabel}</Tag>
                      </span>
                      <span className="line-clamp-2 min-h-8 text-fg-subtle text-xs">
                        {c.description || "没有说明。"}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.summary.types.map((t) => (
                      <Tag key={t.name}>{t.name}</Tag>
                    ))}
                  </div>
                  <p className="text-fg-muted text-xs">
                    {c.summary.types.length} 个工作项类型 · {c.summary.views.length} 个视图 · {c.summary.charts.length}{" "}
                    张图表 · {c.summary.automations} 条自动化 · {c.summary.items} 个实例
                  </p>
                  <div className="mt-auto flex items-center gap-2 border-line-subtle border-t pt-3">
                    {c.author ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-fg-subtle text-xs">
                        <Avatar id={c.author.id} name={c.author.name} size={18} />
                        <span className="truncate">{c.author.name}</span>
                      </span>
                    ) : (
                      <span className="text-fg-subtle text-xs">Flowen</span>
                    )}
                    <span className="ml-auto flex items-center gap-1">
                      <Button variant="ghost" size="sm" aria-label={`预览 ${c.name}`} onClick={() => setPreview(c)}>
                        <Eye />
                      </Button>
                      {canEdit && (
                        <>
                          <Button variant="ghost" size="sm" aria-label={`编辑 ${c.name}`} onClick={() => setEditing(c)}>
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`删除 ${c.name}`}
                            onClick={() => {
                              if (window.confirm(`删除模板「${c.name}」？用它建好的空间不受影响。`))
                                zero.mutate(mutators.spaceTemplate.delete({ id: c.id }));
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </>
                      )}
                      <Button size="sm" onClick={() => setUsing(c.id)}>
                        使用模板
                      </Button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PageBody>
      <CreateSpaceDialog
        open={using !== null}
        onOpenChange={(open) => !open && setUsing(null)}
        initialTemplate={using ?? undefined}
      />
      <PreviewDialog card={preview} onClose={() => setPreview(null)} onUse={(id) => setUsing(id)} />
      {editing && <EditDialog card={editing} orgAdmin={orgAdmin} onClose={() => setEditing(null)} />}
    </>
  );
}

function PreviewDialog({
  card,
  onClose,
  onUse,
}: {
  card: Card | null;
  onClose: () => void;
  onUse: (id: string) => void;
}) {
  return (
    <Dialog open={card !== null} onOpenChange={(open) => !open && onClose()}>
      {card && (
        <DialogContent title={card.name} description={card.description ?? undefined} className="max-w-2xl">
          <div className="flex flex-col gap-4 text-sm">
            <section className="flex flex-col gap-2">
              <h3 className="font-medium">工作项类型</h3>
              <table className="w-full text-sm">
                <thead className="text-fg-subtle text-xs">
                  <tr className="h-7 text-left">
                    <th className="font-normal">名称</th>
                    <th className="font-normal">流程</th>
                    <th className="font-normal">字段</th>
                    <th className="font-normal">角色</th>
                    <th className="font-normal">流程模板</th>
                  </tr>
                </thead>
                <tbody>
                  {card.summary.types.map((t) => (
                    <tr key={t.name} className="h-8 border-line-subtle border-t">
                      <td>{t.name}</td>
                      <td className="text-fg-muted">{t.flowMode === "state" ? "状态流" : "节点流"}</td>
                      <td className="tabular-nums">{t.fields}</td>
                      <td className="tabular-nums">{t.roles}</td>
                      <td className="tabular-nums">{t.templates}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <h3 className="font-medium">视图</h3>
                <p className="text-fg-muted">{card.summary.views.join("、") || "不含视图"}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="font-medium">图表</h3>
                <p className="text-fg-muted">{card.summary.charts.join("、") || "不含图表"}</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="font-medium">自动化</h3>
                <p className="text-fg-muted">{card.summary.automations} 条规则</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="font-medium">实例</h3>
                <p className="text-fg-muted">{card.summary.items ? `${card.summary.items} 个工作项` : "不含实例"}</p>
              </div>
            </section>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                关闭
              </Button>
              <Button
                onClick={() => {
                  onClose();
                  onUse(card.id);
                }}
              >
                使用模板
              </Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function EditDialog({ card, orgAdmin, onClose }: { card: Card; orgAdmin: boolean; onClose: () => void }) {
  const zero = useZero();
  const [name, setName] = useState(card.name);
  const [description, setDescription] = useState(card.description ?? "");
  const [scope, setScope] = useState(card.scope as "org" | "personal");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await zero.mutate(
      mutators.spaceTemplate.update({ id: card.id, name: name.trim(), description: description.trim() || null, scope }),
    ).server;
    if (result.type === "error") return setError(result.error.message);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="编辑模板">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="模板名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
          </Field>
          <Field label="模板说明">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </Field>
          <Field label="发布范围" hint={orgAdmin ? undefined : "企业模板只有企业管理员可以发布或撤下。"}>
            <Select value={scope} disabled={!orgAdmin} onChange={(e) => setScope(e.target.value as "org" | "personal")}>
              {(["personal", "org"] as const).map((s) => (
                <option key={s} value={s}>
                  {TEMPLATE_SCOPE_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          {error && <p className="text-danger-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
