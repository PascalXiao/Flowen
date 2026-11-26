import { htmlToText } from "@fp/sync";
import { MessageSquare } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface LatestComment {
  body: string;
  authorId: string;
  createdAt: number | null;
  fieldKey?: string | null;
  author?: { name: string } | null;
}

/**
 * 视图里名称旁的评论图标：有评论时显示，悬停预览最新一条评论，「查看全部评论」打开详情的评论页签。
 */
export function CommentPreview({
  latest,
  openAll,
}: {
  latest: LatestComment;
  /** 「查看全部评论」链接：打开详情的评论页签。 */
  openAll: (children: ReactNode, className: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const later = (next: boolean, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), ms);
  };
  const text = htmlToText(latest.body) || "（附件）";
  const name = latest.author?.name ?? "—";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="最新评论"
        className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-fg-subtle hover:bg-hover hover:text-accent"
        onMouseEnter={() => later(true, 250)}
        onMouseLeave={() => later(false, 200)}
      >
        <MessageSquare className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" side="bottom" align="start">
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 鼠标移进气泡时不收起 */}
        <div
          className="flex flex-col gap-2 p-3"
          onMouseEnter={() => later(true, 0)}
          onMouseLeave={() => later(false, 200)}
        >
          <div className="flex items-center gap-2">
            <Avatar id={latest.authorId} name={name} size={20} />
            <span className="font-medium">{name}</span>
            <span className="text-xs text-fg-subtle">
              {latest.createdAt ? new Date(latest.createdAt).toLocaleString("zh-CN") : ""}
            </span>
          </div>
          <p className="line-clamp-4 break-words text-fg">{text}</p>
          {openAll("查看全部评论", "w-fit text-sm text-accent hover:underline")}
        </div>
      </PopoverContent>
    </Popover>
  );
}
