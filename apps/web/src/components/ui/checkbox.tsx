import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 勾选框：原生 checkbox，外观在 index.css 的 .fl-checkbox。
 * 用法和原生一样：checked + onChange(e.target.checked)，外面包 label 写文字也照常可以点。
 */
export function Checkbox({
  checked,
  indeterminate,
  disabled,
  className,
  onChange,
  "aria-label": ariaLabel,
  children,
}: {
  checked?: boolean;
  /** 部分选中（全选框在只勾了一部分行时）。 */
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
  onChange?: (e: { target: { checked: boolean } }) => void;
  "aria-label"?: string;
  /** 写在勾选框后面的文字，点文字也能勾选。 */
  children?: React.ReactNode;
}) {
  const box = (
    <input
      type="checkbox"
      checked={!!checked}
      ref={(el) => {
        if (el) el.indeterminate = !!indeterminate && !checked;
      }}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn("fl-checkbox", !children && className)}
      onChange={(e) => onChange?.({ target: { checked: e.target.checked } })}
    />
  );
  if (!children) return box;
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: 勾选框就在这个 label 里面（上面的 box）
    <label className={cn("inline-flex min-w-0 cursor-pointer items-center gap-2", className)}>
      {box}
      <span className="min-w-0 truncate">{children}</span>
    </label>
  );
}
