import { Checkbox as SemiCheckbox } from "@douyinfe/semi-ui";

/**
 * 勾选框（Semi Checkbox）。用法和原生 checkbox 一样：checked + onChange(e.target.checked)，
 * 外面包 label 写文字也照常可以点。
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
    <SemiCheckbox
      checked={checked}
      disabled={disabled}
      className={className}
      aria-label={ariaLabel}
      onChange={(e) => onChange?.({ target: { checked: !!e.target.checked } })}
    />
  );
}
