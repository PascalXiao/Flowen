import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link, useParams } from "@tanstack/react-router";
import { X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";
import { Tabs } from "@/components/ui/tabs";
import { newId } from "@/lib/utils";

/**
 * 空间配置 → 工作项 → 高级设置：全屏页，对照飞书项目的「高级设置」。
 * 现在有「关系管理」：工作项之间的关联，一条关系两端各有一个关联字段。
 * 层级管理、跨空间授权、组合字段还没有对应的功能。
 */
export function AdvancedConfigPage() {
  const { spaceId } = useParams({ from: "/app/spaces/$spaceId/setting/advanced" });
  const zero = useZero();
  const [space, result] = useQuery(queries.spaces.byId({ id: spaceId }));
  useActiveSpace(spaceId);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  if (!space)
    return (
      <p className="p-6 text-sm text-fg-muted">{result.type === "complete" ? "空间不存在或没有权限。" : "加载中…"}</p>
    );
  const isAdmin = space.members.some((m) => m.userId === zero.userID && m.role === "admin");
  const typeName = (id: string) => space.workItemTypes.find((t) => t.id === id)?.name ?? "?";
  const defs = space.workItemTypes.flatMap((t) => t.relationDefs);
  const shown = defs.filter((d) => {
    const keyword = q.trim().toLowerCase();
    return (
      !keyword ||
      [d.name, d.reverseName ?? "", typeName(d.fromTypeId), typeName(d.toTypeId)]
        .join(" ")
        .toLowerCase()
        .includes(keyword)
    );
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line-subtle bg-surface px-4">
        <span className="font-semibold">高级设置</span>
        <Tabs
          label="高级设置"
          className="mx-auto"
          value="relation"
          onChange={() => {}}
          items={[["relation", "关系管理"]]}
        />
        <Link
          to="/spaces/$spaceId/setting/$tab"
          params={{ spaceId, tab: "workObjectSetting" }}
          aria-label="关闭"
          className="rounded-md p-1 text-fg-muted hover:bg-hover hover:text-fg"
        >
          <X className="size-5" />
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <h2 className="text-lg font-semibold">关系管理</h2>
              <p className="text-sm text-fg-muted">
                管理工作项之间怎么关联。一条关系的两端各有一个关联字段，可以在详情页里添加和取消。
              </p>
            </div>
            <Input
              aria-label="按名称搜索关系"
              placeholder="按名称搜索"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-56"
            />
            {isAdmin && <CreateRelation space={space} onError={setError} />}
          </div>
          <div className="rounded-lg border border-line-subtle bg-surface shadow-card">
            <table aria-label="关系列表" className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-subtle text-left text-xs text-fg-muted">
                  <th className="px-4 py-2 font-normal">名称</th>
                  <th className="px-4 py-2 font-normal">关系</th>
                  <th className="px-4 py-2 font-normal">关系类型</th>
                  <th className="px-4 py-2 font-normal">使用中的字段</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.id} className="border-b border-line-subtle last:border-0 hover:bg-hover/50">
                    <td className="px-4 py-2">
                      {typeName(d.fromTypeId)}-{typeName(d.toTypeId)}关联
                    </td>
                    <td className="px-4 py-2">
                      {typeName(d.fromTypeId)} ↔ {typeName(d.toTypeId)}
                    </td>
                    <td className="px-4 py-2 text-fg-muted">{d.reverseName ? "互相关联" : "单向关联"}</td>
                    <td className="px-4 py-2">{[d.name, d.reverseName].filter(Boolean).join("；")}</td>
                    <td className="px-4 py-2 text-right">
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`删除关系 ${d.name}`}
                          onClick={async () => {
                            setError(null);
                            const outcome = await zero.mutate(mutators.relationDef.delete({ id: d.id })).client;
                            if (outcome.type === "error") setError(outcome.error.message);
                          }}
                        >
                          删除
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-fg-muted">
                      还没有关系。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateRelation({
  space,
  onError,
}: {
  space: { workItemTypes: readonly { id: string; name: string }[] };
  onError: (message: string | null) => void;
}) {
  const zero = useZero();
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState(space.workItemTypes[0]?.id ?? "");
  const [toId, setToId] = useState(space.workItemTypes[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const typeOptions = space.workItemTypes.map((t) => (
    <option key={t.id} value={t.id}>
      {t.name}
    </option>
  ));

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (key: string) => String(data.get(key) ?? "").trim();
    setError(null);
    const outcome = await zero.mutate(
      mutators.relationDef.create({
        id: newId(),
        fromTypeId: fromId,
        toTypeId: toId,
        name: text("name"),
        cardinality: text("cardinality") === "one" ? "one" : "many",
        ...(text("reverseName") && {
          reverseName: text("reverseName"),
          reverseCardinality: text("reverseCardinality") === "one" ? ("one" as const) : ("many" as const),
        }),
      }),
    ).client;
    if (outcome.type === "error") return setError(outcome.error.message);
    onError(null);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>新建关系</Button>
      </DialogTrigger>
      <DialogContent title="新建关系">
        <form className="flex flex-col gap-3" onSubmit={create}>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="本端工作项">
              <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
                {typeOptions}
              </Select>
            </Field>
            <Field label="对端工作项">
              <Select value={toId} onChange={(e) => setToId(e.target.value)}>
                {typeOptions}
              </Select>
            </Field>
            <Field label="本端字段名称" hint="本端工作项上用来关联对端的字段，如「关联SKU」">
              <Input name="name" required />
            </Field>
            <Field label="对端字段名称" hint="对端工作项上的字段，不填就只有本端有字段">
              <Input name="reverseName" />
            </Field>
            <Field label="本端字段数量">
              <Select name="cardinality" defaultValue="many">
                <option value="many">可以关联多个</option>
                <option value="one">只能关联一个</option>
              </Select>
            </Field>
            <Field label="对端字段数量">
              <Select name="reverseCardinality" defaultValue="many">
                <option value="many">可以关联多个</option>
                <option value="one">只能关联一个</option>
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit">确定</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
