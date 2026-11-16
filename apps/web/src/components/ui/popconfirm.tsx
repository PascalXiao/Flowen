import * as RadixPopover from "@radix-ui/react-popover";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { popupSurface } from "./popover";

/**
 * 气泡确认：包住一个触发按钮，点了先弹出确认，确认后才执行。用在删除、移交这类要再想一下的操作上。
 * onConfirm 返回 Promise 时等它结束再收起。
 */
export function Popconfirm({
  title,
  content,
  okText = "确定",
  cancelText = "取消",
  okType = "primary",
  onConfirm,
  disabled,
  children,
}: {
  title: React.ReactNode;
  content?: React.ReactNode;
  okText?: string;
  cancelText?: string;
  okType?: "primary" | "danger";
  onConfirm?: () => unknown;
  disabled?: boolean;
  /** asChild 触发器：必须是单个元素，不能是文字或多个节点。 */
  children: React.ReactElement;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  return (
    <RadixPopover.Root open={open} onOpenChange={(next) => setOpen(next && !disabled)}>
      <RadixPopover.Trigger asChild>{children}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          data-popconfirm
          side="top"
          align="center"
          sideOffset={6}
          collisionPadding={8}
          className={cn(popupSurface, "flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-1 p-3.5")}
        >
          <p className="font-semibold">{title}</p>
          {content && <div className="text-fg-muted">{content}</div>}
          <div className="mt-2.5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {cancelText}
            </Button>
            <Button
              variant={okType === "danger" ? "danger" : "default"}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm?.();
                } finally {
                  setBusy(false);
                  setOpen(false);
                }
              }}
            >
              {okText}
            </Button>
          </div>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
