import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { popupSurface } from "./popover";

/** 下拉菜单，组合写法：DropdownMenu / Trigger / Content / Item / Label / Separator。 */
export function DropdownMenu({ children }: { children: React.ReactNode }) {
  return <RadixMenu.Root modal={false}>{children}</RadixMenu.Root>;
}

export function DropdownMenuTrigger({
  asChild,
  type,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  return <RadixMenu.Trigger asChild={asChild} type={asChild ? undefined : (type ?? "button")} {...props} />;
}

export function DropdownMenuContent({
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
    <RadixMenu.Portal>
      <RadixMenu.Content
        align={align}
        side={side}
        sideOffset={4}
        collisionPadding={8}
        className={cn(
          popupSurface,
          "max-h-(--radix-dropdown-menu-content-available-height) min-w-40 overflow-auto p-1",
          className,
        )}
      >
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  );
}

export function DropdownMenuItem({
  asChild,
  onSelect,
  active,
  className,
  children,
}: {
  asChild?: boolean;
  onSelect?: () => void;
  /** 当前选中的那一项：强调色加对勾。 */
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <RadixMenu.Item
      asChild={asChild}
      onSelect={() => onSelect?.()}
      className={cn(
        "flex h-7 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-sm outline-none data-[highlighted]:bg-hover [&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:text-fg-subtle",
        active && "font-medium text-accent",
        className,
      )}
    >
      {asChild ? (
        // Slot 只接受一个元素：asChild 时原样交出 children，不能再拼别的节点（哪怕是 false）。
        children
      ) : (
        <>
          {children}
          {active && <Check aria-hidden className="ml-auto text-accent!" />}
        </>
      )}
    </RadixMenu.Item>
  );
}

export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return <RadixMenu.Label className="px-2 pt-1.5 pb-1 text-fg-subtle text-xs">{children}</RadixMenu.Label>;
}

export function DropdownMenuSeparator() {
  return <RadixMenu.Separator className="-mx-1 my-1 h-px bg-line-subtle" />;
}
