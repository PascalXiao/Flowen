import { nodeFlowOf, statusFlowOf } from "@fp/engine";
import { mutators, type WorkItemFilterArgs } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { Bookmark, SlidersHorizontal, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import type { FieldConfig } from "@/components/FieldInput";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/input";
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
interface View {
  id: string;
  name: string;
  filter: WorkItemFilterArgs;
  createdBy: string;
  /** 列表的显示设置（列、排序、分组、着色）。 */
  display?: unknown;
}

/** 是否和当前筛选条件相同（按有值的条件比较）。 */
function same(a: WorkItemFilterArgs, b: WorkItemFilterArgs) {
  const keys = ["typeIds", "statuses", "stages", "memberIds"] as const;
  return (
    keys.every((k) => (a[k] ?? []).join() === (b[k] ?? []).join()) &&
    JSON.stringify(a.fields ?? []) === JSON.stringify(b.fields ?? [])
  );
}

/**
 * 工作项列表的筛选条和保存的视图。每个条件先做成单选（“全部”表示不限），存储格式支持多选。
 * 筛选在服务端查询里执行，切换条件只同步命中的工作项。
 */
export function FilterBar({
  spaceId,
  filter,
  onChange,
  types,
  members,
  views,
  isAdmin,
  actions,
  display,
  onView,
  fixedTypeId,
}: {
  spaceId: string;
  filter: WorkItemFilterArgs;
  onChange: (filter: WorkItemFilterArgs) => void;
  /** definitions：类型已发布的流程定义（节点流或状态流），用来列出可筛的阶段。 */
  types: (Option & { definitions: unknown[]; fields?: readonly FieldConfig[] })[];
  members: Option[];
  views: readonly View[];
  isAdmin: boolean;
  /** 视图页签右边的操作，如切换列表和甘特图。 */
  actions?: ReactNode;
  /** 当前列表的显示设置，保存视图时一起存。 */
  display?: unknown;
  /** 选中一个视图（除了筛选，还要套用它的显示设置）。 */
  onView?: (view: View) => void;
  /** 在某个工作项的主页里：只看这一种类型，类型筛选不显示，切换条件和视图时都保留。 */
  fixedTypeId?: string;
}) {
  const zero = useZero();
  const [error, setError] = useState<string | null>(null);
  const change = (next: WorkItemFilterArgs) => onChange(fixedTypeId ? { ...next, typeIds: [fixedTypeId] } : next);
  const stages = [
    ...new Set(
      types
        .filter((t) => !filter.typeIds?.length || filter.typeIds.includes(t.id))
        .flatMap((t) =>
          t.definitions.flatMap((d) => [
            ...(nodeFlowOf(d)?.nodes.map((n) => n.stageOnArrival) ?? []),
            ...(statusFlowOf(d)?.statuses.map((s) => s.name) ?? []),
          ]),
        )
        .filter((s): s is string => !!s),
    ),
  ];
  const empty = Object.entries(filter).every(([k, v]) => (fixedTypeId && k === "typeIds") || !v?.length);
  // 可筛的字段：筛了类型时只列这些类型的字段；同键字段只列一次
  const fields = [
    ...new Map(
      types
        .filter((t) => !filter.typeIds?.length || filter.typeIds.includes(t.id))
        .flatMap((t) => t.fields ?? [])
        .filter((f) => FILTER_OP[f.dataType])
        .map((f) => [f.key, f]),
    ).values(),
  ];

  const pick = (key: keyof WorkItemFilterArgs, value: string) =>
    change({ ...filter, [key]: value ? [value] : undefined });

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

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (
      name &&
      (await run(
        mutators.view.create({ id: newId(), spaceId, name, filter, ...(display ? { display: display as never } : {}) }),
      ))
    )
      form.reset();
  }

  const tab = (active: boolean) =>
    cn(
      "inline-flex h-7 cursor-pointer items-center rounded-md px-2.5 text-sm transition-colors",
      active ? "bg-brand-50 font-medium text-brand-500" : "text-fg-muted hover:bg-hover hover:text-fg",
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div role="tablist" aria-label="视图" className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <button type="button" role="tab" aria-selected={empty} onClick={() => change({})} className={tab(empty)}>
            全部
          </button>
          {views.map((view) => {
            const active = !empty && same(view.filter, filter);
            return (
              <span key={view.id} className={cn(tab(active), "group gap-1 pr-1")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    change(view.filter);
                    onView?.(view);
                  }}
                  className="cursor-pointer"
                >
                  {view.name}
                </button>
                {(isAdmin || view.createdBy === zero.userID) && (
                  <button
                    type="button"
                    aria-label={`删除视图 ${view.name}`}
                    onClick={() => run(mutators.view.delete({ id: view.id }))}
                    className="cursor-pointer rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 hover:bg-pressed hover:text-fg focus-visible:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
        {actions}
      </div>

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
        <FieldFilters
          fields={fields}
          members={members}
          value={filter.fields ?? []}
          onChange={(next) => change({ ...filter, fields: next.length > 0 ? next : undefined })}
        />
        {!empty && (
          <>
            <Button variant="ghost" onClick={() => change({})}>
              清空
            </Button>
            <form className="ml-auto flex items-center gap-2" onSubmit={save}>
              <Input name="name" aria-label="视图名称" placeholder="视图名称" className="w-36" />
              <Button type="submit" variant="outline">
                <Bookmark />
                保存为视图
              </Button>
            </form>
          </>
        )}
      </div>
      {error && <p className="text-sm text-danger-600">{error}</p>}
    </div>
  );
}

type FieldFilter = NonNullable<WorkItemFilterArgs["fields"]>[number];

/** 各字段类型用哪种筛选：属于某些值、范围、包含文字。 */
const FILTER_OP: Record<string, FieldFilter["op"] | undefined> = {
  select: "in",
  multiSelect: "in",
  bool: "in",
  user: "in",
  number: "range",
  date: "range",
  text: "contains",
  link: "contains",
};

/** 字段筛选：已加的条件显示成标签，点“字段筛选”再加一个。 */
function FieldFilters({
  fields,
  members,
  value,
  onChange,
}: {
  fields: readonly FieldConfig[];
  members: readonly Option[];
  value: readonly FieldFilter[];
  onChange: (next: FieldFilter[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [values, setValues] = useState<string[]>([]);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [text, setText] = useState("");
  const field = fields.find((f) => f.key === key) ?? fields[0];
  if (fields.length === 0 && value.length === 0) return null;

  const choices = (f: FieldConfig) =>
    f.dataType === "bool"
      ? [
          { value: "true", label: "是" },
          { value: "false", label: "否" },
        ]
      : f.dataType === "user"
        ? members.map((m) => ({ value: m.id, label: m.name }))
        : (f.options ?? []);
  const describe = (filter: FieldFilter) => {
    const f = fields.find((x) => x.key === filter.field);
    const name = f?.name ?? filter.field;
    if (filter.op === "in")
      return `${name}：${filter.values.map((v) => (f ? choices(f).find((c) => c.value === v)?.label : v) ?? v).join("、")}`;
    if (filter.op === "contains") return `${name}包含“${filter.text}”`;
    if (filter.min !== undefined && filter.max !== undefined) return `${name}：${filter.min} ~ ${filter.max}`;
    return filter.min !== undefined ? `${name} ≥ ${filter.min}` : `${name} ≤ ${filter.max}`;
  };
  const reset = (nextKey: string) => {
    setKey(nextKey);
    setValues([]);
    setMin("");
    setMax("");
    setText("");
  };
  const build = (): FieldFilter | null => {
    if (!field) return null;
    const op = FILTER_OP[field.dataType];
    if (op === "in") return values.length > 0 ? { field: field.key, op, values } : null;
    if (op === "contains") return text.trim() ? { field: field.key, op, text: text.trim() } : null;
    const bound = (v: string) => (v === "" ? undefined : field.dataType === "number" ? Number(v) : v);
    const range = { field: field.key, op: "range" as const, min: bound(min), max: bound(max) };
    return range.min === undefined && range.max === undefined ? null : range;
  };
  const inputType = field?.dataType === "date" ? "date" : "number";

  return (
    <>
      {value.map((filter, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 条件没有自己的 id，按位置删除
          key={i}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-brand-50 pr-1 pl-2.5 text-sm text-brand-500"
        >
          {describe(filter)}
          <button
            type="button"
            aria-label={`去掉条件 ${describe(filter)}`}
            className="rounded p-0.5 hover:bg-brand-100"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      {fields.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost">
              <SlidersHorizontal />
              字段筛选
            </Button>
          </PopoverTrigger>
          <PopoverContent className="flex w-72 flex-col gap-2 p-3">
            <Select aria-label="筛选字段" value={field?.key ?? ""} onChange={(e) => reset(e.target.value)}>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </Select>
            {field && FILTER_OP[field.dataType] === "in" && (
              <ul aria-label="筛选值" className="flex max-h-48 flex-col overflow-y-auto">
                {choices(field).map((c) => (
                  <li key={c.value}>
                    <label className="flex h-7 items-center gap-2">
                      <Checkbox
                        checked={values.includes(c.value)}
                        onChange={(e) =>
                          setValues(e.target.checked ? [...values, c.value] : values.filter((v) => v !== c.value))
                        }
                      />
                      {c.label}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {field && FILTER_OP[field.dataType] === "range" && (
              <div className="flex items-center gap-1.5">
                <Input aria-label="最小值" type={inputType} value={min} onChange={(e) => setMin(e.target.value)} />
                <span className="text-fg-subtle">~</span>
                <Input aria-label="最大值" type={inputType} value={max} onChange={(e) => setMax(e.target.value)} />
              </div>
            )}
            {field && FILTER_OP[field.dataType] === "contains" && (
              <Input aria-label="包含文字" value={text} onChange={(e) => setText(e.target.value)} />
            )}
            <Button
              size="sm"
              onClick={() => {
                const next = build();
                if (!next) return;
                onChange([...value.filter((f) => f.field !== next.field), next]);
                setOpen(false);
                reset(field?.key ?? "");
              }}
            >
              应用
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
