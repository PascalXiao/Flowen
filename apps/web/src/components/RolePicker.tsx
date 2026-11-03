import { Check, Plus, X } from "lucide-react";
import { Avatar, UserChip } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface PickerMember {
  userId: string;
  name: string;
}

/** 角色一行需要的信息。 */
export interface PickerRole {
  key: string;
  name: string;
  /** 限制为单人：选一个人会替换掉原来的人。 */
  single?: boolean;
  /** 当前用户不能改这个角色的成员。 */
  readOnly?: boolean;
  /** 能把这个角色从工作项上删掉。 */
  removable?: boolean;
  /** 负责人角色，名字后面标一下。 */
  isOwner?: boolean;
}

/**
 * 角色 → 成员。每个角色一行：已选的人，点“设置”弹出空间成员列表勾选。
 * 传了 onRemove / addable 时，可以删掉角色、从默认隐藏的角色里「添加角色」。
 */
export function RolePicker({
  roles,
  members,
  value,
  onToggle,
  onRemove,
  addable = [],
  onAdd,
}: {
  roles: readonly PickerRole[];
  members: readonly PickerMember[];
  value: Readonly<Record<string, readonly string[]>>;
  onToggle: (roleKey: string, userId: string, selected: boolean) => void;
  onRemove?: (roleKey: string) => void;
  addable?: readonly PickerRole[];
  onAdd?: (roleKey: string) => void;
}) {
  const names = new Map(members.map((m) => [m.userId, m.name]));
  return (
    <div className="flex flex-col">
      <dl className="flex flex-col">
        {roles.map((role) => {
          const chosen = value[role.key] ?? [];
          return (
            <div key={role.key} className="group flex min-h-9 items-start gap-3 py-1">
              <dt className="flex w-28 shrink-0 items-center gap-1 pt-1.5 text-fg-muted" title={role.name}>
                <span className="truncate">{role.name}</span>
                {role.isOwner && <span className="shrink-0 text-xs text-brand-500">负责人</span>}
              </dt>
              <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                {chosen.map((id) => (
                  <UserChip key={id} id={id} name={names.get(id) ?? id} />
                ))}
                {!role.readOnly && (
                  <Popover>
                    <PopoverTrigger
                      aria-label={`设置${role.name}`}
                      className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg"
                    >
                      <Plus className="size-4" />
                    </PopoverTrigger>
                    <PopoverContent className="w-56">
                      <p className="px-2 py-1.5 text-xs text-fg-subtle">
                        {role.name}
                        {role.single && "（单人）"}
                      </p>
                      {members.map((m) => {
                        const selected = chosen.includes(m.userId);
                        return (
                          <button
                            key={m.userId}
                            type="button"
                            aria-pressed={selected}
                            aria-label={`${role.name}：${m.name}`}
                            onClick={() => onToggle(role.key, m.userId, !selected)}
                            className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
                          >
                            <Avatar id={m.userId} name={m.name} size={20} />
                            <span className="flex-1 truncate">{m.name}</span>
                            <Check className={cn("size-4 text-brand-500", !selected && "invisible")} />
                          </button>
                        );
                      })}
                    </PopoverContent>
                  </Popover>
                )}
                {chosen.length === 0 && role.readOnly && <span className="text-fg-subtle">—</span>}
              </dd>
              {onRemove && role.removable && (
                <button
                  type="button"
                  aria-label={`删除角色 ${role.name}`}
                  title="删除角色"
                  className="mt-1.5 shrink-0 text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-danger-600 focus-visible:opacity-100"
                  onClick={() => onRemove(role.key)}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          );
        })}
      </dl>
      {onAdd && addable.length > 0 && (
        <Popover>
          <PopoverTrigger className="mt-1 inline-flex w-fit cursor-pointer items-center gap-1 rounded-md px-1 py-1 text-sm text-brand-500 hover:bg-hover">
            <Plus className="size-4" />
            添加角色
          </PopoverTrigger>
          <PopoverContent className="max-h-72 w-56 overflow-y-auto">
            {addable.map((r) => (
              <button
                key={r.key}
                type="button"
                aria-label={`添加角色 ${r.name}`}
                className="flex h-8 w-full cursor-pointer items-center rounded-md px-2 text-left hover:bg-hover"
                onClick={() => onAdd(r.key)}
              >
                {r.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** 切换一个人在角色里的选中状态，返回新的成员列表；单人角色选人时替换掉原来的人。 */
export function toggled(
  current: readonly string[] | undefined,
  userId: string,
  selected: boolean,
  single = false,
): string[] {
  if (selected && single) return [userId];
  const rest = (current ?? []).filter((u) => u !== userId);
  return selected ? [...rest, userId] : rest;
}
