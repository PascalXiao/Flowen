import { nodeFlowOf } from "@fp/engine";
import type { FilterCondArgs, WorkItemFilterArgs } from "@fp/sync";
import { ChevronDown, Filter, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { FieldConfig } from "@/components/FieldInput";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Conds = NonNullable<WorkItemFilterArgs["conds"]>;
type Op = FilterCondArgs["op"];
type Choice = { value: string; label: string };

/** 条件能比较的对象怎么比：选项、文字、数字、日期、节点状态，或者只能判断有没有填。 */
type Kind = "choice" | "text" | "number" | "date" | "nodeState" | "presence";

export interface FilterTarget {
  key: string;
  name: string;
  group: string;
  kind: Kind;
  choices?: Choice[];
  /** 人员：值里可以选「我」。 */
  people?: boolean;
  /** 能不能筛为空 / 不为空。 */
  canEmpty: boolean;
}

export const OP_LABEL: Record<Op, string> = {
  in: "属于",
  notIn: "不属于",
  contains: "包含",
  notContains: "不包含",
  range: "介于",
  empty: "为空",
  notEmpty: "不为空",
  date: "动态时间",
};

const OPS: Record<Kind, Op[]> = {
  choice: ["in", "notIn", "empty", "notEmpty"],
  text: ["contains", "notContains", "empty", "notEmpty"],
  number: ["range", "empty", "notEmpty"],
  date: ["date", "range", "empty", "notEmpty"],
  nodeState: ["in", "notIn"],
  presence: ["notEmpty", "empty"],
};

export const PRESET_LABEL = {
  today: "今天",
  yesterday: "昨天",
  tomorrow: "明天",
  thisWeek: "本周",
  lastWeek: "上周",
  nextWeek: "下周",
  thisMonth: "本月",
  lastMonth: "上月",
  nextMonth: "下月",
  pastDays: "过去 N 天",
  nextDays: "未来 N 天",
  beforeToday: "今天之前",
} as const;

const KIND_OF: Record<string, Kind> = {
  select: "choice",
  radio: "choice",
  multiSelect: "choice",
  cascadeSelect: "choice",
  cascadeMulti: "choice",
  businessLine: "choice",
  bool: "choice",
  user: "choice",
  singleUser: "choice",
  signal: "choice",
  multiSignal: "choice",
  text: "text",
  textarea: "text",
  richText: "text",
  link: "text",
  docLink: "text",
  phone: "text",
  email: "text",
  fieldGroup: "text",
  number: "number",
  vote: "number",
  multiPerson: "number",
  formula: "number",
  date: "date",
  datetime: "date",
  dateRange: "date",
  attachment: "presence",
  relation: "presence",
};

const STATUS_CHOICES: Choice[] = [
  { value: "inProgress", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "terminated", label: "已终止" },
];
const NODE_STATE_CHOICES: Choice[] = [
  { value: "notStarted", label: "未开始" },
  { value: "inProgress", label: "进行中" },
  { value: "completed", label: "已完成" },
];
const NODE_PROPS = [
  ["plannedStart", "节点计划开始", "date"],
  ["plannedEnd", "节点计划完成", "date"],
  ["actualEnd", "节点实际完成", "date"],
  ["state", "节点状态", "nodeState"],
] as const;

/** 能筛的对象：系统属性、角色、节点排期和各类型的字段。 */
export function filterTargets({
  types,
  members,
  stages,
  teams = [],
}: {
  types: readonly {
    id: string;
    name: string;
    definitions: unknown[];
    fields?: readonly FieldConfig[];
    roles?: readonly { key: string; name: string }[];
  }[];
  members: readonly { id: string; name: string }[];
  stages: readonly string[];
  /** 团队（team:<id>）：人员类条件可以选整个团队。 */
  teams?: readonly Choice[];
}): FilterTarget[] {
  const people = [...members.map((m) => ({ value: m.id, label: m.name })), ...teams];
  const sys = (key: string, name: string, kind: Kind, extra: Partial<FilterTarget> = {}): FilterTarget => ({
    key,
    name,
    group: "基本信息",
    kind,
    canEmpty: false,
    ...extra,
  });
  const targets: FilterTarget[] = [
    sys("$name", "名称", "text"),
    ...(types.length > 1
      ? [sys("$type", "类型", "choice", { choices: types.map((t) => ({ value: t.id, label: t.name })) })]
      : []),
    sys("$status", "状态", "choice", { choices: STATUS_CHOICES }),
    sys("$stage", "阶段", "choice", { choices: stages.map((s) => ({ value: s, label: s })), canEmpty: true }),
    sys("$member", "参与人", "choice", { choices: people, people: true, canEmpty: true }),
    sys("$createdBy", "创建人", "choice", { choices: people, people: true }),
    sys("$createdAt", "创建时间", "date"),
    sys("$updatedAt", "更新时间", "date"),
  ];
  const roles = new Map(types.flatMap((t) => (t.roles ?? []).map((r) => [r.key, r.name] as const)));
  for (const [key, name] of roles)
    targets.push({
      key: `$role:${key}`,
      name,
      group: "角色",
      kind: "choice",
      choices: people,
      people: true,
      canEmpty: true,
    });
  const hasNodes = types.some((t) => t.definitions.some((d) => nodeFlowOf(d)));
  if (hasNodes)
    for (const [prop, name, kind] of NODE_PROPS)
      targets.push({
        key: `$node:${prop}:*`,
        name,
        group: "节点排期",
        kind,
        ...(kind === "nodeState" && { choices: NODE_STATE_CHOICES }),
        canEmpty: kind === "date",
      });
  const seen = new Set<string>();
  for (const f of types.flatMap((t) => t.fields ?? [])) {
    const kind = KIND_OF[f.dataType];
    if (!kind || seen.has(f.key)) continue;
    seen.add(f.key);
    const isPeople = f.dataType === "user" || f.dataType === "singleUser";
    targets.push({
      key: f.key,
      name: f.name,
      group: "字段",
      kind,
      canEmpty: true,
      ...(kind === "choice" && {
        choices: isPeople
          ? people
          : f.dataType === "bool"
            ? [
                { value: "true", label: "是" },
                { value: "false", label: "否" },
              ]
            : (f.options ?? []).map((o) => ({ value: o.value, label: o.label ?? o.value })),
        people: isPeople,
      }),
    });
  }
  return targets;
}

/** 节点类条件的目标：$node:<属性>:<节点键>，节点键可以是 *。 */
const targetKey = (field: string) =>
  field.startsWith("$node:") ? `${field.split(":").slice(0, 2).join(":")}:*` : field;

/** 流程里所有节点（同键只列一次），节点条件选具体节点用。 */
export function flowNodes(types: readonly { definitions: unknown[] }[]): Choice[] {
  const nodes = new Map<string, string>();
  for (const t of types)
    for (const d of t.definitions)
      for (const n of nodeFlowOf(d)?.nodes ?? []) if (!nodes.has(n.key)) nodes.set(n.key, n.name);
  return [...nodes].map(([value, label]) => ({ value, label }));
}

/** 条件写成一句话，按钮上的提示和测试用。 */
export function describeCond(c: FilterCondArgs, targets: readonly FilterTarget[], nodes: readonly Choice[]) {
  const t = targets.find((x) => x.key === targetKey(c.field));
  let name = t?.name ?? c.field;
  if (c.field.startsWith("$node:")) {
    const key = c.field.split(":").slice(2).join(":");
    name = `${key === "*" ? "任一节点" : (nodes.find((n) => n.value === key)?.label ?? key)}的${name.replace(/^节点/, "")}`;
  }
  const label = (v: string) => (v === "$me" ? "我" : (t?.choices?.find((x) => x.value === v)?.label ?? v));
  switch (c.op) {
    case "in":
    case "notIn":
      return `${name}${OP_LABEL[c.op]} ${(c.values ?? []).map(label).join("、")}`;
    case "contains":
    case "notContains":
      return `${name}${OP_LABEL[c.op]}“${c.text ?? ""}”`;
    case "empty":
    case "notEmpty":
      return `${name}${OP_LABEL[c.op]}`;
    case "date":
      return `${name}：${c.date ? PRESET_LABEL[c.date.preset].replace("N", String(c.date.n ?? 7)) : ""}`;
    case "range":
      return `${name}：${c.min ?? "不限"} ~ ${c.max ?? "不限"}`;
  }
}

/** 条件填完整了没有（没填完的不提交）。 */
function complete(c: FilterCondArgs) {
  switch (c.op) {
    case "in":
    case "notIn":
      return (c.values?.length ?? 0) > 0;
    case "contains":
    case "notContains":
      return !!c.text?.trim();
    case "range":
      return c.min !== undefined || c.max !== undefined;
    case "date":
      return !!c.date;
    default:
      return true;
  }
}

/**
 * 条件组筛选：按钮打开面板，面板里是若干条件组。组之间按「所有 / 任一」组合，组内的条件也各选「且 / 或」。
 * 每个条件选对象（系统属性、角色、节点排期、字段）、比较方式和值；日期可以选动态时间（本周、过去 N 天…）。
 */
export function FilterConditions({
  targets,
  nodes,
  value,
  onChange,
}: {
  targets: readonly FilterTarget[];
  nodes: readonly Choice[];
  value: Conds | undefined;
  onChange: (next: Conds | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Conds>(value ?? { conj: "and", groups: [] });
  const count = value?.groups.reduce((n, g) => n + g.items.length, 0) ?? 0;
  const first = targets[0];
  const blank = (): FilterCondArgs => ({
    field: first?.key ?? "$name",
    op: OPS[first?.kind ?? "text"][0] ?? "contains",
  });

  const setGroup = (gi: number, next: Conds["groups"][number] | null) =>
    setDraft({
      ...draft,
      groups: next ? draft.groups.map((g, i) => (i === gi ? next : g)) : draft.groups.filter((_, i) => i !== gi),
    });
  const apply = () => {
    const groups = draft.groups
      .map((g) => ({ ...g, items: g.items.filter(complete) }))
      .filter((g) => g.items.length > 0);
    onChange(groups.length > 0 ? { conj: draft.conj, groups } : undefined);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value?.groups.length ? value : { conj: "and", groups: [{ conj: "and", items: [blank()] }] });
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className={cn(count > 0 && "bg-brand-50 text-accent hover:bg-brand-50 hover:text-accent")}
          title={value?.groups.flatMap((g) => g.items.map((c) => describeCond(c, targets, nodes))).join("\n")}
        >
          <Filter />
          {count > 0 ? `筛选 · ${count}` : "筛选"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-[640px] max-w-[calc(100vw-32px)] flex-col gap-3 p-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-fg-muted">符合以下</span>
          <Select
            aria-label="条件组之间"
            className="w-24"
            value={draft.conj}
            onChange={(e) => setDraft({ ...draft, conj: e.target.value as "and" | "or" })}
          >
            <option value="and">所有</option>
            <option value="or">任一</option>
          </Select>
          <span className="text-fg-muted">条件组</span>
        </div>
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          {draft.groups.map((g, gi) => (
            <section
              // biome-ignore lint/suspicious/noArrayIndexKey: 条件组没有自己的 id，按位置编辑
              key={gi}
              aria-label={`条件组 ${gi + 1}`}
              className="flex flex-col gap-2 rounded-lg border border-line-subtle bg-raised/40 p-2"
            >
              <div className="flex items-center gap-2 text-xs text-fg-muted">
                <span>条件组 {gi + 1}，组内满足</span>
                <Select
                  aria-label={`条件组 ${gi + 1} 组内`}
                  className="w-20"
                  value={g.conj}
                  onChange={(e) => setGroup(gi, { ...g, conj: e.target.value as "and" | "or" })}
                >
                  <option value="and">全部</option>
                  <option value="or">任一</option>
                </Select>
                <span className="flex-1" />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`删除条件组 ${gi + 1}`}
                  onClick={() => setGroup(gi, null)}
                >
                  <Trash2 />
                </Button>
              </div>
              {g.items.map((c, ci) => (
                <CondRow
                  // biome-ignore lint/suspicious/noArrayIndexKey: 条件没有自己的 id，按位置编辑
                  key={ci}
                  label={`条件 ${gi + 1}-${ci + 1}`}
                  cond={c}
                  targets={targets}
                  nodes={nodes}
                  onChange={(next) =>
                    setGroup(
                      gi,
                      next
                        ? { ...g, items: g.items.map((x, i) => (i === ci ? next : x)) }
                        : { ...g, items: g.items.filter((_, i) => i !== ci) },
                    )
                  }
                />
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() => setGroup(gi, { ...g, items: [...g.items, blank()] })}
              >
                <Plus />
                添加条件
              </Button>
            </section>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={draft.groups.length >= 10}
            onClick={() => setDraft({ ...draft, groups: [...draft.groups, { conj: "and", items: [blank()] }] })}
          >
            <Plus />
            添加条件组
          </Button>
          <span className="flex-1" />
          {count > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              清空条件
            </Button>
          )}
          <Button size="sm" onClick={apply}>
            应用
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CondRow({
  label,
  cond,
  targets,
  nodes,
  onChange,
}: {
  label: string;
  cond: FilterCondArgs;
  targets: readonly FilterTarget[];
  nodes: readonly Choice[];
  onChange: (next: FilterCondArgs | null) => void;
}) {
  const target = targets.find((t) => t.key === targetKey(cond.field)) ?? targets[0];
  if (!target) return null;
  const ops = OPS[target.kind].filter((o) => target.canEmpty || (o !== "empty" && o !== "notEmpty"));
  const groups = [...new Set(targets.map((t) => t.group))];
  const nodeKey = cond.field.startsWith("$node:") ? cond.field.split(":").slice(2).join(":") : null;
  const pickTarget = (key: string) => {
    const t = targets.find((x) => x.key === key);
    if (!t) return;
    const op = OPS[t.kind].find((o) => t.canEmpty || (o !== "empty" && o !== "notEmpty")) ?? "in";
    onChange({ field: key, op, ...(op === "date" && { date: { preset: "thisWeek" as const } }) });
  };
  const dateInput = cond.op === "range" && target.kind === "date";

  return (
    // biome-ignore lint/a11y/useSemanticElements: 只是给一行控件起名，fieldset 会带上表单的默认样式
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <Select
        aria-label={`${label} 对象`}
        className="w-36"
        value={target.key}
        onChange={(e) => pickTarget(e.target.value)}
      >
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {targets
              .filter((t) => t.group === g)
              .map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>
      {nodeKey !== null && (
        <Select
          aria-label={`${label} 节点`}
          className="w-28"
          value={nodeKey}
          onChange={(e) =>
            onChange({ ...cond, field: `${cond.field.split(":").slice(0, 2).join(":")}:${e.target.value}` })
          }
        >
          <option value="*">任一节点</option>
          {nodes.map((n) => (
            <option key={n.value} value={n.value}>
              {n.label}
            </option>
          ))}
        </Select>
      )}
      <Select
        aria-label={`${label} 比较`}
        className="w-24"
        value={cond.op}
        onChange={(e) => {
          const op = e.target.value as Op;
          onChange({ field: cond.field, op, ...(op === "date" && { date: { preset: "thisWeek" as const } }) });
        }}
      >
        {ops.map((o) => (
          <option key={o} value={o}>
            {OP_LABEL[o]}
          </option>
        ))}
      </Select>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {(cond.op === "in" || cond.op === "notIn") && (
          <MultiPick
            label={`${label} 值`}
            choices={[
              ...(target.people ? [{ value: "$me", label: "我（当前登录人）" }] : []),
              ...(target.choices ?? []),
            ]}
            value={cond.values ?? []}
            onChange={(values) => onChange({ ...cond, values })}
          />
        )}
        {(cond.op === "contains" || cond.op === "notContains") && (
          <Input
            aria-label={`${label} 文字`}
            className="min-w-0 flex-1"
            value={cond.text ?? ""}
            onChange={(e) => onChange({ ...cond, text: e.target.value })}
          />
        )}
        {cond.op === "range" && (
          <>
            <Input
              aria-label={`${label} 起`}
              type={dateInput ? "date" : "number"}
              className="w-32"
              value={cond.min ?? ""}
              onChange={(e) =>
                onChange({
                  ...cond,
                  min: e.target.value === "" ? undefined : dateInput ? e.target.value : Number(e.target.value),
                })
              }
            />
            <span className="text-fg-subtle">~</span>
            <Input
              aria-label={`${label} 止`}
              type={dateInput ? "date" : "number"}
              className="w-32"
              value={cond.max ?? ""}
              onChange={(e) =>
                onChange({
                  ...cond,
                  max: e.target.value === "" ? undefined : dateInput ? e.target.value : Number(e.target.value),
                })
              }
            />
          </>
        )}
        {cond.op === "date" && (
          <>
            <Select
              aria-label={`${label} 时间`}
              className="w-28"
              value={cond.date?.preset ?? "thisWeek"}
              onChange={(e) =>
                onChange({ ...cond, date: { preset: e.target.value as keyof typeof PRESET_LABEL, n: cond.date?.n } })
              }
            >
              {Object.entries(PRESET_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            {(cond.date?.preset === "pastDays" || cond.date?.preset === "nextDays") && (
              <Input
                aria-label={`${label} 天数`}
                type="number"
                min={1}
                className="w-20"
                value={cond.date.n ?? 7}
                onChange={(e) =>
                  cond.date &&
                  onChange({ ...cond, date: { ...cond.date, n: Math.max(1, Number(e.target.value) || 1) } })
                }
              />
            )}
          </>
        )}
      </div>
      <Button size="icon-sm" variant="ghost" aria-label={`删除${label}`} onClick={() => onChange(null)}>
        <X />
      </Button>
    </div>
  );
}

/** 多选值：按钮上写已选的，点开勾选。 */
export function MultiPick({
  label,
  choices,
  value,
  onChange,
  className,
  placeholder = "请选择",
  placeholderClass = "text-fg-subtle",
}: {
  label: string;
  choices: readonly Choice[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  className?: string;
  placeholder?: string;
  placeholderClass?: string;
}) {
  const [q, setQ] = useState("");
  const names = value.map((v) => choices.find((c) => c.value === v)?.label ?? v);
  const shown = choices.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className={cn(
          "flex h-7 min-w-32 flex-1 cursor-pointer items-center gap-1 rounded-md border border-line bg-surface pr-1.5 pl-2 text-left text-sm hover:border-line-strong",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {names.length > 0 ? names.join("、") : <span className={placeholderClass}>{placeholder}</span>}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
      </PopoverTrigger>
      <PopoverContent className="flex w-60 flex-col gap-1 p-2">
        {choices.length > 8 && (
          <Input aria-label={`${label} 搜索`} placeholder="搜索" value={q} onChange={(e) => setQ(e.target.value)} />
        )}
        <ul aria-label={`${label} 选项`} className="flex max-h-56 flex-col overflow-y-auto">
          {shown.map((c) => (
            <li key={c.value}>
              <Checkbox
                className="h-7 w-full px-1"
                checked={value.includes(c.value)}
                onChange={(e) => onChange(e.target.checked ? [...value, c.value] : value.filter((v) => v !== c.value))}
              >
                {c.label}
              </Checkbox>
            </li>
          ))}
          {shown.length === 0 && <li className="px-1 py-1.5 text-fg-subtle text-xs">没有选项</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
