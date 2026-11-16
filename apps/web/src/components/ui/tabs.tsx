import type * as React from "react";
import { cn } from "@/lib/utils";

/** 下划线页签：页面里切换同一对象的不同视图（流程图、甘特图）。 */
export function Tabs<K extends string>({
  value,
  onChange,
  items,
  className,
  label,
}: {
  value: K;
  onChange: (key: K) => void;
  items: readonly (readonly [K, React.ReactNode])[];
  className?: string;
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex items-center gap-1", className)}>
      {items.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "relative inline-flex h-9 items-center gap-1.5 whitespace-nowrap px-2 text-sm transition-colors [&_svg]:size-[15px]",
            value === key
              ? "font-medium text-fg after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-fg"
              : "text-fg-muted hover:text-fg",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** 分段控件：工具栏里切换列表、甘特图这类显示方式。 */
export function Segmented<K extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: K;
  onChange: (key: K) => void;
  items: readonly (readonly [K, React.ReactNode])[];
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex shrink-0 gap-px rounded-lg bg-raised p-0.5">
      {items.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12.5px] transition-colors [&_svg]:size-3.5",
            value === key ? "bg-surface font-medium text-fg shadow-panel" : "text-fg-muted hover:text-fg",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
