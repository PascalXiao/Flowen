import type * as React from "react";
import { cn } from "@/lib/utils";

/** 下划线页签（Semi Tabs 的 line 样式）：页面里切换同一对象的不同视图（流程图、甘特图）。 */
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
    <div
      role="tablist"
      aria-label={label}
      className={cn("semi-tabs-bar semi-tabs-bar-line semi-tabs-bar-top flex", className)}
    >
      {items.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn("semi-tabs-tab semi-tabs-tab-top semi-tabs-tab-small", value === key && "semi-tabs-tab-active")}
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
    <div role="tablist" aria-label={label} className="inline-flex rounded-md bg-canvas p-0.5">
      {items.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "inline-flex h-7 cursor-pointer items-center gap-1 rounded-[5px] px-3 text-sm transition-colors [&_svg]:size-3.5",
            value === key ? "bg-surface text-brand-500 shadow-card" : "text-fg-muted hover:text-fg",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
