import { Bold, Italic, Link2, List, ListOrdered, Strikethrough, Underline } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** 富文本里允许的标签；别的标签去掉、保留文字，属性只留安全的链接。 */
const ALLOWED = new Set([
  "P",
  "BR",
  "DIV",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "STRIKE",
  "UL",
  "OL",
  "LI",
  "A",
  "H1",
  "H2",
  "H3",
  "BLOCKQUOTE",
  "CODE",
  "PRE",
]);

/** 清理富文本 HTML：只留白名单标签和 http(s) 链接，防止存进去的内容带脚本。 */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const clean = (node: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
        continue;
      }
      if (!(child instanceof Element)) continue;
      clean(child);
      if (!ALLOWED.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
    }
  };
  // 链接的 href 要在清掉属性之前取出来
  const links = new Map<Element, string>();
  for (const a of doc.body.querySelectorAll("a")) {
    const href = a.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) links.set(a, href);
  }
  clean(doc.body);
  for (const [a, href] of links) {
    if (!a.isConnected) continue;
    a.setAttribute("href", href);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noreferrer");
  }
  return doc.body.innerHTML;
}

/** 只读显示富文本。 */
export function RichTextView({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn("rich-text text-sm", className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: 内容已经过 sanitizeHtml 白名单清理
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}

const TOOLS = [
  { command: "bold", icon: Bold, label: "加粗" },
  { command: "italic", icon: Italic, label: "斜体" },
  { command: "underline", icon: Underline, label: "下划线" },
  { command: "strikeThrough", icon: Strikethrough, label: "删除线" },
  { command: "insertUnorderedList", icon: List, label: "无序列表" },
  { command: "insertOrderedList", icon: ListOrdered, label: "有序列表" },
] as const;

/**
 * 富文本编辑：上方一排常用格式按钮，下面是可编辑区域。失焦时把清理过的 HTML 交出去；
 * live 时每次输入都交出去（表单里用）。
 */
export function RichTextEditor({
  label,
  value,
  onChange,
  readOnly = false,
  live = false,
}: {
  label: string;
  value: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
  live?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 外面的值变了（别人改了、或保存后规范化）且不在编辑时，才同步进编辑区，避免打字时光标跳动
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerHTML !== value) el.innerHTML = sanitizeHtml(value);
  }, [value]);
  const emit = () => {
    const html = sanitizeHtml(ref.current?.innerHTML ?? "");
    if (html !== value) onChange(html);
  };
  const run = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    if (live) emit();
  };
  if (readOnly) return value ? <RichTextView html={value} /> : <span className="text-sm text-fg-subtle">未填写</span>;
  return (
    <div className="rounded-md border border-line bg-surface focus-within:border-brand-500">
      <div className="flex items-center gap-0.5 border-b border-line-subtle px-1 py-0.5">
        {TOOLS.map(({ command, icon: Icon, label: name }) => (
          <button
            key={command}
            type="button"
            aria-label={name}
            title={name}
            className="flex size-6 items-center justify-center rounded text-fg-muted hover:bg-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(command)}
          >
            <Icon className="size-3.5" />
          </button>
        ))}
        <button
          type="button"
          aria-label="插入链接"
          title="插入链接"
          className="flex size-6 items-center justify-center rounded text-fg-muted hover:bg-hover"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const url = window.prompt("链接地址（http:// 或 https:// 开头）");
            if (url && /^https?:\/\//i.test(url)) run("createLink", url);
          }}
        >
          <Link2 className="size-3.5" />
        </button>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: 富文本编辑区只能用 contentEditable */}
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        className="rich-text min-h-24 px-3 py-2 text-sm outline-none"
        onInput={live ? emit : undefined}
        onBlur={emit}
      />
    </div>
  );
}
