import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 弹窗，组合写法：Dialog 管开关，DialogTrigger 打开，DialogClose 关上，DialogContent 是弹窗本身。
 *
 * 迁移期间弹窗里还会用到 Semi 的日期、级联等浮层，它们挂在 body 上；所以这里不锁页面其他区域的点击和焦点
 * （modal={false}），遮罩自己画。Semi 全部换掉后改回默认的模态行为。
 */
export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <RadixDialog.Root modal={false} {...(open !== undefined && { open })} {...(onOpenChange && { onOpenChange })}>
      {children}
    </RadixDialog.Root>
  );
}

export function DialogTrigger({
  asChild,
  className,
  children,
}: {
  asChild?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <RadixDialog.Trigger asChild={asChild} className={className} type={asChild ? undefined : "button"}>
      {children}
    </RadixDialog.Trigger>
  );
}

export function DialogClose({ asChild, children }: { asChild?: boolean; children: React.ReactNode }) {
  return (
    <RadixDialog.Close asChild={asChild} type={asChild ? undefined : "button"}>
      {children}
    </RadixDialog.Close>
  );
}

/** 还开着的 Semi 浮层（日期面板、级联、下拉）：Esc 先收它们，不关弹窗。 */
const SEMI_POPUP = '.semi-portal [role="listbox"], .semi-portal .semi-popover-wrapper, .semi-portal .semi-datepicker';

export function DialogContent({
  className,
  children,
  title,
  description,
}: {
  /** 宽度用 max-w-xl、max-w-2xl 这类写法，默认 max-w-lg。 */
  className?: string;
  children: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <RadixDialog.Portal>
      <div className="fixed inset-0 z-[1000] bg-overlay" />
      <RadixDialog.Content
        aria-modal="true"
        {...(!description && { "aria-describedby": undefined })}
        onEscapeKeyDown={(e) => {
          if (document.querySelector(SEMI_POPUP)) e.preventDefault();
        }}
        // 点遮罩关闭；点到别的浮层（气泡、下拉、提示）不算点在外面
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest(".semi-portal, [data-radix-popper-content-wrapper], [data-fl-toast]")) e.preventDefault();
        }}
        className={cn(
          "-translate-x-1/2 fixed top-[12vh] left-1/2 z-[1000] flex max-h-[76vh] w-[calc(100vw-2rem)] max-w-lg flex-col rounded-xl bg-popover shadow-popover outline-none",
          className,
        )}
      >
        <header className="flex shrink-0 items-start gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <RadixDialog.Title className="font-semibold text-base">{title}</RadixDialog.Title>
            {description && (
              <RadixDialog.Description className="mt-1 text-fg-subtle text-sm">{description}</RadixDialog.Description>
            )}
          </div>
          <RadixDialog.Close
            aria-label="关闭"
            className="-mr-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg"
          >
            <X className="size-4" />
          </RadixDialog.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
