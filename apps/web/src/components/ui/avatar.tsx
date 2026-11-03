import { Avatar as SemiAvatar } from "@douyinfe/semi-ui";
import { cn } from "@/lib/utils";

const COLORS = ["blue", "violet", "teal", "orange", "red", "green", "purple", "indigo"] as const;

function colorOf(key: string) {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** 用户头像（Semi Avatar）：没有图片时用名字的最后一个字（中文）或首字母，颜色按用户固定。 */
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
    <SemiAvatar
      aria-hidden
      color={colorOf(id ?? name)}
      className={cn("shrink-0", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {text}
    </SemiAvatar>
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
