import { Dropdown } from "@douyinfe/semi-ui";
import * as React from "react";
import { cn } from "@/lib/utils";
import { semiPosition } from "./popover";

/**
 * 下拉菜单（Semi Dropdown），沿用 DropdownMenu / Trigger / Content / Item / Label / Separator 的组合写法。
 */
type TriggerProps = React.ComponentProps<"button"> & { asChild?: boolean };
type ContentProps = {
  className?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  children?: React.ReactNode;
};

const CloseMenu = React.createContext<() => void>(() => {});

export function DropdownMenuTrigger(_: TriggerProps): React.ReactNode {
  return null;
}
export function DropdownMenuContent(_: ContentProps): React.ReactNode {
  return null;
}

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  let trigger: React.ReactElement<TriggerProps> | undefined;
  let content: React.ReactElement<ContentProps> | undefined;
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === DropdownMenuTrigger) trigger = child as React.ReactElement<TriggerProps>;
    if (child.type === DropdownMenuContent) content = child as React.ReactElement<ContentProps>;
  });
  const { asChild: _asChild, children: triggerChildren, ...triggerProps } = trigger?.props ?? {};
  return (
    <CloseMenu.Provider value={() => setOpen(false)}>
      <Dropdown
        visible={open}
        trigger="custom"
        motion={false}
        onClickOutSide={() => setOpen(false)}
        position={semiPosition(content?.props.side, content?.props.align) as never}
        render={
          <CloseMenu.Provider value={() => setOpen(false)}>
            <Dropdown.Menu className={cn("min-w-40", content?.props.className)}>
              {content?.props.children}
            </Dropdown.Menu>
          </CloseMenu.Provider>
        }
      >
        <button type="button" aria-expanded={open} {...triggerProps} onClick={() => setOpen(!open)}>
          {triggerChildren}
        </button>
      </Dropdown>
    </CloseMenu.Provider>
  );
}

export function DropdownMenuItem({
  asChild,
  onSelect,
  className,
  children,
}: {
  asChild?: boolean;
  onSelect?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const close = React.useContext(CloseMenu);
  return (
    <Dropdown.Item
      className={cn("gap-2 [&_svg]:size-4 [&_svg]:text-fg-muted", asChild && "p-0!", className)}
      onClick={() => {
        onSelect?.();
        close();
      }}
    >
      {asChild && React.isValidElement<{ className?: string }>(children)
        ? React.cloneElement(children, {
            className: cn("flex w-full items-center gap-2 px-3 py-2", children.props.className),
          })
        : children}
    </Dropdown.Item>
  );
}

export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return <Dropdown.Title>{children}</Dropdown.Title>;
}

export function DropdownMenuSeparator() {
  return <Dropdown.Divider />;
}
