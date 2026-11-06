import { Toast } from "@douyinfe/semi-ui";
import {
  type FieldConfig,
  type FieldDataType,
  type FieldOption,
  guessTargets,
  type ImportContext,
  type ImportRow,
  type ImportTarget,
  importableFields,
  importHeaders,
  planImport,
  type RoleConfig,
} from "@fp/engine";
import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { CheckCircle2, CircleAlert, Download, Upload } from "lucide-react";
import { type ChangeEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Select } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";
import { downloadTemplate, readSheet } from "@/lib/export-xlsx";
import { withLineOptions } from "@/lib/fields";
import { newId } from "@/lib/utils";

/** 一次最多导入的行数：再多建议分几次导，免得浏览器卡住。 */
const MAX_ROWS = 2000;

export interface ImportType {
  id: string;
  name: string;
  fields: readonly {
    key: string;
    name: string;
    dataType: string;
    options: readonly FieldOption[] | null;
    required?: boolean | null;
    config?: unknown;
  }[];
  roles: readonly { key: string; name: string; config?: unknown }[];
  flowTemplates: readonly { id: string; name: string; currentVersionId: string | null }[];
}

type Sheet = { fileName: string; headers: string[]; rows: string[][] };
type Result = { done: number; failed: { line: number; name: string; error: string }[] };

const targetId = (t: ImportTarget) =>
  !t ? "" : t.kind === "field" || t.kind === "role" ? `${t.kind}:${t.key}` : t.kind;
const parseTarget = (id: string): ImportTarget => {
  if (id === "name" || id === "flow") return { kind: id };
  const [kind, key] = id.split(":");
  return (kind === "field" || kind === "role") && key ? { kind, key } : null;
};

/**
 * 从 Excel 导入工作项：下载模板 → 选文件 → 核对每列导入到哪个字段或角色、预检每一行 → 导入。
 * 字段按显示名解析（和粘贴单元格一样），没填的字段走默认值规则，角色走分配方式；有问题的行不导入。
 */
