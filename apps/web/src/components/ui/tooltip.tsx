import * as RadixTooltip from "@radix-ui/react-tooltip";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 悬停提示：把 children 包起来，悬停或聚焦时在旁边显示 content。
 * 内容可以是一张小卡片（比如流程图节点的悬停卡片），不只是一行字。
 */
export function Tooltip({
  content,
  side = "top",
  delay = 300,
  className,
  children,
}: {
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <RadixTooltip.Provider delayDuration={delay} skipDelayDuration={200}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            data-tooltip
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "z-[1000] max-w-80 rounded-lg bg-popover px-3 py-2 text-fg text-sm shadow-popover outline-none",
              className,
            )}
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
