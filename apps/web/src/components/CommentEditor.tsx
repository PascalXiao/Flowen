import {
  AtSign,
  Bold,
  Code,
  File as FileIcon,
  Hash,
  Italic,
  Link2,
  List,
  ListOrdered,
  Paperclip,
  Strikethrough,
  X,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatBytes } from "@/components/AttachmentsCard";
import { sanitizeHtml } from "@/components/RichText";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { popupSurface } from "@/components/ui/popover";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

export type Member = { userId: string; name: string };
export type MentionField = { key: string; name: string };

/** 评论里的一个附件（attachment 表里 commentId 指向这条评论的行）。 */
export interface CommentFile {
  id: string;
  name: string;
  contentType: string;
  size: number;
  commentId?: string | null;
}

/** 单个附件的大小上限，和 API 一致。 */
const MAX_BYTES = 50 * 1024 * 1024;
const fileUrl = (id: string) => `${env.apiUrl}/api/attachments/${id}`;
const isImage = (type: string) => /^image\/(png|jpeg|gif|webp)$/.test(type);

/** 评论下面的附件：图片显示缩略图（点开看大图），其他文件显示名称和大小，点了下载。 */
export function CommentFiles({
  files,
  onRemove,
}: {
  files: readonly CommentFile[];
  onRemove?: (file: CommentFile) => void;
}) {
  if (files.length === 0) return null;
  return (
    <ul aria-label="评论附件" className="flex flex-wrap gap-2">
      {files.map((f) => (
        <li key={f.id} className="group/file relative">
          {isImage(f.contentType) ? (
            <a href={`${fileUrl(f.id)}?inline`} target="_blank" rel="noreferrer" title={f.name} className="block">
              <img
                src={`${fileUrl(f.id)}?inline`}
                alt={f.name}
                loading="lazy"
                className="h-20 max-w-40 rounded-md border border-line-subtle object-cover"
              />
            </a>
          ) : (
            <a
              href={fileUrl(f.id)}
              title={f.name}
              className="flex h-10 max-w-60 items-center gap-2 rounded-md border border-line-subtle bg-surface px-2.5 hover:border-line"
            >
              <FileIcon className="size-4 shrink-0 text-fg-subtle" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-xs font-medium">{f.name}</span>
                <span className="text-[11px] text-fg-subtle">{formatBytes(f.size)}</span>
              </span>
            </a>
          )}
          {onRemove && (
            <button
              type="button"
              aria-label={`移除附件 ${f.name}`}
              onClick={() => onRemove(f)}
              className="absolute -top-1.5 -right-1.5 flex size-4 cursor-pointer items-center justify-center rounded-full bg-inverse text-inverse-fg"
            >
              <X className="size-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 一个提及候选：人或字段。 */
type Candidate = { kind: "user"; id: string; name: string } | { kind: "field"; id: string; name: string };

/** 光标前面紧挨着的「@xxx」：返回文字节点、@ 的位置和输入的关键字。 */
function mentionQuery(root: HTMLElement) {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null;
  const before = (node.textContent ?? "").slice(0, range.startOffset);
  const match = /(?:^|[\s ])@([^\s@ ]{0,20})$/.exec(before) ?? /^@([^\s@ ]{0,20})$/.exec(before);
  if (!match) return null;
  const query = match[1] ?? "";
  const rect = range.getBoundingClientRect();
  return { node: node as Text, start: range.startOffset - query.length - 1, end: range.startOffset, query, rect };
}

/** 提及标签：不能在里面编辑，整体删除。 */
function chip(candidate: Candidate) {
  const span = document.createElement("span");
  span.setAttribute(candidate.kind === "user" ? "data-user" : "data-field", candidate.id);
  span.contentEditable = "false";
  span.textContent = `@${candidate.name}`;
  return span;
}

/** 正文里提及的人（去重）。 */
export function mentionsOf(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return [...new Set([...doc.body.querySelectorAll("[data-user]")].map((e) => e.getAttribute("data-user") ?? ""))]
    .filter(Boolean)
    .slice(0, 50);
}

const TOOLS = [
  { command: "bold", icon: Bold, label: "加粗" },
  { command: "italic", icon: Italic, label: "斜体" },
  { command: "strikeThrough", icon: Strikethrough, label: "删除线" },
  { command: "insertUnorderedList", icon: List, label: "无序列表" },
  { command: "insertOrderedList", icon: ListOrdered, label: "有序列表" },
] as const;

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * 写评论的富文本编辑器：发表评论、回复、编辑共用。
 * 加粗、斜体、删除线、列表、行内代码、链接；输入 @ 选人或字段；可以加附件（按钮、粘贴、拖进来），
 * 附件先带着评论 id 传上去，发出评论时一起出现。Ctrl/⌘ + Enter 发送。
 */
export function CommentEditor({
  label,
  placeholder,
  submitLabel,
  members,
  fields,
  workItemId,
  draftId,
  files,
  initialHtml = "",
  autoFocus,
  topic,
  onClearTopic,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  members: readonly Member[];
  fields: readonly MentionField[];
  workItemId: string;
  /** 这条评论的 id（新评论先定好），附件挂在它下面。 */
  draftId: string;
  /** 已经挂在这条评论下的附件。 */
  files: readonly CommentFile[];
  initialHtml?: string;
  autoFocus?: boolean;
  /** 针对字段评论时的话题：字段名和引用的值。 */
  topic?: { name: string; quote: string } | null;
  onClearTopic?: () => void;
  onSubmit: (html: string, mentions: string[]) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [empty, setEmpty] = useState(!initialHtml);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState<{ query: string; x: number; y: number; active: number } | null>(null);

  // 初始内容：清理后放进编辑区，提及标签设成不可编辑
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在打开时放一次初始内容，之后由用户编辑
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = sanitizeHtml(initialHtml);
    for (const c of el.querySelectorAll<HTMLElement>("[data-user],[data-field]")) c.contentEditable = "false";
    if (autoFocus) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  }, []);

  const q = picker?.query.toLowerCase() ?? "";
  const candidates: Candidate[] = picker
    ? [
        ...members
          .filter((m) => m.name.toLowerCase().includes(q))
          .map((m): Candidate => ({ kind: "user", id: m.userId, name: m.name })),
        ...fields
          .filter((f) => f.name.toLowerCase().includes(q))
          .map((f): Candidate => ({ kind: "field", id: f.key, name: f.name })),
      ].slice(0, 30)
    : [];

  /** 内容变了：更新空不空、看光标前是不是在输入 @。 */
  function changed() {
    const el = ref.current;
    if (!el) return;
    setEmpty(!el.textContent?.trim() && !el.querySelector("[data-user],[data-field]"));
    const at = mentionQuery(el);
    setPicker((prev) =>
      at
        ? {
            query: at.query,
            x: at.rect.left,
            y: at.rect.bottom + 4,
            active: prev && prev.query === at.query ? prev.active : 0,
          }
        : null,
    );
  }

  function pick(candidate: Candidate) {
    const el = ref.current;
    const at = el && mentionQuery(el);
    if (!el || !at) return setPicker(null);
    const range = document.createRange();
    range.setStart(at.node, at.start);
    range.setEnd(at.node, at.end);
    range.deleteContents();
    const tag = chip(candidate);
    const space = document.createTextNode(" ");
    range.insertNode(space);
    range.insertNode(tag);
    const after = document.createRange();
    after.setStartAfter(space);
    after.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(after);
    setPicker(null);
    changed();
  }

  function command(name: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(name, false, arg);
    changed();
  }

  /** 行内代码：把选中的文字包进 <code>。 */
  function inlineCode() {
    const text = window.getSelection()?.toString() ?? "";
    ref.current?.focus();
    document.execCommand("insertHTML", false, `<code>${escapeHtml(text || "代码")}</code>&nbsp;`);
    changed();
  }

  /** 工具栏的 @：在光标处插一个 @，弹出候选。 */
  function startMention() {
    ref.current?.focus();
    document.execCommand("insertText", false, "@");
    changed();
  }

  async function upload(list: FileList | File[] | null) {
    if (!list?.length) return;
    setError(null);
    for (const file of Array.from(list)) {
      if (file.size > MAX_BYTES) {
        setError(`「${file.name}」超过 50 MB，没有上传。`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(
          `${env.apiUrl}/api/work-items/${workItemId}/attachments?comment=${encodeURIComponent(draftId)}`,
          { method: "POST", body, credentials: "include" },
        );
        if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "上传失败。");
      } catch {
        setError(`「${file.name}」上传失败，请检查网络。`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  async function removeFile(file: CommentFile) {
    const res = await fetch(fileUrl(file.id), { method: "DELETE", credentials: "include" });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "删除失败。");
  }

  async function submit() {
    const el = ref.current;
    if (!el || busy || uploading > 0 || (empty && files.length === 0)) return;
    setError(null);
    setBusy(true);
    const html = empty ? "" : sanitizeHtml(el.innerHTML);
    const failed = await onSubmit(html, mentionsOf(html));
    setBusy(false);
    if (failed) return setError(failed);
    el.innerHTML = "";
    setEmpty(true);
  }

  async function cancel() {
    // 新评论（不是编辑）取消时，已经传上去的附件一起删掉
    if (!initialHtml) for (const f of files) await removeFile(f);
    onCancel?.();
  }

  function keyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (picker && candidates.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        return setPicker({ ...picker, active: (picker.active + step + candidates.length) % candidates.length });
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const c = candidates[picker.active];
        return c && pick(c);
      }
    }
    if (picker && e.key === "Escape") {
      e.preventDefault();
      return setPicker(null);
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  const toolButton = "flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-hover";

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "rounded-lg border border-line bg-surface transition-colors focus-within:border-accent",
          busy && "opacity-70",
        )}
      >
        {topic && (
          <div className="flex items-start gap-2 border-b border-line-subtle px-3 py-2 text-xs">
            <Hash className="mt-px size-3.5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="text-fg-muted">评论字段 </span>
              <span className="font-medium">{topic.name}</span>
              <span className="line-clamp-2 text-fg-subtle">当前值：{topic.quote || "未填写"}</span>
            </span>
            {onClearTopic && (
              <button
                type="button"
                aria-label="不针对字段"
                className="cursor-pointer text-fg-subtle hover:text-fg"
                onClick={onClearTopic}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}
        <div className="relative">
          {empty && (
            <span className="pointer-events-none absolute top-2 left-3 text-sm text-fg-subtle">{placeholder}</span>
          )}
          {/* biome-ignore lint/a11y/useSemanticElements: 富文本编辑区只能用 contentEditable */}
          <div
            ref={ref}
            role="textbox"
            aria-multiline="true"
            aria-label={label}
            tabIndex={0}
            contentEditable
            suppressContentEditableWarning
            className={cn(
              "rich-text max-h-80 overflow-y-auto px-3 py-2 text-sm outline-none",
              onCancel ? "min-h-14" : "min-h-20",
            )}
            onInput={changed}
            onKeyUp={(e) => {
              if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) changed();
            }}
            onClick={changed}
            onKeyDown={keyDown}
            onBlur={() => setTimeout(() => setPicker(null), 150)}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              e.preventDefault();
              if (pasted.length) return void upload(pasted);
              const html = e.clipboardData.getData("text/html");
              if (html) document.execCommand("insertHTML", false, sanitizeHtml(html));
              else document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
              changed();
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) e.preventDefault();
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.files.length) return;
              e.preventDefault();
              void upload(e.dataTransfer.files);
            }}
          />
        </div>
        {(files.length > 0 || uploading > 0) && (
          <div className="flex flex-col gap-1 px-3 pb-2">
            <CommentFiles files={files} onRemove={removeFile} />
            {uploading > 0 && <span className="text-xs text-fg-subtle">正在上传 {uploading} 个文件…</span>}
          </div>
        )}
        <div className="flex items-center gap-0.5 border-t border-line-subtle px-1.5 py-1">
          {TOOLS.map(({ command: name, icon: Icon, label: title }) => (
            <button
              key={name}
              type="button"
              aria-label={title}
              title={title}
              className={toolButton}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(name)}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
          <button
            type="button"
            aria-label="行内代码"
            title="行内代码"
            className={toolButton}
            onMouseDown={(e) => e.preventDefault()}
            onClick={inlineCode}
          >
            <Code className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="插入链接"
            title="插入链接"
            className={toolButton}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const url = window.prompt("链接地址（http:// 或 https:// 开头）");
              if (url && /^https?:\/\//i.test(url)) command("createLink", url);
            }}
          >
            <Link2 className="size-3.5" />
          </button>
          <span className="mx-1 h-4 w-px bg-line-subtle" />
          <button
            type="button"
            aria-label="提及成员或字段"
            title="提及成员或字段（输入 @）"
            className={toolButton}
            onMouseDown={(e) => e.preventDefault()}
            onClick={startMention}
          >
            <AtSign className="size-3.5" />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-label="添加评论附件"
            onChange={(e) => upload(e.target.files)}
          />
          <button
            type="button"
            aria-label="添加附件"
            title="添加附件（也可以粘贴或拖进来）"
            className={toolButton}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip className="size-3.5" />
          </button>
          <span className="ml-auto hidden pr-2 text-[11px] text-fg-subtle sm:inline">Ctrl + Enter 发送</span>
          <div className="flex gap-1.5">
            {onCancel && (
              <Button type="button" size="sm" variant="outline" onClick={cancel}>
                取消
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              disabled={(empty && files.length === 0) || uploading > 0 || busy}
              onClick={submit}
            >
              {submitLabel}
            </Button>
          </div>
        </div>
      </div>
      {error && <p className="text-sm text-danger-600">{error}</p>}
      {picker &&
        candidates.length > 0 &&
        createPortal(
          <div
            role="listbox"
            aria-label="提及"
            className={cn(popupSurface, "fixed max-h-72 w-60 overflow-y-auto p-1")}
            style={{ left: Math.min(picker.x, window.innerWidth - 248), top: picker.y }}
          >
            {candidates.map((c, i) => {
              const firstField = c.kind === "field" && candidates[i - 1]?.kind !== "field";
              const firstUser = c.kind === "user" && i === 0;
              return (
                <div key={`${c.kind}:${c.id}`}>
                  {(firstUser || firstField) && (
                    <div className="px-2 pt-1.5 pb-1 text-[11px] text-fg-subtle">{firstUser ? "成员" : "字段"}</div>
                  )}
                  <div
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === picker.active}
                    className={cn(
                      "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2",
                      i === picker.active && "bg-hover",
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(c);
                    }}
                    onMouseEnter={() => setPicker({ ...picker, active: i })}
                  >
                    {c.kind === "user" ? (
                      <Avatar id={c.id} name={c.name} size={20} />
                    ) : (
                      <Hash className="size-4 text-fg-subtle" />
                    )}
                    <span className="truncate">{c.name}</span>
                  </div>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