export function ImportDialog({
  type,
  lines,
  members,
  spaceName,
}: {
  type: ImportType;
  lines: readonly { id: string; name: string; parentId: string | null; disabled: boolean | null }[];
  members: readonly { userId: string; name: string }[];
  spaceName: string;
}) {
  const zero = useZero();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [targets, setTargets] = useState<ImportTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const ctx: ImportContext = useMemo(
    () => ({
      typeName: type.name,
      fields: withLineOptions(type.fields, lines).map((f) => ({
        ...f,
        dataType: f.dataType as FieldDataType,
        options: f.options ?? undefined,
        config: (f.config ?? null) as FieldConfig | null,
      })),
      roles: type.roles.map((r) => ({ ...r, config: (r.config ?? null) as RoleConfig | null })),
      flows: type.flowTemplates.filter((t) => t.currentVersionId),
      members,
      me: String(zero.userID),
    }),
    [type, lines, members, zero.userID],
  );
  const plan = useMemo(() => (sheet ? planImport(sheet.rows, targets, ctx) : []), [sheet, targets, ctx]);
  const good = plan.filter((r) => r.errors.length === 0);
  const bad = plan.filter((r) => r.errors.length > 0);

  function reset() {
    setSheet(null);
    setTargets([]);
    setError(null);
    setResult(null);
    setRunning(null);
  }

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    reset();
    try {
      const { headers, rows } = await readSheet(file);
      if (headers.every((h) => !h)) return setError("第一行要是表头（名称、字段名、角色名）。");
      const data = rows.filter((r) => r.some((c) => c !== ""));
      if (data.length === 0) return setError("表格里没有数据行。");
      if (data.length > MAX_ROWS)
        return setError(`一次最多导入 ${MAX_ROWS} 行，这个表格有 ${data.length} 行，请分几次导入。`);
      const guessed = guessTargets(headers, ctx);
      if (!guessed.some((t) => t?.kind === "name")) return setError("没找到「名称」列：第一行要有一列叫「名称」。");
      setSheet({ fileName: file.name, headers, rows });
      setTargets(guessed);
    } catch (err) {
      setError(`读不了这个文件：${err instanceof Error ? err.message : err}。请用 .xlsx 格式。`);
    }
  }

  async function run() {
    const rows: ImportRow[] = good;
    const failed: Result["failed"] = [];
    const server: Promise<void>[] = [];
    setRunning({ done: 0, total: rows.length });
    let done = 0;
    for (const row of rows) {
      const { client, server: confirmed } = zero.mutate(
        mutators.workItem.create({
          id: newId(),
          typeId: type.id,
          name: row.name,
          ...(row.flowTemplateId && { flowTemplateId: row.flowTemplateId }),
          fields: row.fields as never,
          roles: row.roles,
          ...(row.addedRoles.length > 0 && { roleOverrides: { added: row.addedRoles } }),
        }),
      );
      const outcome = await client;
      if (outcome.type === "error") failed.push({ line: row.line, name: row.name, error: outcome.error.message });
      else {
        done++;
        server.push(
          confirmed.then((o) => {
            if (o.type !== "error") return;
            done--;
            failed.push({ line: row.line, name: row.name, error: o.error.message });
          }),
        );
      }
      setRunning({ done: done + failed.length, total: rows.length });
    }
    await Promise.all(server);
    setRunning(null);
    setResult({ done, failed: failed.sort((a, b) => a.line - b.line) });
    Toast.success({ content: `已导入 ${done} 条`, duration: 2 });
  }

  const options = [
    { id: "", label: "不导入" },
    { id: "name", label: "名称" },
    ...(ctx.flows.length > 0 ? [{ id: "flow", label: "流程类型" }] : []),
    ...importableFields(ctx.fields).map((f) => ({ id: `field:${f.key}`, label: `字段：${f.name}` })),
    ...ctx.roles.map((r) => ({ id: `role:${r.key}`, label: `角色：${r.name}` })),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (running) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload />
          导入
        </Button>
      </DialogTrigger>
      <DialogContent title={`从 Excel 导入${type.name}`} className="max-w-2xl">
        <div className="flex flex-col gap-4 text-sm">
          {error && <ErrorBanner>{error}</ErrorBanner>}

          {result ? (
            <div className="flex flex-col gap-3">
              <p className="flex items-center gap-2 text-base">
                <CheckCircle2 className="size-5 text-success-600" />
                已导入 {result.done} 条{type.name}
                {bad.length + result.failed.length > 0 && `，${bad.length + result.failed.length} 行没有导入`}
              </p>
              {result.failed.length > 0 && (
                <ul aria-label="导入失败的行" className="flex flex-col gap-1 text-danger-600">
                  {result.failed.map((f) => (
                    <li key={f.line}>
                      第 {f.line} 行「{f.name}」：{f.error}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={reset}>
                  再导入一个文件
                </Button>
                <Button onClick={() => setOpen(false)}>完成</Button>
              </div>
            </div>
          ) : !sheet ? (
            <div className="flex flex-col gap-3">
              <ol className="list-decimal space-y-1 pl-5 text-fg-muted">
                <li>下载模板，按表头填写：一行一条{type.name}，「名称」必填。</li>
                <li>选项、人员按显示名填，多个值用顿号或逗号隔开；日期写成 2027-03-01。</li>
                <li>没填的字段按默认值规则补上，角色没填时按配置的分配方式带人。</li>
              </ol>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => downloadTemplate(`${spaceName}-${type.name}-导入模板`, importHeaders(ctx))}
                >
                  <Download />
                  下载导入模板
                </Button>
                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-brand-500 px-3 text-white hover:bg-brand-600">
                  <Upload className="size-4" />
                  选择 Excel 文件
                  <input
                    type="file"
                    aria-label="选择 Excel 文件"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="sr-only"
                    onChange={choose}
                  />
                </label>
              </div>
            </div>
          ) : (
            <>
              <p className="text-fg-muted">
                {sheet.fileName}：共 {plan.length} 行，
                <span className="text-success-600">{good.length} 行可以导入</span>
                {bad.length > 0 && <span className="text-danger-600">，{bad.length} 行有问题（不会导入）</span>}
              </p>
              <section aria-label="列对应" className="flex flex-col gap-1.5">
                <h3 className="font-medium">每一列导入到</h3>
                <div className="grid max-h-48 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto pr-1">
                  {sheet.headers.map((h, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 表头可能重名或为空，按列位置
                    <label key={i} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 truncate text-fg-muted" title={h}>
                        {h || `第 ${i + 1} 列`}
                      </span>
                      <Select
                        aria-label={`「${h || `第 ${i + 1} 列`}」导入到`}
                        value={targetId(targets[i] ?? null)}
                        onChange={(e) => {
                          const next = parseTarget(e.target.value);
                          setTargets((prev) =>
                            prev.map((t, j) => (j === i ? next : targetId(t) === e.target.value && next ? null : t)),
                          );
                        }}
                      >
                        {options.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ))}
                </div>
              </section>
              <section aria-label="预检结果" className="max-h-64 overflow-y-auto rounded-md border border-line-subtle">
                <table className="w-full">
                  <thead className="sticky top-0 bg-canvas text-left text-xs text-fg-muted">
                    <tr>
                      <th className="h-8 w-14 px-3 font-normal">行</th>
                      <th className="font-normal">名称</th>
                      <th className="px-3 font-normal">检查</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.map((r) => (
                      <tr key={r.line} className="border-t border-line-subtle align-top">
                        <td className="px-3 py-1.5 tabular-nums text-fg-muted">{r.line}</td>
                        <td className="py-1.5">{r.name || <span className="text-fg-disabled">—</span>}</td>
                        <td className="px-3 py-1.5">
                          {r.errors.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-success-600">
                              <CheckCircle2 className="size-4" />
                              可以导入
                            </span>
                          ) : (
                            <span className="inline-flex items-start gap-1 text-danger-600">
                              <CircleAlert className="mt-0.5 size-4 shrink-0" />
                              {r.errors.join(" ")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              <div className="flex items-center justify-end gap-2">
                {running && (
                  <output className="mr-auto text-fg-muted">
                    正在导入 {running.done} / {running.total}…
                  </output>
                )}
                <Button variant="outline" disabled={!!running} onClick={reset}>
                  换个文件
                </Button>
                <Button disabled={good.length === 0 || !!running} onClick={run}>
                  导入 {good.length} 条
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
