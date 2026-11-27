import { mutators, queries, teamMemberIds, teamWithDescendants } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { AuditLog } from "@/components/AuditLog";
import { PeoplePicker } from "@/components/PeoplePicker";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { EmptyState, ErrorBanner, PageHeader, Panel } from "@/components/ui/page";
import { Segmented, Tabs } from "@/components/ui/tabs";
import { Tag } from "@/components/ui/tag";
import { useIsOrgAdmin, useTeams } from "@/lib/org";
import { cn, newId } from "@/lib/utils";

type Team = ReturnType<typeof useTeams>[number];

/**
 * 团队：企业里的人员分组，不属于某个空间。左边是团队树（一个团队可以挂在多个上级下面），
 * 右边是选中团队的成员、信息和操作记录。谁都可以建团队；团队管理员和企业管理员能改。
 * 团队可以在视图筛选和人员排期里当作一组人来选。
 */
export function TeamsPage() {
  useActiveSpace(null);
  const zero = useZero();
  const teams = useTeams();
  const orgAdmin = useIsOrgAdmin();
  const [users] = useQuery(queries.org.users());
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Team | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const team = teams.find((t) => t.id === selected) ?? teams[0];
  const people = users.map((u) => ({ id: u.id, name: u.name, email: u.email }));

  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const result = await zero.mutate(request).server;
    if (result.type === "error") {
      setError(result.error.message);
      return false;
    }
    return true;
  }

  return (
    <>
      <PageHeader
        title="团队"
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            新建团队
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="团队树"
          className="flex w-64 shrink-0 flex-col gap-0.5 overflow-y-auto border-line-subtle border-r p-2"
        >
          {teams.length === 0 && <p className="px-2 py-3 text-fg-subtle text-sm">还没有团队。</p>}
          <TeamTree teams={teams} selected={team?.id} onSelect={setSelected} />
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {error && (
            <div className="px-5 pt-4">
              <ErrorBanner>{error}</ErrorBanner>
            </div>
          )}
          {team ? (
            <TeamDetail
              key={team.id}
              team={team}
              teams={teams}
              people={people}
              canManage={orgAdmin || (team.admins ?? []).includes(String(zero.userID))}
              onEdit={() => setEditing(team)}
              onDelete={async () => {
                if (window.confirm(`删除团队「${team.name}」？下级团队会保留，只是不再挂在它下面。`))
                  if (await run(mutators.team.delete({ id: team.id }))) setSelected(null);
              }}
              run={run}
            />
          ) : (
            <EmptyState
              title="还没有团队"
              description="把同一个部门或小组的人建成团队，在视图筛选、人员排期里就能按团队选人。"
              action={<Button onClick={() => setEditing("new")}>新建团队</Button>}
            />
          )}
        </div>
      </div>
      {editing && (
        <TeamDialog
          team={editing === "new" ? null : editing}
          teams={teams}
          people={people}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setSelected(id);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/** 团队树：没有上级的在最上层；有多个上级的在每个上级下面各出现一次。 */
function TeamTree({
  teams,
  selected,
  onSelect,
  parent = null,
  depth = 0,
  path = [],
}: {
  teams: readonly Team[];
  selected: string | undefined;
  onSelect: (id: string) => void;
  parent?: string | null;
  depth?: number;
  path?: string[];
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const ids = new Set(teams.map((t) => t.id));
  const level = teams.filter((t) =>
    parent === null ? !(t.parentIds ?? []).some((p) => ids.has(p)) : (t.parentIds ?? []).includes(parent),
  );
  return level
    .filter((t) => !path.includes(t.id))
    .map((t) => {
      const hasChildren = teams.some((c) => (c.parentIds ?? []).includes(t.id));
      const open = !collapsed.has(t.id);
      return (
        <div key={t.id} className="flex flex-col gap-0.5">
          <div
            className={cn(
              "flex h-8 items-center gap-1 rounded-md pr-2 text-sm hover:bg-hover",
              selected === t.id && "bg-hover font-medium",
            )}
            style={{ paddingLeft: 4 + depth * 16 }}
          >
            {hasChildren ? (
              <button
                type="button"
                aria-label={open ? `收起 ${t.name}` : `展开 ${t.name}`}
                className="flex size-5 cursor-pointer items-center justify-center rounded text-fg-subtle hover:bg-pressed"
                onClick={() => {
                  const next = new Set(collapsed);
                  if (open) next.add(t.id);
                  else next.delete(t.id);
                  setCollapsed(next);
                }}
              >
                {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
            ) : (
              <span className="w-5" />
            )}
            <button
              type="button"
              aria-current={selected === t.id ? "true" : undefined}
              onClick={() => onSelect(t.id)}
              className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
            >
              <Users className="size-3.5 shrink-0 text-fg-subtle" />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              <span className="text-fg-subtle text-xs tabular-nums">{t.members.length}</span>
            </button>
          </div>
          {hasChildren && open && (
            <TeamTree
              teams={teams}
              selected={selected}
              onSelect={onSelect}
              parent={t.id}
              depth={depth + 1}
              path={[...path, t.id]}
            />
          )}
        </div>
      );
    });
}

function TeamDetail({
  team,
  teams,
  people,
  canManage,
  onEdit,
  onDelete,
  run,
}: {
  team: Team;
  teams: readonly Team[];
  people: readonly { id: string; name: string; email: string }[];
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  run: (request: Parameters<ReturnType<typeof useZero>["mutate"]>[0]) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<"members" | "log">("members");
  const [scope, setScope] = useState<"direct" | "all">("direct");
  const [spaces] = useQuery(queries.spaces.mine());
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "已删除的用户";
  const direct = team.members.map((m) => m.userId);
  const all = useMemo(() => teamMemberIds(teams, team.id), [teams, team.id]);
  const sub = teamWithDescendants(teams, team.id).size - 1;
  const shown = scope === "all" ? all : direct;
  const parents = teams.filter((t) => (team.parentIds ?? []).includes(t.id));
  const setMembers = (userIds: string[]) => run(mutators.team.setMembers({ id: team.id, userIds }));

  return (
    <div className="flex flex-col">
      <Panel
        title={
          <span className="flex items-center gap-2 text-base">
            {team.name}
            <span className="font-normal text-fg-subtle text-sm">{direct.length} 人</span>
          </span>
        }
        actions={
          canManage && (
            <span className="flex gap-1">
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil />
                编辑
              </Button>
              <Button variant="ghost" size="sm" aria-label={`删除团队 ${team.name}`} onClick={onDelete}>
                <Trash2 />
              </Button>
            </span>
          )
        }
      >
        <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-fg-subtle">说明</dt>
          <dd>{team.description || <span className="text-fg-subtle">—</span>}</dd>
          <dt className="text-fg-subtle">上级团队</dt>
          <dd className="flex flex-wrap gap-1">
            {parents.length ? (
              parents.map((p) => <Tag key={p.id}>{p.name}</Tag>)
            ) : (
              <span className="text-fg-subtle">无</span>
            )}
          </dd>
          <dt className="text-fg-subtle">团队管理员</dt>
          <dd className="flex flex-wrap gap-3">
            {(team.admins ?? []).map((id) => (
              <span key={id} className="flex items-center gap-1.5">
                <Avatar id={id} name={nameOf(id)} size={18} />
                {nameOf(id)}
              </span>
            ))}
          </dd>
          <dt className="text-fg-subtle">可用空间</dt>
          <dd>
            {team.spaceIds?.length
              ? team.spaceIds.map((id) => spaces.find((s) => s.id === id)?.name ?? "其他空间").join("、")
              : "所有空间"}
          </dd>
        </dl>
      </Panel>
      <div className="border-line-subtle border-b px-3">
        <Tabs
          label="团队详情"
          value={tab}
          onChange={setTab}
          items={[
            ["members", "成员"],
            ["log", "操作记录"],
          ]}
        />
      </div>
      {tab === "members" ? (
        <section aria-label="团队成员" className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-center gap-2">
            <Segmented
              label="成员范围"
              value={scope}
              onChange={setScope}
              items={[
                ["direct", `直属成员 ${direct.length}`],
                ["all", `含下级团队 ${all.length}`],
              ]}
            />
            {sub > 0 && <span className="text-fg-subtle text-xs">有 {sub} 个下级团队</span>}
            {canManage && (
              <span className="ml-auto">
                <PeoplePicker label="添加成员" people={people} value={direct} onChange={setMembers} />
              </span>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="text-fg-subtle text-sm">还没有成员。</p>
          ) : (
            <ul aria-label="成员列表" className="flex flex-col divide-y divide-line-subtle">
              {shown.map((id) => {
                const p = people.find((x) => x.id === id);
                const isDirect = direct.includes(id);
                return (
                  <li key={id} className="flex h-11 items-center gap-3">
                    <Avatar id={id} name={p?.name ?? "?"} size={26} />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate text-sm">{p?.name ?? "已删除的用户"}</span>
                      {p?.email && <span className="truncate text-fg-subtle text-xs">{p.email}</span>}
                    </span>
                    {(team.admins ?? []).includes(id) && <Tag tone="violet">管理员</Tag>}
                    {!isDirect && <Tag>下级团队</Tag>}
                    {canManage && isDirect && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        aria-label={`移出 ${p?.name ?? id}`}
                        onClick={() => setMembers(direct.filter((x) => x !== id))}
                      >
                        <X />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <div className="px-5 py-4">
          {canManage ? (
            <AuditLog teamId={team.id} people={people} />
          ) : (
            <p className="text-fg-subtle text-sm">只有团队管理员和企业管理员可以查看操作记录。</p>
          )}
        </div>
      )}
    </div>
  );
}

/** 新建或编辑团队：名称、说明、上级团队（不能选自己和下级）、管理员、可用空间。 */
function TeamDialog({
  team,
  teams,
  people,
  onClose,
  onSaved,
}: {
  team: Team | null;
  teams: readonly Team[];
  people: readonly { id: string; name: string; email: string }[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const zero = useZero();
  const [spaces] = useQuery(queries.spaces.mine());
  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [parentIds, setParentIds] = useState<string[]>([...(team?.parentIds ?? [])]);
  const [admins, setAdmins] = useState<string[]>([...(team?.admins ?? [String(zero.userID)])]);
  const [members, setMembers] = useState<string[]>([]);
  const [spaceIds, setSpaceIds] = useState<string[] | null>(team?.spaceIds?.length ? [...team.spaceIds] : null);
  const [error, setError] = useState<string | null>(null);
  const blocked = team ? teamWithDescendants(teams, team.id) : new Set<string>();
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? id;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const id = team?.id ?? newId();
    const body = {
      id,
      name: name.trim(),
      description: description.trim() || null,
      parentIds,
      admins,
      spaceIds: spaceIds?.length ? spaceIds : null,
    };
    const result = await zero.mutate(team ? mutators.team.update(body) : mutators.team.create({ ...body, members }))
      .server;
    if (result.type === "error") return setError(result.error.message);
    onSaved(id);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={team ? "编辑团队" : "新建团队"} className="max-w-xl">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="团队名称">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} autoFocus />
          </Field>
          <Field label="说明">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </Field>
          <fieldset aria-label="上级团队" className="flex flex-col gap-1.5 text-sm">
            <legend className="mb-1.5 text-fg-muted">上级团队（可以选多个）</legend>
            <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
              {teams.filter((t) => !blocked.has(t.id)).length === 0 && (
                <span className="text-fg-subtle">没有可选的团队</span>
              )}
              {teams
                .filter((t) => !blocked.has(t.id))
                .map((t) => (
                  <Checkbox
                    key={t.id}
                    checked={parentIds.includes(t.id)}
                    onChange={(e) =>
                      setParentIds(e.target.checked ? [...parentIds, t.id] : parentIds.filter((p) => p !== t.id))
                    }
                  >
                    {t.name}
                  </Checkbox>
                ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="text-fg-muted">团队管理员</span>
            <div className="flex flex-wrap items-center gap-2">
              {admins.map((id) => (
                <Tag key={id}>{nameOf(id)}</Tag>
              ))}
              <PeoplePicker label="选择管理员" people={people} value={admins} onChange={setAdmins} />
            </div>
          </div>
          {!team && (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-fg-muted">成员</span>
              <div className="flex flex-wrap items-center gap-2">
                {members.map((id) => (
                  <Tag key={id}>{nameOf(id)}</Tag>
                ))}
                <PeoplePicker label="选择成员" people={people} value={members} onChange={setMembers} />
              </div>
            </div>
          )}
          <fieldset aria-label="可用空间" className="flex flex-col gap-1.5 text-sm">
            <legend className="mb-1.5 text-fg-muted">可用空间</legend>
            <Segmented
              label="可用空间范围"
              value={spaceIds === null ? "all" : "some"}
              onChange={(v) => setSpaceIds(v === "all" ? null : [])}
              items={[
                ["all", "所有空间"],
                ["some", "指定空间"],
              ]}
            />
            {spaceIds !== null && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                {spaces.map((s) => (
                  <Checkbox
                    key={s.id}
                    checked={spaceIds.includes(s.id)}
                    onChange={(e) =>
                      setSpaceIds(e.target.checked ? [...spaceIds, s.id] : spaceIds.filter((x) => x !== s.id))
                    }
                  >
                    {s.name}
                  </Checkbox>
                ))}
              </div>
            )}
          </fieldset>
          {error && <p className="text-danger-600 text-sm">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">{team ? "保存" : "创建"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
