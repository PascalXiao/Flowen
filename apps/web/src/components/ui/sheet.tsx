import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type CSSProperties, type ReactNode, useLayoutEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** 抽屉盖住的区域：within 给了就只盖那个元素（比如内容区，左侧导航还能看见），否则盖整个窗口。 */
function useBox(open: boolean, within?: () => HTMLElement | null): CSSProperties {
  const [box, setBox] = useState<CSSProperties>({ inset: 0 });
  useLayoutEffect(() => {
    const el = open ? within?.() : null;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, within]);
  return within ? box : { inset: 0 };
}

/**
 * 右侧抽屉：标题、右上角关闭、可滚动的内容区、可选的底部按钮栏。
 * 和弹窗一样不锁焦点（里面的下拉、气泡挂在 body 上），遮罩自己画，点遮罩或按 Esc 关闭。
 */
export function Sheet({
  open,
  onClose,
  title,
  label,
  width = 560,
  within,
  footer,
  bodyClassName,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** 标题不是纯文字时，给读屏用的名字。 */
  label?: string;
  /** 像素或 CSS 宽度（如 "72%"）。 */
  width?: number | string;
  within?: () => HTMLElement | null;
  footer?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const box = useBox(open, within);
  return (
    <RadixDialog.Root modal={false} open={open} onOpenChange={(next) => !next && onClose()}>
      {/* 挂在 within 的元素里面（比如 <main>），读屏和测试都把抽屉当成内容区的一部分 */}
      <RadixDialog.Portal container={open ? (within?.() ?? undefined) : undefined}>
        <div className="fixed z-[1000] overflow-hidden rounded-xl" style={box}>
          <div className="absolute inset-0 bg-overlay" />
          <RadixDialog.Content
            data-sheet
            aria-modal="true"
            aria-describedby={undefined}
            {...(label && { "aria-label": label })}
            onInteractOutside={(e) => {
              const target = e.target as HTMLElement | null;
              if (target?.closest("[data-radix-popper-content-wrapper], [data-fl-toast]")) e.preventDefault();
            }}
            style={{ width }}
            className="absolute inset-y-0 right-0 flex max-w-full flex-col bg-surface shadow-float outline-none data-[state=open]:animate-[fl-sheet-in_180ms_cubic-bezier(0.2,0.8,0.2,1)]"
          >
            <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-subtle pr-3 pl-5">
              <RadixDialog.Title asChild>
                <div className="min-w-0 flex-1 truncate font-semibold text-base">{title}</div>
              </RadixDialog.Title>
              <RadixDialog.Close
                aria-label="关闭"
                className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg"
              >
                <X className="size-4" />
              </RadixDialog.Close>
            </header>
            <div className={cn("min-h-0 flex-1 overflow-y-auto", bodyClassName)}>{children}</div>
            {footer && (
              <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line-subtle px-5 py-3">
                {footer}
              </footer>
            )}
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
