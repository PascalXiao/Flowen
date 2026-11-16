import { cn } from "@/lib/utils";

/**
 * 勾选框：原生 checkbox，外观在 index.css 的 .fl-checkbox。
 * 用法和原生一样：checked + onChange(e.target.checked)，外面包 label 写文字也照常可以点。
 */
export function Checkbox({
  checked,
  disabled,
  className,
  onChange,
  "aria-label": ariaLabel,
}: {
  checked?: boolean;
  disabled?: boolean;
  className?: string;
  onChange?: (e: { target: { checked: boolean } }) => void;
  "aria-label"?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={!!checked}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn("fl-checkbox", className)}
      onChange={(e) => onChange?.({ target: { checked: e.target.checked } })}
    />
  );
}
