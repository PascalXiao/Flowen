import { Tag as SemiTag } from "@douyinfe/semi-ui";
import type * as React from "react";

/** 标签颜色；brand 是飞书蓝，其余用 Semi 的调色板。 */
const TONES = {
  neutral: "grey",
  brand: "blue",
  success: "green",
  warning: "orange",
  danger: "red",
  violet: "violet",
  teal: "teal",
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
    <SemiTag size="small" shape="square" type="light" color={TONES[tone ?? "neutral"]} className={className}>
      {children}
    </SemiTag>
  );
}

const STATUS: Record<string, [string, TagTone]> = {
  inProgress: ["进行中", "brand"],
  completed: ["已完成", "success"],
  terminated: ["已终止", "neutral"],
};

/** 工作项状态。 */
export function StatusTag({ status }: { status: string | null | undefined }) {
  const [label, tone] = STATUS[status ?? "inProgress"] ?? [status ?? "", "neutral"];
  return <Tag tone={tone}>{label}</Tag>;
}

/** 阶段：按名称固定配一个颜色，同一阶段在各处颜色一致。 */
const STAGE_TONES: TagTone[] = ["violet", "teal", "warning", "brand", "success"];
export function StageTag({ stage }: { stage: string | null | undefined }) {
  if (!stage) return <span className="text-fg-subtle">—</span>;
  let hash = 0;
  for (const ch of stage) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return <Tag tone={STAGE_TONES[hash % STAGE_TONES.length]}>{stage}</Tag>;
}
