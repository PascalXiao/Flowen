import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

/** 轻提示：屏幕上方居中，几秒后自己消失。Toast.success("已保存") 或 Toast.success({ content, duration })，duration 单位是秒。 */
type Kind = "success" | "error" | "warning" | "info";
type Options = string | { content: string; duration?: number };
type Item = { id: number; kind: Kind; content: string };

let items: Item[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const notify of listeners) notify();
};

function show(kind: Kind, options: Options) {
  const { content, duration = 3 } = typeof options === "string" ? { content: options } : options;
  const id = ++seq;
  items = [...items, { id, kind, content }];
  emit();
  window.setTimeout(() => {
    items = items.filter((i) => i.id !== id);
    emit();
  }, duration * 1000);
}

export const Toast = {
  success: (options: Options) => show("success", options),
  error: (options: Options) => show("error", options),
  warning: (options: Options) => show("warning", options),
  info: (options: Options) => show("info", options),
};

const ICONS = {
  success: [CircleCheck, "text-success-600"],
  error: [CircleAlert, "text-danger-600"],
  warning: [TriangleAlert, "text-warning-600"],
  info: [Info, "text-accent"],
} as const;

/** 放在应用最外层一次。 */
export function Toaster() {
  const list = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => items,
  );
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[1100] flex flex-col items-center gap-2">
      {list.map(({ id, kind, content }) => {
        const [Icon, color] = ICONS[kind];
        return (
          <div
            key={id}
            data-fl-toast={kind}
            role={kind === "error" ? "alert" : "status"}
            className="pointer-events-auto flex max-w-[min(32rem,calc(100vw-2rem))] items-start gap-2 rounded-lg bg-popover px-3 py-2 text-sm shadow-popover"
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", color)} />
            <span>{content}</span>
          </div>
        );
      })}
    </div>
  );
}
