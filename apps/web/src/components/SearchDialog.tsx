import { queries } from "@fp/sync";
import { useQuery } from "@rocicorp/zero/react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusTag } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

/** 关键字停止输入一会儿再查，避免每敲一个字就换一次查询。 */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** 把文本里的关键字标出来；文本太长时截取关键字附近的一段。 */
function highlight(text: string, q: string, around = 24): ReactNode {
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return text.length > around * 2 ? `${text.slice(0, around * 2)}…` : text;
  const start = Math.max(0, at - around);
  const end = Math.min(text.length, at + q.length + around);
  return (
    <>
      {start > 0 && "…"}
      {text.slice(start, at)}
      <mark className="rounded-sm bg-brand-100 text-inherit">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length, end)}
      {end < text.length && "…"}
    </>
  );
}

/**
 * 全局搜索（⌘K / Ctrl+K）：在自己所在的所有空间里按名称、文本字段和评论找工作项，
 * 上下键选择，回车打开。
 */
export function SearchDialog({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const q = useDebounced(text.trim(), 200);
  const [found, result] = useQuery(q ? queries.search.workItems({ q }) : undefined);
  const items = q ? (found ?? []) : [];

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 关键字变了，选中项回到第一条
  useEffect(() => setActive(0), [q]);

  const go = (id: string) => {
    setOpen(false);
    setText("");
    navigate({ to: "/items/$itemId", params: { itemId: id } });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") setActive((i) => Math.min(i + 1, items.length - 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(i - 1, 0));
    else if (e.key === "Enter" && items[active]) go(items[active].id);
    else return;
    e.preventDefault();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={className}>
        <Search />
        <span className="flex-1 text-left">搜索</span>
        <kbd className="rounded-[4px] border border-line px-1 font-medium font-sans text-[10.5px] text-fg-subtle">
          {/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}
        </kbd>
      </DialogTrigger>
      <DialogContent title="搜索工作项" className="max-w-xl">
        <div className="flex flex-col gap-3">
          <Input
            aria-label="搜索关键字"
            placeholder="名称、文本字段、评论里的文字"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
          />
          {q && items.length === 0 && (
            <p className="py-6 text-center text-sm text-fg-subtle">
              {result.type === "complete" ? "没有找到相关的工作项。" : "搜索中…"}
            </p>
          )}
          {items.length > 0 && (
            <ul aria-label="搜索结果" className="-mx-2 flex flex-col">
              {items.map((item, i) => {
                const field = item.fieldValues[0];
                const fieldName = item.type?.fields.find((f) => f.key === field?.fieldKey)?.name ?? field?.fieldKey;
                const comment = item.comments[0];
                const inName = item.name.toLowerCase().includes(q.toLowerCase());
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(item.id)}
                      className={cn(
                        "flex w-full cursor-pointer flex-col gap-0.5 rounded-md px-2 py-2 text-left text-sm",
                        i === active && "bg-hover",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate font-medium">{highlight(item.name, q)}</span>
                        <StatusTag status={item.status ?? "inProgress"} />
                      </span>
                      <span className="truncate text-xs text-fg-subtle">
                        {item.space?.name} · {item.type?.name}
                        {!inName && field?.str && (
                          <>
                            {" · "}
                            {fieldName}：{highlight(field.str, q)}
                          </>
                        )}
                        {!inName && !field?.str && comment && <> · 评论：{highlight(comment.body, q)}</>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {!q && <p className="text-xs text-fg-subtle">在你所在的所有空间里搜索。↑↓ 选择，回车打开。</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
