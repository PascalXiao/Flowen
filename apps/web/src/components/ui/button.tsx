import { Slot } from "@radix-ui/react-slot";
import type * as React from "react";
import { cn } from "@/lib/utils";

const VARIANTS = {
  /** 主按钮：一个区域最多一个。 */
  default: "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700",
  /** 次按钮：描边。 */
  outline: "border border-line bg-surface text-fg hover:bg-raised active:bg-pressed",
  /** 文字按钮：工具栏、行内操作。 */
  ghost: "text-fg-muted hover:bg-hover hover:text-fg active:bg-pressed",
  link: "h-auto! rounded-sm p-0! font-normal text-accent hover:underline",
  danger: "bg-danger-500 text-white hover:opacity-90 active:opacity-80",
} as const;

const SIZES = {
  default: "h-7 px-2.5",
  sm: "h-6 px-2 text-xs",
  lg: "h-8 px-3.5",
  icon: "size-7 px-0",
  "icon-sm": "size-6 px-0",
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
    "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium text-sm transition-colors [&_svg]:size-[15px] [&_svg]:shrink-0",
    VARIANTS[variant ?? "default"],
    SIZES[size ?? "default"],
    disabled && "pointer-events-none cursor-not-allowed opacity-50",
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
      {children}
    </button>
  );
}
