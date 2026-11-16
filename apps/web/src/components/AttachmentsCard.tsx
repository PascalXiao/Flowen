import { File, FileImage, Paperclip, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/page";
import { env } from "@/lib/env";

interface AttachmentRow {
  id: string;
  name: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  createdAt: number | null;
  uploader?: { name: string } | null;
}

/** 单个附件的大小上限，和 API 一致。 */
const MAX_BYTES = 50 * 1024 * 1024;

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 工作项附件：上传（可多选）、下载、删除。文件经 API 上传和下载，列表由 Zero 同步，
 * 别人上传的附件会实时出现。访客只能下载；上传人和空间管理员可以删除。
 */
export function AttachmentsCard({
  workItemId,
  attachments,
  me,
  isAdmin,
  canWrite,
}: {
  workItemId: string;
  attachments: readonly AttachmentRow[];
  me: string;
  isAdmin: boolean;
  canWrite: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const url = (id: string) => `${env.apiUrl}/api/attachments/${id}`;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        setError(`「${file.name}」超过 50 MB，没有上传。`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`${env.apiUrl}/api/work-items/${workItemId}/attachments`, {
          method: "POST",
          body,
          credentials: "include",
        });
        if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "上传失败。");
      } catch {
        setError(`「${file.name}」上传失败，请检查网络。`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (input.current) input.current.value = "";
  }

  async function remove(row: AttachmentRow) {
    setError(null);
    const res = await fetch(url(row.id), { method: "DELETE", credentials: "include" });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "删除失败。");
  }

  return (
    <Panel
      title={`附件${attachments.length ? ` ${attachments.length}` : ""}`}
      aria-label="附件"
      actions={
        canWrite && (
          <>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              aria-label="选择附件"
              onChange={(e) => upload(e.target.files)}
            />
            <Button variant="link" size="sm" disabled={uploading > 0} onClick={() => input.current?.click()}>
              <Paperclip />
              {uploading > 0 ? "上传中…" : "上传"}
            </Button>
          </>
        )
      }
    >
      {attachments.length === 0 && <p className="text-fg-subtle">还没有附件。</p>}
      <ul aria-label="附件列表" className="flex flex-col gap-1.5">
        {attachments.map((a) => {
          const image = /^image\/(png|jpeg|gif|webp)$/.test(a.contentType);
          return (
            <li key={a.id} className="group flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-hover/50">
              {image ? (
                <a href={`${url(a.id)}?inline`} target="_blank" rel="noreferrer" className="shrink-0">
                  <img
                    src={`${url(a.id)}?inline`}
                    alt=""
                    className="size-9 rounded border border-line-subtle object-cover"
                    loading="lazy"
                  />
                </a>
              ) : (
                <span className="flex size-9 shrink-0 items-center justify-center rounded bg-canvas text-fg-subtle">
                  {a.contentType.startsWith("image/") ? <FileImage className="size-4" /> : <File className="size-4" />}
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <a href={url(a.id)} className="truncate font-medium hover:text-accent" title={a.name}>
                  {a.name}
                </a>
                <span className="truncate text-xs text-fg-subtle">
                  {formatBytes(a.size)} · {a.uploader?.name ?? ""}
                  {a.createdAt ? ` · ${new Date(a.createdAt).toLocaleDateString("zh-CN")}` : ""}
                </span>
              </div>
              {canWrite && (isAdmin || a.uploadedBy === me) && (
                <button
                  type="button"
                  aria-label={`删除附件 ${a.name}`}
                  className="invisible rounded p-1 text-fg-subtle group-hover:visible hover:text-danger-600 focus-visible:visible"
                  onClick={() => remove(a)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-danger-600">{error}</p>}
    </Panel>
  );
}
