import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useNavigate } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** 左下角的通知入口：未读数、最近的通知，点一条跳到工作项并标为已读。 */
export function NotificationsBell() {
  const zero = useZero();
  const navigate = useNavigate();
  const [notifications] = useQuery(queries.notifications.mine());
  const [open, setOpen] = useState(false);
  const unread = notifications.filter((n) => n.readAt == null);

  const markRead = (ids: string[]) => {
    if (ids.length > 0) zero.mutate(mutators.notification.markRead({ ids }));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={unread.length > 0 ? `通知（${unread.length} 条未读）` : "通知"}
        className="flex h-[30px] w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-fg-muted text-sm hover:bg-hover hover:text-fg"
      >
        <Bell className="size-4 text-fg-subtle" />
        通知
        {unread.length > 0 && (
          <span className="ml-auto min-w-[18px] rounded-full bg-brand-500 px-1.5 text-center font-semibold text-[11px] text-white leading-[18px]">
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-96 p-0">
        <div className="flex h-11 items-center justify-between border-b border-line-subtle px-4">
          <span className="font-semibold">通知</span>
          {unread.length > 0 && (
            <button
              type="button"
              className="cursor-pointer text-xs text-accent hover:text-accent"
              onClick={() => markRead(unread.map((n) => n.id))}
            >
              全部已读
            </button>
          )}
        </div>
        {notifications.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-fg-subtle">没有通知。</p>
        ) : (
          <ul aria-label="通知列表" className="max-h-[420px] overflow-y-auto p-1">
            {notifications.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer gap-2.5 rounded-md px-3 py-2.5 text-left hover:bg-hover"
                  onClick={() => {
                    markRead(n.readAt == null ? [n.id] : []);
                    setOpen(false);
                    if (n.workItemId) navigate({ to: "/items/$itemId", params: { itemId: n.workItemId } });
                  }}
                >
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.readAt == null && "bg-accent")} />
                  <span className="flex flex-col gap-0.5">
                    <span className={n.readAt == null ? "text-fg" : "text-fg-muted"}>{n.text}</span>
                    <span className="text-xs text-fg-subtle">{new Date(n.createdAt ?? 0).toLocaleString("zh-CN")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
