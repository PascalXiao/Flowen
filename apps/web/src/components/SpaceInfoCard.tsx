import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { Copy, LayoutTemplate } from "lucide-react";
import { type FormEvent, useState } from "react";
import { CreateSpaceDialog } from "@/components/CreateSpaceDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Toast } from "@/components/ui/toast";
import { postJson } from "@/lib/api";
import { useIsOrgAdmin } from "@/lib/org";

/**
 * 空间信息：空间名称；管理员可以把空间存为模板（进模板中心），或者复制一个新空间（只复制配置）。
 */
export function SpaceInfoCard({
  space,
  canManage,
}: {
  space: { id: string; name: string; workItemTypes: readonly unknown[] };
  canManage: boolean;
}) {
  const zero = useZero();
  const [saveOpen, setSaveOpen] = useState(false);
  // 每次打开都是一张新表单，不带上次填的范围和选项
  const [saveKey, setSaveKey] = useState(0);
  const [copyOpen, setCopyOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rename(next: string) {
    const name = next.trim();
    if (!name || name === space.name) return;
    setError(null);
    const result = await zero.mutate(mutators.space.rename({ spaceId: space.id, name })).server;
    if (result.type === "error") setError(result.error.message);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>空间信息</CardTitle>
        <CardDescription>空间的名称。可以把整个空间的配置存成模板，或者复制出一个新空间。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field label="空间名称" className="max-w-sm">
          <Input
            key={space.name}
            defaultValue={space.name}
            readOnly={!canManage}
            maxLength={60}
            onBlur={(e) => rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </Field>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSaveKey((k) => k + 1);
                setSaveOpen(true);
              }}
            >
              <LayoutTemplate />
              存为模板
            </Button>
            <Button variant="outline" onClick={() => setCopyOpen(true)}>
              <Copy />
              复制空间
            </Button>
          </div>
        )}
        {error && <p className="text-danger-600 text-sm">{error}</p>}
      </CardContent>
      <SaveTemplateDialog
        key={saveKey}
        open={saveOpen}
        onOpenChange={setSaveOpen}
        space={space}
        onSaved={(name) => Toast.success(`已存为模板「${name}」，可在模板中心查看。`)}
      />
      <CreateSpaceDialog open={copyOpen} onOpenChange={setCopyOpen} initialCopyFrom={space.id} />
    </Card>
  );
}

/** 存为模板：名称、说明、发布范围（企业模板要企业管理员）、要不要带视图、图表、实例。 */
function SaveTemplateDialog({
  open,
  onOpenChange,
  space,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  space: { id: string; name: string };
  onSaved: (name: string) => void;
}) {
  const orgAdmin = useIsOrgAdmin();
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"personal" | "org">("personal");
  const [includes, setIncludes] = useState({ views: true, charts: true, items: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await postJson("/api/space-templates", {
        spaceId: space.id,
        name: name.trim(),
        description: description.trim() || null,
        scope,
        includes,
      });
      onOpenChange(false);
      onSaved(name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="存为空间模板"
        description="模板包含工作项类型、字段、角色、流程、页面布局、权限、关联、层级和自动化规则。"
      >
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="模板名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
          </Field>
          <Field label="模板说明">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </Field>
          <Field label="发布范围" hint={orgAdmin ? undefined : "企业模板只有企业管理员可以发布。"}>
            <Select value={scope} onChange={(e) => setScope(e.target.value as "personal" | "org")}>
              <option value="personal">个人模板（只有自己能用）</option>
              <option value="org" disabled={!orgAdmin}>
                企业模板（所有人都能用）
              </option>
            </Select>
          </Field>
          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="mb-1.5 text-fg-muted">同时带上</legend>
            <Checkbox checked={includes.views} onChange={(e) => setIncludes({ ...includes, views: e.target.checked })}>
              公共视图
            </Checkbox>
            <Checkbox
              checked={includes.charts}
              onChange={(e) => setIncludes({ ...includes, charts: e.target.checked })}
            >
              度量图表
            </Checkbox>
            <Checkbox checked={includes.items} onChange={(e) => setIncludes({ ...includes, items: e.target.checked })}>
              工作项实例（最多 500 条，作为示例数据）
            </Checkbox>
          </fieldset>
          {error && <p className="text-danger-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "保存中…" : "存为模板"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
