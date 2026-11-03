import { Slot } from "@radix-ui/react-slot";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 按钮：用 Semi Button 的样式类渲染原生 button，外观与 Semi 一致，
 * 同时保留 ref 和 asChild（弹出层的触发器、链接按钮都靠这两样）。
 */
const VARIANTS = {
  /** 主按钮：一个区域最多一个。 */
  default: "semi-button-primary",
  /** 次按钮：灰底。 */
  outline: "semi-button-tertiary semi-button-light",
  /** 文字按钮：工具栏、行内操作。 */
  ghost: "semi-button-tertiary semi-button-borderless",
  link: "semi-button-primary semi-button-borderless h-auto! p-0! hover:underline",
  danger: "semi-button-danger",
} as const;

const SIZES = {
  default: "",
  sm: "semi-button-size-small",
  lg: "semi-button-size-large",
  icon: "semi-button-with-icon-only w-8 px-0!",
  "icon-sm": "semi-button-size-small semi-button-with-icon-only w-6 px-0!",
} as const;

export function buttonVariants({
  variant = "default",
  size = "default",
  disabled,
  className,
}: {
  variant?: keyof typeof VARIANTS | null;
  size?: keyof typeof SIZES | null;
  disabled?: boolean;
  className?: string;
} = {}) {
  return cn(
    "semi-button gap-1.5 [&_svg]:size-4 [&_svg]:shrink-0",
    VARIANTS[variant ?? "default"],
    SIZES[size ?? "default"],
    disabled && "semi-button-disabled",
    className,
  );
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  type,
  children,
  ...props
}: React.ComponentProps<"button"> & {
  variant?: keyof typeof VARIANTS | null;
  size?: keyof typeof SIZES | null;
  asChild?: boolean;
}) {
  const cls = buttonVariants({ variant, size, disabled: !!props.disabled, ...(className && { className }) });
  if (asChild) {
    return (
      <Slot className={cls} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button className={cls} type={type ?? "button"} {...props}>
      <span className="semi-button-content inline-flex items-center gap-1.5">{children}</span>
    </button>
  );
}
