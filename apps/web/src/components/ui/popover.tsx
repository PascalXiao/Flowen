import { Popover as SemiPopover } from "@douyinfe/semi-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 气泡（Semi Popover），沿用 Popover / PopoverTrigger / PopoverContent 的组合写法：
 * Trigger 和 Content 是 Popover 的直接子元素，这里把它们拼成 Semi 的 Popover。
 */
const PopoverState = React.createContext<(open: boolean) => void>(() => {});

type TriggerProps = React.ComponentProps<"button"> & { asChild?: boolean };
type ContentProps = {
  className?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  children?: React.ReactNode;
};

export function PopoverTrigger(_: TriggerProps): React.ReactNode {
  return null;
}
export function PopoverContent(_: ContentProps): React.ReactNode {
  return null;
}

/** Radix 的 side + align 换成 Semi 的 position。 */
export function semiPosition(side: ContentProps["side"] = "bottom", align: ContentProps["align"] = "start") {
  const base = { top: "top", right: "right", bottom: "bottom", left: "left" }[side];
  if (align === "center") return base;
  if (side === "top" || side === "bottom") return `${base}${align === "start" ? "Left" : "Right"}`;
  return `${base}${align === "start" ? "Top" : "Bottom"}`;
}

export function Popover({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [own, setOwn] = React.useState(false);
  const visible = open ?? own;
  const setOpen = (next: boolean) => {
    if (open === undefined) setOwn(next);
    onOpenChange?.(next);
  };
  // Esc 收起气泡；焦点不在气泡里时 Semi 自己收不到这个键
  React.useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
  let trigger: React.ReactElement<TriggerProps> | undefined;
  let content: React.ReactElement<ContentProps> | undefined;
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === PopoverTrigger) trigger = child as React.ReactElement<TriggerProps>;
    if (child.type === PopoverContent) content = child as React.ReactElement<ContentProps>;
  });
  const { asChild, children: triggerChildren, onClick, ...triggerProps } = trigger?.props ?? {};
  const triggerElement =
    asChild && React.isValidElement<{ onClick?: (e: React.MouseEvent) => void }>(triggerChildren) ? (
      React.cloneElement(triggerChildren, {
        onClick: (e: React.MouseEvent) => {
          triggerChildren.props.onClick?.(e);
          setOpen(!visible);
        },
      })
    ) : (
      <button
        type="button"
        aria-expanded={visible}
        {...triggerProps}
        onClick={(e) => {
          onClick?.(e);
          if (!triggerProps.disabled) setOpen(!visible);
        }}
      >
        {triggerChildren}
      </button>
    );
  return (
    <PopoverState.Provider value={setOpen}>
      <SemiPopover
        visible={visible}
        trigger="custom"
        motion={false}
        onClickOutSide={() => setOpen(false)}
        position={semiPosition(content?.props.side, content?.props.align) as never}
        spacing={4}
        content={
          <PopoverState.Provider value={setOpen}>
            <div className={cn("rounded-lg p-1 text-sm", content?.props.className)}>{content?.props.children}</div>
          </PopoverState.Provider>
        }
      >
        {triggerElement}
      </SemiPopover>
    </PopoverState.Provider>
  );
}

/** 气泡里的「关闭」：点了收起气泡。 */
export function PopoverClose({ asChild, children }: { asChild?: boolean; children: React.ReactNode }) {
  const setOpen = React.useContext(PopoverState);
  if (asChild && React.isValidElement<{ onClick?: (e: React.MouseEvent) => void }>(children))
    return React.cloneElement(children, {
      onClick: (e: React.MouseEvent) => {
        children.props.onClick?.(e);
        setOpen(false);
      },
    });
  return (
    <button type="button" onClick={() => setOpen(false)}>
      {children}
    </button>
  );
}
