import { nodeFlowOf, statusFlowOf } from "@fp/engine";
import { compactFilter, mutators, type WorkItemFilterArgs } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { Bookmark, Lock, MoreHorizontal, Pin, X, Zap } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import type { FieldConfig } from "@/components/FieldInput";
import { FilterConditions, filterTargets, flowNodes, MultiPick } from "@/components/FilterConditions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, newId } from "@/lib/utils";

const STATUS_OPTIONS = [
  ["inProgress", "进行中"],
  ["completed", "已完成"],
  ["terminated", "已终止"],
] as const;

interface Option {
  id: string;
  name: string;
}
export interface FilterView {
  id: string;
  name: string;
  filter: WorkItemFilterArgs;
  createdBy: string;
  description?: string | null;
  kind?: string | null;
  visibility?: string | null;
  members?: readonly { userId: string; role: string | null }[];
  /** 列表的显示设置（列、排序、分组、着色）。 */
  display?: unknown;
}

/** 选中视图时用的筛选：固定视图只看视图里的工作项。 */
export const viewFilter = (view: FilterView): WorkItemFilterArgs =>
  view.kind === "fixed" ? { ...view.filter, viewId: view.id } : view.filter;

/** 是否和当前筛选条件相同（按有值的条件比较）。 */
function same(a: WorkItemFilterArgs, b: WorkItemFilterArgs) {
  const ca = compactFilter(a) as Record<string, unknown>;
  const cb = compactFilter(b) as Record<string, unknown>;
  const keys = new Set([...Object.keys(ca), ...Object.keys(cb)]);
  return [...keys].every((k) => JSON.stringify(ca[k]) === JSON.stringify(cb[k]));
}

type FieldFilter = NonNullable<WorkItemFilterArgs["fields"]>[number];
/** 快捷筛选能用的字段类型：选项、人员、是否。 */
const QUICK_TYPES = new Set(["select", "radio", "multiSelect", "bool", "user", "singleUser", "businessLine", "signal"]);

/**
 * 工作项列表的筛选条和保存的视图。上面一排是视图页签，下面是快捷筛选（阶段、状态、参与人和选出来的字段）、
 * 条件组筛选和列表工具。筛选在服务端查询里执行，切换条件只同步命中的工作项。
 */
