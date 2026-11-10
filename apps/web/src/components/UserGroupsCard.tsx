import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { Trash2, Users } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { newId } from "@/lib/utils";

type Group = { id: string; name: string; members: readonly { userId: string }[] };

/**
 * 空间配置「权限」页签里的用户组：
 * 管理员建组、改名、选成员、删组。用户组本身没有权限，在工作项类型的「权限」页签里授权。
 */
export function UserGroupsCard({
  spaceId,
  groups,
  members,
  canManage,
}: {
  spaceId: string;
  groups: readonly Group[];
  members: readonly { userId: string; name: string }[];
  canManage: boolean;
}) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const name = (id: string) => members.find((m) => m.userId === id)?.name ?? id;

  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") {
        setError(outcome.error.message);
        return false;
      }
    return true;
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = String(new FormData(form).get("name") ?? "").trim();
    if (!value) return;
    const id = newId();
    if (await run(mutators.userGroup.create({ id, spaceId, name: value }))) {
      form.reset();
      setOpen(id);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>用户组</CardTitle>
        <CardDescription>
          把人编成组，再到工作项配置的「权限」页签里给组授权：能看到哪些工作项、能不能新建、终止、冻结、升级模板、删除。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {groups.length === 0 && <p className="text-sm text-fg-subtle">还没有用户组。</p>}
        <ul aria-label="用户组列表" className="flex flex-col divide-y divide-line-subtle">
          {groups.map((g) => {
            const ids = g.members.map((m) => m.userId);
            return (
              <li key={g.id} className="flex flex-col gap-2 py-2.5">
                <div className="flex items-center gap-3">
                  <Users className="size-4 text-fg-muted" />
                  {canManage ? (
                    <Input
                      key={g.name}
                      aria-label={`用户组名称 ${g.name}`}
                      defaultValue={g.name}
                      className="h-8 w-48"
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next && next !== g.name) run(mutators.userGroup.rename({ id: g.id, name: next }));
                      }}
                    />
                  ) : (
                    <span className="font-medium">{g.name}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
                    {ids.length ? ids.map(name).join("、") : "没有成员"}
                  </span>
                  {canManage && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-expanded={open === g.id}
                        onClick={() => setOpen(open === g.id ? null : g.id)}
                      >
                        {open === g.id ? "收起" : `成员（${ids.length}）`}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`删除用户组 ${g.name}`}
                        onClick={() => {
                          if (window.confirm(`删除用户组「${g.name}」？授权给它的权限会一起去掉。`))
                            run(mutators.userGroup.delete({ id: g.id }));
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
                {canManage && open === g.id && (
                  <fieldset aria-label={`${g.name}的成员`} className="grid grid-cols-2 gap-1 pl-7 sm:grid-cols-3">
                    {members.map((m) => (
                      <label key={m.userId} className="flex h-8 items-center gap-2 rounded px-2 text-sm hover:bg-hover">
                        <Checkbox
                          aria-label={`${m.name} 加入 ${g.name}`}
                          checked={ids.includes(m.userId)}
                          onChange={(e) =>
                            run(
                              mutators.userGroup.setMembers({
                                id: g.id,
                                userIds: e.target.checked ? [...ids, m.userId] : ids.filter((id) => id !== m.userId),
                              }),
                            )
                          }
                        />
                        <Avatar id={m.userId} name={m.name} size={20} />
                        <span className="truncate">{m.name}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </li>
            );
          })}
        </ul>
        {canManage && (
          <form className="flex items-center gap-2" onSubmit={create}>
            <Input name="name" aria-label="新用户组名称" placeholder="新用户组名称，如「测试组」" className="w-64" />
            <Button type="submit" variant="outline">
              新建用户组
            </Button>
          </form>
        )}
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
