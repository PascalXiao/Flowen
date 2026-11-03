import { Modal } from "@douyinfe/semi-ui";
import * as React from "react";

/**
 * 弹窗（Semi Modal），沿用 Dialog / DialogTrigger / DialogContent / DialogClose 的组合写法：
 * Dialog 管开关，Trigger 打开，Close 关上，Content 是弹窗本身。
 */
const DialogState = React.createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
  open: false,
  setOpen: () => {},
});

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [own, setOwn] = React.useState(false);
  const value = {
    open: open ?? own,
    setOpen: (next: boolean) => {
      if (open === undefined) setOwn(next);
      onOpenChange?.(next);
    },
  };
  return <DialogState.Provider value={value}>{children}</DialogState.Provider>;
}

/** 给子元素加上点击行为；asChild 时直接用子元素，否则包一个按钮。 */
function withClick(children: React.ReactNode, asChild: boolean | undefined, onClick: () => void, className?: string) {
  if (asChild && React.isValidElement<{ onClick?: (e: React.MouseEvent) => void }>(children))
    return React.cloneElement(children, {
      onClick: (e: React.MouseEvent) => {
        children.props.onClick?.(e);
        onClick();
      },
    });
  return (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
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
  const { setOpen } = React.useContext(DialogState);
  return withClick(children, asChild, () => setOpen(true), className);
}

export function DialogClose({ asChild, children }: { asChild?: boolean; children: React.ReactNode }) {
  const { setOpen } = React.useContext(DialogState);
  return withClick(children, asChild, () => setOpen(false));
}

export function DialogContent({
  className,
  children,
  title,
  description,
}: {
  className?: string;
  children: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  const { open, setOpen } = React.useContext(DialogState);
  // 宽度：调用方用 max-w-2xl 这类写法表示宽弹窗
  const width = className?.includes("max-w-2xl") ? 672 : className?.includes("max-w-xl") ? 576 : 512;
  // Esc 先收起弹窗里打开的气泡、下拉，没有打开的才关弹窗（Semi 自带的 Esc 会连弹窗一起关掉）
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[role="dialog"]:not([aria-modal="true"]), [role="listbox"]')) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });
  return (
    <Modal
      visible={open}
      title={title}
      width={width}
      footer={null}
      onCancel={() => setOpen(false)}
      closeOnEsc={false}
      bodyStyle={{ maxHeight: "70vh", overflowY: "auto", paddingBottom: 24 }}
    >
      {description && <p className="mb-4 text-sm text-fg-subtle">{description}</p>}
      {children}
    </Modal>
  );
}