export function FilterBar({
  spaceId,
  filter,
  onChange,
  types,
  members,
  views,
  isAdmin,
  isGuest,
  actions,
  tools,
  search,
  display,
  onView,
  fixedTypeId,
  quick = [],
  onQuick,
  rowIds = [],
}: {
  spaceId: string;
  filter: WorkItemFilterArgs;
  onChange: (filter: WorkItemFilterArgs) => void;
  /** definitions：类型已发布的流程定义（节点流或状态流），用来列出可筛的阶段和节点。 */
  types: (Option & {
    definitions: unknown[];
    fields?: readonly FieldConfig[];
    roles?: readonly { key: string; name: string }[];
  })[];
  members: Option[];
  views: readonly FilterView[];
  isAdmin: boolean;
  isGuest?: boolean;
  /** 视图页签右边的操作，如切换列表和甘特图。 */
  actions?: ReactNode;
  /** 接在筛选后面的列表工具（排序、分组…）和搜索框，只有列表视图有。 */
  tools?: ReactNode;
  search?: ReactNode;
  /** 当前列表的显示设置，保存视图时一起存。 */
  display?: unknown;
  /** 选中一个视图（除了筛选，还要套用它的显示设置）。 */
  onView?: (view: FilterView) => void;
  /** 在某个工作项的主页里：只看这一种类型，类型筛选不显示，切换条件和视图时都保留。 */
  fixedTypeId?: string;
  /** 快捷筛选：显示在筛选条上的字段键。 */
  quick?: readonly string[];
  onQuick?: (keys: string[]) => void;
  /** 列表当前的工作项，存成固定视图时放进去。 */
  rowIds?: readonly string[];
}) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FilterView | null>(null);
  const [sharing, setSharing] = useState<FilterView | null>(null);
  const change = (next: WorkItemFilterArgs) => onChange(fixedTypeId ? { ...next, typeIds: [fixedTypeId] } : next);
  const scoped = types.filter((t) => !filter.typeIds?.length || filter.typeIds.includes(t.id));
  const stages = [
    ...new Set(
      scoped
        .flatMap((t) =>
          t.definitions.flatMap((d) => [
            ...(nodeFlowOf(d)?.nodes.map((n) => n.stageOnArrival) ?? []),
            ...(statusFlowOf(d)?.statuses.map((s) => s.name) ?? []),
          ]),
        )
        .filter((s): s is string => !!s),
    ),
  ];
  const empty = Object.entries(compactFilter(filter)).every(([k]) => fixedTypeId && k === "typeIds");
  const targets = filterTargets({ types: scoped, members, stages });
  const nodes = flowNodes(scoped);
  const quickFields = new Map(
    scoped
      .flatMap((t) => t.fields ?? [])
      .filter((f) => QUICK_TYPES.has(f.dataType))
      .map((f) => [f.key, f]),
  );
  const active = views.find((v) => !empty && same(viewFilter(v), filter));
  const canEdit = (v: FilterView) =>
    isAdmin || v.createdBy === zero.userID || !!v.members?.some((m) => m.userId === zero.userID && m.role === "edit");
  const isOwner = (v: FilterView) => isAdmin || v.createdBy === zero.userID;

  const pick = (key: keyof WorkItemFilterArgs, value: string) =>
    change({ ...filter, [key]: value ? [value] : undefined });
  const setFieldFilter = (key: string, values: string[]) => {
    const rest = (filter.fields ?? []).filter((f) => f.field !== key);
    const next: FieldFilter[] = values.length ? [...rest, { field: key, op: "in", values }] : rest;
    change({ ...filter, fields: next.length ? next : undefined });
  };

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

  const choices = (f: FieldConfig) =>
    f.dataType === "bool"
      ? [
          { value: "true", label: "是" },
          { value: "false", label: "否" },
        ]
      : f.dataType === "user" || f.dataType === "singleUser"
        ? [{ value: "$me", label: "我" }, ...members.map((m) => ({ value: m.id, label: m.name }))]
        : (f.options ?? []).map((o) => ({ value: o.value, label: o.label ?? o.value }));
  // 不在快捷筛选里的字段条件（旧视图里存的）显示成标签，可以去掉
  const extraFields = (filter.fields ?? []).filter((f) => !quick.includes(f.field));

  const tab = (on: boolean) =>
    cn(
      "inline-flex h-7 cursor-pointer items-center rounded-md px-2.5 text-sm transition-colors",
      on ? "bg-brand-50 font-medium text-accent" : "text-fg-muted hover:bg-hover hover:text-fg",
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div role="tablist" aria-label="视图" className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <button type="button" role="tab" aria-selected={empty} onClick={() => change({})} className={tab(empty)}>
            全部
          </button>
          {views.map((view) => {
            const on = active?.id === view.id;
            return (
              <span key={view.id} className={cn(tab(on), "group gap-1 pr-1")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={on}
                  title={view.description ?? undefined}
                  onClick={() => {
                    change(viewFilter(view));
                    onView?.(view);
                  }}
                  className="inline-flex cursor-pointer items-center gap-1"
                >
                  {view.visibility === "personal" && <Lock aria-label="个人视图" className="size-3 opacity-70" />}
                  {view.kind === "fixed" && <Pin aria-label="固定视图" className="size-3 opacity-70" />}
                  {view.name}
                </button>
                {canEdit(view) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`视图操作 ${view.name}`}
                      className={cn(
                        "cursor-pointer rounded p-0.5 text-fg-subtle hover:bg-pressed hover:text-fg focus-visible:opacity-100",
                        !on && "opacity-0 group-hover:opacity-100",
                      )}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {on && (
                        <DropdownMenuItem
                          onSelect={() => {
                            const { viewId: _v, ...rest } = filter;
                            run(
                              mutators.view.update({
                                id: view.id,
                                filter: rest,
                                ...(display ? { display: display as never } : {}),
                              }),
                            );
                          }}
                        >
                          用当前条件和显示更新视图
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => setEditing(view)}>编辑名称和说明</DropdownMenuItem>
                      {isOwner(view) && view.visibility === "personal" && (
                        <DropdownMenuItem onSelect={() => setSharing(view)}>协作者</DropdownMenuItem>
                      )}
                      {isOwner(view) && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-danger-600"
                            onSelect={() => run(mutators.view.delete({ id: view.id }))}
                          >
                            删除视图 {view.name}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </span>
            );
          })}
        </div>
        {search}
        {actions}
      </div>
      {active?.description && <p className="-mt-1.5 text-fg-muted text-xs">{active.description}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {!fixedTypeId && (
          <Select
            aria-label="按类型筛选"
            value={filter.typeIds?.[0] ?? ""}
            onChange={(e) =>
              onChange({
                ...filter,
                typeIds: e.target.value ? [e.target.value] : undefined,
                stages: undefined,
                fields: undefined,
                conds: undefined,
              })
            }
          >
            <option value="">全部类型</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label="按阶段筛选"
          value={filter.stages?.[0] ?? ""}
          onChange={(e) => pick("stages", e.target.value)}
        >
          <option value="">全部阶段</option>
          {stages.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          aria-label="按状态筛选"
          value={filter.statuses?.[0] ?? ""}
          onChange={(e) => pick("statuses", e.target.value)}
        >
          <option value="">全部状态</option>
          {STATUS_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="按参与人筛选"
          value={filter.memberIds?.[0] ?? ""}
          onChange={(e) => pick("memberIds", e.target.value)}
        >
          <option value="">全部参与人</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        {quick.flatMap((key) => {
          const f = quickFields.get(key);
          if (!f) return [];
          const current = filter.fields?.find((x) => x.field === key);
          return [
            <MultiPick
              key={key}
              label={`快捷筛选 ${f.name}`}
              className={cn("max-w-48 flex-none", current && "border-accent text-accent")}
              choices={choices(f)}
              value={current?.op === "in" ? current.values : []}
              onChange={(values) => setFieldFilter(key, values)}
              placeholder={`全部${f.name}`}
              placeholderClass="text-fg"
            />,
          ];
        })}
        {extraFields.map((f) => {
          const name = quickFields.get(f.field)?.name ?? targets.find((t) => t.key === f.field)?.name ?? f.field;
          const text =
            f.op === "in"
              ? `${name}：${f.values.join("、")}`
              : f.op === "contains"
                ? `${name}包含“${f.text}”`
                : `${name}：${f.min ?? "不限"} ~ ${f.max ?? "不限"}`;
          return (
            <span
              key={f.field}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-brand-50 pr-1 pl-2.5 text-sm text-accent"
            >
              {text}
              <button
                type="button"
                aria-label={`去掉条件 ${text}`}
                className="rounded p-0.5 hover:bg-brand-100"
                onClick={() => setFieldFilter(f.field, [])}
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })}
        <FilterConditions
          targets={targets}
          nodes={nodes}
          value={filter.conds}
          onChange={(conds) => change({ ...filter, conds })}
        />
        {onQuick && quickFields.size > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="设置快捷筛选" title="设置快捷筛选">
                <Zap />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="flex w-56 flex-col gap-1 p-2">
              <p className="px-1 pb-1 text-fg-subtle text-xs">选几个常用字段，显示在筛选条上一键筛选。</p>
              <ul aria-label="快捷筛选字段" className="flex max-h-64 flex-col overflow-y-auto">
                {[...quickFields.values()].map((f) => (
                  <li key={f.key}>
                    <Checkbox
                      className="h-7 w-full px-1"
                      checked={quick.includes(f.key)}
                      onChange={(e) => {
                        onQuick(e.target.checked ? [...quick, f.key] : quick.filter((k) => k !== f.key));
                        if (!e.target.checked) setFieldFilter(f.key, []);
                      }}
                    >
                      {f.name}
                    </Checkbox>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        )}
        {!empty && (
          <Button variant="ghost" onClick={() => change({})}>
            清空
          </Button>
        )}
        {tools && (
          <>
            <span aria-hidden className="mx-1 h-4 w-px bg-line" />
            <div className="flex flex-wrap items-center gap-0.5">{tools}</div>
          </>
        )}
        {(!empty || rowIds.length > 0) && (
          <SaveView
            isGuest={!!isGuest}
            rowCount={rowIds.length}
            onSave={async (v) => {
              const { viewId: _v, ...rest } = filter;
              const id = newId();
              const fixed = v.kind === "fixed";
              const base = filter.typeIds ? { typeIds: filter.typeIds } : {};
              const ok = await run(
                mutators.view.create({
                  id,
                  spaceId,
                  filter: fixed ? base : rest,
                  ...(display ? { display: display as never } : {}),
                  ...v,
                  ...(fixed && { itemIds: rowIds.slice(0, 500) }),
                }),
              );
              // 固定视图存的是工作项，保存后切到这个视图
              if (ok && fixed) change({ ...base, viewId: id });
              return ok;
            }}
          />
        )}
      </div>
      {error && <p className="text-sm text-danger-600">{error}</p>}
      {editing && (
        <EditView
          view={editing}
          canPublish={isOwner(editing) && !isGuest}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            if (await run(mutators.view.update({ id: editing.id, ...patch }))) setEditing(null);
          }}
        />
      )}
      {sharing && (
        <ShareView
          view={sharing}
          members={members.filter((m) => m.id !== sharing.createdBy)}
          onClose={() => setSharing(null)}
          onSave={async (list) => {
            if (await run(mutators.view.setMembers({ id: sharing.id, members: list }))) setSharing(null);
          }}
        />
      )}
    </div>
  );
}

type NewView = { name: string; description?: string; visibility: "public" | "personal"; kind: "condition" | "fixed" };

/** 保存为视图：名称、说明、可见范围（公共 / 个人）、类型（按条件 / 固定这些工作项）。 */
function SaveView({
  isGuest,
  rowCount,
  onSave,
}: {
  isGuest: boolean;
  rowCount: number;
  onSave: (view: NewView) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    if (!name) return;
    const description = String(data.get("description") ?? "").trim();
    const ok = await onSave({
      name,
      ...(description && { description }),
      visibility: isGuest ? "personal" : (String(data.get("visibility")) as NewView["visibility"]),
      kind: String(data.get("kind")) as NewView["kind"],
    });
    if (ok) setOpen(false);
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="ml-auto">
          <Bookmark />
          保存为视图
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <Field label="视图名称">
            <Input name="name" required maxLength={50} />
          </Field>
          <Field label="说明">
            <Textarea name="description" rows={2} maxLength={500} placeholder="这个视图看什么、给谁用（可不填）" />
          </Field>
          <Field label="可见范围" hint={isGuest ? "访客只能建个人视图。" : "个人视图只有你和你加的协作者能看到。"}>
            <Select name="visibility" defaultValue={isGuest ? "personal" : "public"} disabled={isGuest}>
              <option value="public">公共视图</option>
              <option value="personal">个人视图</option>
            </Select>
          </Field>
          <Field
            label="视图类型"
            hint={`固定视图把当前列表的 ${rowCount} 个工作项放进去，之后可以手动加入、移出，不随条件变化。`}
          >
            <Select name="kind" defaultValue="condition">
              <option value="condition">条件视图</option>
              <option value="fixed" disabled={rowCount === 0}>
                固定视图
              </option>
            </Select>
          </Field>
          <Button type="submit" className="self-end">
            保存
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function EditView({
  view,
  canPublish,
  onClose,
  onSave,
}: {
  view: FilterView;
  canPublish: boolean;
  onClose: () => void;
  onSave: (patch: { name: string; description: string | null; visibility?: "public" | "personal" }) => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="编辑视图">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            onSave({
              name: String(data.get("name") ?? "").trim(),
              description: String(data.get("description") ?? "").trim() || null,
              ...(canPublish && { visibility: String(data.get("visibility")) as "public" | "personal" }),
            });
          }}
        >
          <Field label="视图名称">
            <Input name="name" required maxLength={50} defaultValue={view.name} />
          </Field>
          <Field label="说明">
            <Textarea name="description" rows={3} maxLength={500} defaultValue={view.description ?? ""} />
          </Field>
          {canPublish && (
            <Field label="可见范围">
              <Select name="visibility" defaultValue={view.visibility ?? "public"}>
                <option value="public">公共视图</option>
                <option value="personal">个人视图</option>
              </Select>
            </Field>
          )}
          <Button type="submit" className="self-end">
            保存
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 个人视图的协作者：选空间成员，各给「可编辑」或「仅查看」。 */
function ShareView({
  view,
  members,
  onClose,
  onSave,
}: {
  view: FilterView;
  members: readonly Option[];
  onClose: () => void;
  onSave: (list: { userId: string; role: "edit" | "view" }[]) => void;
}) {
  const [list, setList] = useState(
    (view.members ?? []).map((m) => ({
      userId: m.userId,
      role: m.role === "edit" ? ("edit" as const) : ("view" as const),
    })),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={`协作者：${view.name}`}
        description="协作者能看到这个个人视图；可编辑的还能改条件和显示设置。"
      >
        <div className="flex flex-col gap-3">
          <MultiPick
            label="添加协作者"
            choices={members.map((m) => ({ value: m.id, label: m.name }))}
            value={list.map((m) => m.userId)}
            onChange={(ids) =>
              setList(ids.map((id) => list.find((m) => m.userId === id) ?? { userId: id, role: "view" as const }))
            }
          />
          <ul aria-label="协作者" className="flex flex-col">
            {list.map((m) => (
              <li key={m.userId} className="flex h-9 items-center gap-2 border-line-subtle border-b last:border-0">
                <span className="flex-1">{members.find((x) => x.id === m.userId)?.name ?? m.userId}</span>
                <Select
                  aria-label={`${members.find((x) => x.id === m.userId)?.name ?? m.userId} 的权限`}
                  className="w-28"
                  value={m.role}
                  onChange={(e) =>
                    setList(
                      list.map((x) => (x.userId === m.userId ? { ...x, role: e.target.value as "edit" | "view" } : x)),
                    )
                  }
                >
                  <option value="view">仅查看</option>
                  <option value="edit">可编辑</option>
                </Select>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="移除"
                  onClick={() => setList(list.filter((x) => x.userId !== m.userId))}
                >
                  <X />
                </Button>
              </li>
            ))}
            {list.length === 0 && <li className="py-2 text-fg-subtle text-sm">还没有协作者。</li>}
          </ul>
          <Button className="self-end" onClick={() => onSave(list)}>
            保存
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
