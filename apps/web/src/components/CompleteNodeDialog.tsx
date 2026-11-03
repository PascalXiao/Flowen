import type { NodeDefinition } from "@fp/engine";
import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { type FormEvent, useState } from "react";
import { type FieldConfig, FieldInput, type FieldInputValue, type FieldMember } from "@/components/FieldInput";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";

/** 节点完成时要填的东西：完成表单、完成结论和意见、节点字段。 */
export function needsCompletionDialog(node: NodeDefinition): boolean {
  return !!(node.form?.length || node.conclusion || node.fields?.length);
}

/**
 * 确认完成节点的弹窗：完成表单（工作项字段）、完成结论和意见、节点字段，提交时和确认一起写入。
 */
export function CompleteNodeDialog({
  workItemId,
  node,
  fields,
  values,
  nodeValues = {},
  members,
  open,
  onOpenChange,
}: {
  workItemId: string;
  node: NodeDefinition;
  fields: readonly FieldConfig[];
  values: ReadonlyMap<string, unknown>;
  /** 节点字段现有的值。 */
  nodeValues?: Readonly<Record<string, unknown>>;
  members: readonly FieldMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, FieldInputValue>>(() =>
    Object.fromEntries((node.form ?? []).map(({ field }) => [field, (values.get(field) ?? null) as FieldInputValue])),
  );
  const [nodeDraft, setNodeDraft] = useState<Record<string, FieldInputValue>>(() =>
    Object.fromEntries((node.fields ?? []).map((f) => [f.key, (nodeValues[f.key] ?? null) as FieldInputValue])),
  );
  const [conclusion, setConclusion] = useState("");
  const [comment, setComment] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trim = (record: Record<string, FieldInputValue>) =>
      Object.fromEntries(Object.entries(record).map(([key, v]) => [key, typeof v === "string" ? v.trim() || null : v]));
    setError(null);
    setBusy(true);
    const { client, server } = zero.mutate(
      mutators.node.confirm({
        workItemId,
        nodeKey: node.key,
        values: trim(draft),
        ...(node.conclusion && { conclusion: conclusion || null, comment: comment.trim() || null }),
        ...(node.fields?.length && { nodeFields: trim(nodeDraft) }),
      }),
    );
    for (const outcome of [await client, await server])
      if (outcome.type === "error") {
        setBusy(false);
        return setError(outcome.error.message);
      }
    setBusy(false);
    onOpenChange(false);
  }

  const star = <span className="ml-0.5 text-danger-600">*</span>;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent title={`完成节点：${node.name}`} description="带 * 的必须填。">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          {(node.form ?? []).map(({ field: key, required }) => {
            const field = fields.find((f) => f.key === key);
            return (
              <Field
                key={key}
                label={
                  <>
                    {field?.name ?? key}
                    {required && star}
                  </>
                }
              >
                <FieldInput
                  field={field ?? { key, name: key, dataType: "text", options: null }}
                  value={draft[key] ?? null}
                  members={members}
                  live
                  required={required}
                  onChange={(v) => setDraft((prev) => ({ ...prev, [key]: v }))}
                />
              </Field>
            );
          })}
          {(node.fields ?? []).map((f) => (
            <Field
              key={f.key}
              label={
                <>
                  {f.name}
                  {f.required && star}
                </>
              }
            >
              <FieldInput
                field={{ key: f.key, name: f.name, dataType: f.dataType, options: f.options ?? null }}
                value={nodeDraft[f.key] ?? null}
                members={members}
                live
                onChange={(v) => setNodeDraft((prev) => ({ ...prev, [f.key]: v }))}
              />
            </Field>
          ))}
          {node.conclusion && (
            <>
              <Field
                label={
                  <>
                    完成结论
                    {node.conclusion.required && star}
                  </>
                }
              >
                <Select value={conclusion} onChange={(e) => setConclusion(e.target.value)}>
                  <option value="">未选择</option>
                  {node.conclusion.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={
                  <>
                    完成意见
                    {node.conclusion.commentRequired && star}
                  </>
                }
              >
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
              </Field>
            </>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              确认完成
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
