import type * as React from "react";
import { cn } from "@/lib/utils";

/** 标签颜色：浅底加同色系文字。brand 是强调色。 */
const TONES = {
  neutral: "bg-pressed text-fg-muted",
  brand: "bg-brand-50 text-accent",
  success: "bg-success-50 text-success-600",
  warning: "bg-warning-50 text-warning-600",
  danger: "bg-danger-50 text-danger-600",
  violet: "bg-violet-50 text-violet-600",
  teal: "bg-teal-50 text-teal-600",
} as const;

export type TagTone = keyof typeof TONES;

export function Tag({
  className,
  tone = "neutral",
  children,
}: {
  className?: string;
  tone?: TagTone | null;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full shrink-0 items-center whitespace-nowrap rounded-[5px] px-1.5 font-medium text-xs",
        TONES[tone ?? "neutral"],
        className,
      )}
    >
      {children}
    </span>
  );
}

const STATUS: Record<string, [string, TagTone, string]> = {
  inProgress: ["进行中", "brand", "bg-accent"],
  completed: ["已完成", "success", "bg-success-500"],
  terminated: ["已终止", "neutral", "bg-fg-subtle"],
};

/** 工作项状态：圆点加文字的胶囊。 */
export function StatusTag({ status }: { status: string | null | undefined }) {
  const [label, tone, dot] = STATUS[status ?? "inProgress"] ?? [status ?? "", "neutral", "bg-fg-subtle"];
  return (
    <Tag tone={tone} className="gap-1.5 rounded-full px-2">
      <span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </Tag>
  );
}

/**
 * 分类用的颜色：只用不带含义的色。蓝（当前）、红（逾期）、黄（临期）、绿（完成）留给状态，
 * 阶段、选项这类分类不占用，免得「概念阶段」看着像快到期。
 */
export const CATEGORY_TONES: TagTone[] = ["neutral", "violet", "teal"];

/** 阶段：按名称固定配一个颜色，同一阶段在各处颜色一致。 */
const STAGE_TONES = CATEGORY_TONES;
export function StageTag({ stage }: { stage: string | null | undefined }) {
  if (!stage) return <span className="text-fg-subtle">—</span>;
  let hash = 0;
  for (const ch of stage) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return <Tag tone={STAGE_TONES[hash % STAGE_TONES.length]}>{stage}</Tag>;
}
