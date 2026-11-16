import type * as React from "react";
import { cn } from "@/lib/utils";

/** 页面顶部：面包屑、标题、右侧操作。 */
export function PageHeader({
  title,
  breadcrumb,
  actions,
  tabs,
  children,
  className,
}: {
  title: React.ReactNode;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
  /** 标题下面一行的页签（如工作项主页的「工作项列表 / 视图列表」）。 */
  tabs?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex shrink-0 flex-col gap-0.5 border-line-subtle border-b px-5 pt-3 pb-2.5", className)}>
      {breadcrumb && <div className="flex items-center gap-1 text-fg-subtle text-xs">{breadcrumb}</div>}
      <div className="flex min-h-7 items-center gap-3">
        <h1 className="truncate font-semibold text-[16px] tracking-[-0.01em]">{title}</h1>
        {children}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="-mb-2.5 -ml-2">{tabs}</div>}
    </header>
  );
}

/** 页面主体：居中的内容区。 */
export function PageBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto flex w-full max-w-6xl flex-col gap-4 p-5", className)} {...props} />;
}

/** 空状态：说明为什么是空的、下一步做什么。 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-12 text-center", className)}>
      <p className="font-medium text-sm">{title}</p>
      {description && <p className="max-w-md text-sm text-fg-subtle">{description}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

/** 面板里的小节：小标题加内容，用细线分隔，不套卡片。 */
export function Section({
  title,
  actions,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & { title: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-3", className)} {...props}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** 错误提示条。 */
export function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-600">
      {children}
    </p>
  );
}

/** 侧边面板里的一节：标题加内容，节与节之间用细线分开。 */
export function Panel({
  title,
  actions,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & { title: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section
      className={cn("flex flex-col gap-2.5 border-line-subtle border-b px-5 py-4 last:border-b-0", className)}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
