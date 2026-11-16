import * as RadixPopover from "@radix-ui/react-popover";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** 气泡，组合写法：Popover / PopoverTrigger / PopoverContent，里面可以放 PopoverClose。 */
export function Popover({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <RadixPopover.Root {...(open !== undefined && { open })} {...(onOpenChange && { onOpenChange })}>
      {children}
    </RadixPopover.Root>
  );
}

export function PopoverTrigger({ asChild, type, ...props }: React.ComponentProps<"button"> & { asChild?: boolean }) {
  return <RadixPopover.Trigger asChild={asChild} type={asChild ? undefined : (type ?? "button")} {...props} />;
}

/** 浮层的外观：气泡、菜单、下拉共用。层级和弹窗相同，后打开的盖在先打开的上面。 */
export const popupSurface =
  "z-[1000] rounded-lg bg-popover text-fg text-sm shadow-popover outline-none data-[state=closed]:hidden";

export function PopoverContent({
  className,
  align = "start",
  side = "bottom",
  children,
}: {
  className?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  children?: React.ReactNode;
}) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        side={side}
        sideOffset={4}
        collisionPadding={8}
        className={cn(popupSurface, "max-h-(--radix-popover-content-available-height) overflow-auto p-1", className)}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}

/** 气泡里的「关闭」：点了收起气泡。 */
export function PopoverClose({ asChild, children }: { asChild?: boolean; children: React.ReactNode }) {
  return (
    <RadixPopover.Close asChild={asChild} type={asChild ? undefined : "button"}>
      {children}
    </RadixPopover.Close>
  );
}
