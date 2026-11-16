import { cn } from "@/lib/utils";

/** 头像底色：一组低饱和的颜色，亮色暗色下都不抢眼；按用户固定。 */
const COLORS = ["#5f8f7b", "#6f78a8", "#b07a52", "#96708f", "#7d8a5c", "#5b8aa6", "#a6705f", "#7a6fa8"] as const;

function colorOf(key: string) {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** 用户头像：用名字的最后一个字（中文）或首字母，颜色按用户固定。 */
export function Avatar({
  name,
  id,
  size = 24,
  className,
}: {
  name: string;
  id?: string;
  size?: number;
  className?: string;
}) {
  const text = /[一-鿿]/.test(name) ? name.slice(-1) : name.slice(0, 1).toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white leading-none",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), backgroundColor: colorOf(id ?? name) }}
    >
      {text}
    </span>
  );
}

/** 头像加名字。 */
export function UserChip({ name, id }: { name: string; id?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={name} {...(id && { id })} size={20} />
      <span>{name}</span>
    </span>
  );
}
