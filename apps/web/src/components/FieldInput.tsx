import {
  applyExclusive,
  type FieldOption,
  type FieldConfig as FieldRules,
  formatFieldValue,
  optionPath,
  SIGNAL_STATE_LABEL,
  type SignalState,
} from "@fp/engine";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  Mail,
  Paperclip,
  Phone,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useState } from "react";
import { RichTextEditor } from "@/components/RichText";
import { fieldSurface, Input, Select, Textarea } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tag, type TagTone } from "@/components/ui/tag";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

/** 字段控件需要的字段定义。 */
export interface FieldConfig {
  key: string;
  name: string;
  dataType: string;
  options: readonly FieldOption[] | null;
  config?: FieldRules | null;
}

/** 控件交给 mutator 的值（JSON 可序列化），由 mutator 按字段类型整理。 */
export type FieldInputValue =
  | string
  | number
  | boolean
  | string[]
  | { start: string; end: string }
  | FieldGroupRow[]
  | null;

/** 字段组的一行：列键 → 单元格的值。 */
export type FieldGroupRow = { [column: string]: string | number | boolean | string[] | null };

export interface FieldMember {
  userId: string;
  name: string;
}

/** 附件字段需要的附件信息。 */
export interface FieldAttachment {
  id: string;
  name: string;
  size: number;
}

/** 字段名：必填时带红色星号，配了帮助说明时旁边有个问号，悬停看说明。 */
export function FieldLabel({
  name,
  required = false,
  description,
}: {
  name: string;
  required?: boolean;
  description?: string | null | undefined;
}) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1">
      <span className="truncate">{name}</span>
      {required && (
        <span aria-hidden className="text-danger-500">
          *
        </span>
      )}
      {description && (
        <span title={description} className="shrink-0 cursor-help text-fg-subtle">
          <CircleHelp aria-label={`${name}的说明：${description}`} className="size-3.5" />
        </span>
      )}
    </span>
  );
}

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * 按字段类型编辑一个字段值。值原样交给 mutator，由它按类型校验、整理成规范形式。
 * live：每次输入都回调（表单里用）；否则文本类输入在失焦时才提交（详情页就地编辑用）。
 * options：此刻可选的选项（按条件过滤过的）；不传时用字段的全部选项。
 */
export function FieldInput({
  field,
  value,
  onChange,
  members = [],
  readOnly = false,
  live = false,
  required = false,
  label = field.name,
  options = field.options ?? [],
  workItemId,
  attachments = [],
}: {
  field: FieldConfig;
  value: unknown;
  onChange: (value: FieldInputValue) => void;
  members?: readonly FieldMember[];
  readOnly?: boolean;
  live?: boolean;
  required?: boolean;
  label?: string;
  options?: readonly FieldOption[];
  /** 附件字段上传到哪个工作项；没有（新建表单里）时不能上传。 */
  workItemId?: string;
  attachments?: readonly FieldAttachment[];
}) {
  const current = text(value);
  const textInput = (type: string, placeholder: string) =>
    live ? (
      <Input
        aria-label={label}
        type={type}
        value={current}
        required={required}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    ) : (
      <Input
        key={current}
        aria-label={label}
        type={type}
        defaultValue={current}
        readOnly={readOnly}
        placeholder={placeholder}
        onBlur={(e) => {
          if (e.target.value !== current) onChange(e.target.value.trim() || null);
        }}
      />
    );
  const display = formatFieldValue(
    { name: field.name, dataType: field.dataType as never, options: field.options, config: field.config ?? null },
    value,
    (id) => members.find((m) => m.userId === id)?.name ?? id,
  );
  const optionLabel = (o: FieldOption) => o.label || o.value;
  const linkOut = (href: string, icon = <ExternalLink className="size-4" />) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`打开${field.name}`}
      className="shrink-0 text-fg-subtle hover:text-accent"
    >
      {icon}
    </a>
  );

  switch (field.dataType) {
    case "select":
    case "bool": {
      const choices =
        field.dataType === "bool"
          ? [
              { value: "true", label: "是" },
              { value: "false", label: "否" },
            ]
          : options.map((o) => ({ value: o.value, label: optionLabel(o) }));
      return (
        <Select
          aria-label={label}
          value={current}
          required={required}
          disabled={readOnly}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === "" ? null : field.dataType === "bool" ? v === "true" : v);
          }}
        >
          <option value="">未选择</option>
          {choices.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    }
    case "radio":
      return (
        <div role="radiogroup" aria-label={label} className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-1">
          {options.map((o) => (
            <label
              key={o.value}
              className="inline-flex cursor-pointer items-center gap-2 text-sm has-disabled:cursor-default"
            >
              <input
                type="radio"
                className="fl-radio"
                name={`${label}-${field.key}`}
                value={o.value}
                checked={current === o.value}
                disabled={readOnly || (!!o.disabled && o.value !== current)}
                onChange={() => onChange(o.value)}
              />
              {optionLabel(o)}
            </label>
          ))}
        </div>
      );
    case "multiSelect":
    case "user": {
      const choices =
        field.dataType === "user"
          ? members.map((m) => ({ value: m.userId, label: m.name }))
          : options.map((o) => ({ value: o.value, label: optionLabel(o) }));
      return (
        <MultiPicker
          label={label}
          options={choices}
          value={Array.isArray(value) ? value.map(String) : []}
          readOnly={readOnly}
          display={display}
          onChange={(next) => {
            // 多选的排他选项：选了它就只留它
            const before = Array.isArray(value) ? value.map(String) : [];
            const kept =
              field.dataType === "multiSelect"
                ? applyExclusive({ ...field, dataType: "multiSelect", config: field.config ?? null }, before, next)
                : next;
            onChange(kept.length > 0 ? kept : null);
          }}
        />
      );
    }
    case "singleUser":
      return (
        <Select
          aria-label={label}
          value={current}
          required={required}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">未选择</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
      );
    case "cascadeSelect":
    case "cascadeMulti":
    case "businessLine": {
      const multiple = field.dataType === "cascadeMulti";
      const all = field.options ?? [];
      const path = (v: string) => optionPath(all, v);
      return (
        <CascadePicker
          label={label}
          options={options}
          multiple={multiple}
          leafOnly={!!field.config?.leafOnly}
          readOnly={readOnly}
          value={multiple ? (Array.isArray(value) ? value.map(String) : []) : current ? [current] : []}
          pathText={(v) =>
            path(v)
              .map((x) => optionLabel(all.find((o) => o.value === x) ?? { value: x, label: x }))
              .join(" / ")
          }
          onChange={(next) => onChange(next.length ? (multiple ? next : (next[0] as string)) : null)}
        />
      );
    }
    case "date":
      return (
        <Input
          aria-label={label}
          type="date"
          value={current}
          required={required}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "datetime":
      return (
        <Input
          aria-label={label}
          type="datetime-local"
          value={current.replace(" ", "T")}
          required={required}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value ? e.target.value.replace("T", " ") : null)}
        />
      );
    case "dateRange": {
      const range = isObject(value) ? [String(value.start), String(value.end)] : undefined;
      return (
        <DateRangeInput
          label={label}
          readOnly={readOnly}
          value={range}
          onChange={(next) => onChange(next ? { start: next[0], end: next[1] } : null)}
        />
      );
    }
    case "number":
      return textInput("number", "未填写");
    case "textarea":
      return live ? (
        <Textarea
          aria-label={label}
          value={current}
          readOnly={readOnly}
          placeholder="未填写"
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Textarea
          key={current}
          aria-label={label}
          defaultValue={current}
          readOnly={readOnly}
          placeholder="未填写"
          onBlur={(e) => {
            if (e.target.value !== current) onChange(e.target.value.trim() ? e.target.value : null);
          }}
        />
      );
    case "richText":
      return (
        <RichTextEditor
          label={label}
          value={current}
          readOnly={readOnly}
          live={live}
          onChange={(html) => onChange(html || null)}
        />
      );
    case "formula":
      return (
        <Input
          aria-label={label}
          title="由公式计算"
          value={formatFieldValue({ name: field.name, dataType: "formula" }, value)}
          placeholder="—"
          readOnly
          className="bg-canvas text-fg-muted"
        />
      );
    case "link":
    case "docLink":
      return (
        <div className="flex items-center gap-1.5">
          {textInput("url", field.dataType === "docLink" ? "云文档链接" : "https://")}
          {current && linkOut(current)}
        </div>
      );
    case "phone":
      return (
        <div className="flex items-center gap-1.5">
          {textInput("tel", "未填写")}
          {current && linkOut(`tel:${current}`, <Phone className="size-4" />)}
        </div>
      );
    case "email":
      return (
        <div className="flex items-center gap-1.5">
          {textInput("email", "未填写")}
          {current && linkOut(`mailto:${current}`, <Mail className="size-4" />)}
        </div>
      );
    case "signal":
    case "multiSignal":
      return <SignalView value={value} label={label} />;
    case "attachment":
      return (
        <AttachmentField
          label={label}
          fieldKey={field.key}
          value={Array.isArray(value) ? value.map(String) : []}
          attachments={attachments}
          workItemId={workItemId}
          readOnly={readOnly}
          onChange={(ids) => onChange(ids.length > 0 ? ids : null)}
        />
      );
    case "fieldGroup":
      return (
        <FieldGroupInput
          field={field}
          value={value}
          onChange={onChange}
          members={members}
          readOnly={readOnly}
          live={live}
          label={label}
        />
      );
    default:
      return textInput("text", "未填写");
  }
}

/**
 * 字段组：一张小表，每行按列填。每改一格就把整张表交出去，
 * 空行由 mutator 去掉；还没填的新行先留在本地。
 */
function FieldGroupInput({
  field,
  value,
  onChange,
  members,
  readOnly,
  live,
  label,
}: {
  field: FieldConfig;
  value: unknown;
  onChange: (value: FieldInputValue) => void;
  members: readonly FieldMember[];
  readOnly: boolean;
  live: boolean;
  label: string;
}) {
  const columns = field.config?.columns ?? [];
  const saved = Array.isArray(value) ? (value as FieldGroupRow[]) : [];
  const [extra, setExtra] = useState(0);
  const rows: FieldGroupRow[] = [...saved, ...Array.from({ length: extra }, () => ({}))];
  const commit = (next: FieldGroupRow[]) => {
    const filled = next.filter((r) => Object.values(r).some((v) => v !== null && v !== undefined && v !== ""));
    setExtra(next.length - filled.length);
    onChange(filled.length > 0 ? filled : null);
  };
  // 列类型都是简单值（没有日期区间、字段组），按单元格的类型收下
  const setCell = (index: number, key: string, cell: FieldInputValue) =>
    commit(rows.map((r, i) => (i === index ? { ...r, [key]: cell as FieldGroupRow[string] } : r)));

  return (
    <div className="overflow-x-auto rounded border border-line">
      <table aria-label={label} className="w-full min-w-max text-sm">
        <thead className="bg-canvas text-fg-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-2 py-1.5 text-left font-normal">
                {c.name}
              </th>
            ))}
            {!readOnly && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="px-2 py-2 text-fg-subtle">
                还没有数据
              </td>
            </tr>
          )}
          {rows.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 行没有自己的 id，按位置编辑
            <tr key={index} className="border-t border-line">
              {columns.map((c) => (
                <td key={c.key} className="min-w-32 px-1 py-1 align-top">
                  <FieldInput
                    field={{ key: c.key, name: c.name, dataType: c.dataType, options: c.options ?? null }}
                    value={row[c.key] ?? null}
                    label={`${label}第 ${index + 1} 行${c.name}`}
                    members={members}
                    readOnly={readOnly}
                    live={live}
                    onChange={(cell) => setCell(index, c.key, cell)}
                  />
                </td>
              ))}
              {!readOnly && (
                <td className="px-1 py-1 align-top">
                  <button
                    type="button"
                    aria-label={`删除${label}第 ${index + 1} 行`}
                    className="rounded p-1.5 text-fg-subtle hover:bg-canvas hover:text-danger-500"
                    onClick={() => commit(rows.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <button
          type="button"
          className="flex w-full items-center gap-1 border-t border-line px-2 py-1.5 text-left text-accent text-sm hover:bg-canvas"
          onClick={() => setExtra((n) => n + 1)}
        >
          <Plus className="size-4" />
          添加一行
        </button>
      )}
    </div>
  );
}

const SIGNAL_TONE: Record<SignalState, TagTone> = {
  none: "neutral",
  pending: "brand",
  passed: "success",
  failed: "danger",
};

/** 系统外信号：外部系统通过开放接口写入，这里只显示状态、说明和链接。 */
function SignalView({ value, label }: { value: unknown; label: string }) {
  const signals = (Array.isArray(value) ? value : value ? [value] : []).filter(isObject);
  if (signals.length === 0)
    return (
      <ul aria-label={label} className="text-sm text-fg-subtle">
        <li>暂无信号</li>
      </ul>
    );
  return (
    <ul aria-label={label} className="flex flex-col gap-1 text-sm">
      {signals.map((s, i) => {
        const state = String(s.state) as SignalState;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 信号没有 id，顺序就是身份
          <li key={i} className="flex min-w-0 items-center gap-1.5">
            <Tag tone={SIGNAL_TONE[state] ?? "neutral"}>{SIGNAL_STATE_LABEL[state] ?? state}</Tag>
            {typeof s.text === "string" && <span className="truncate text-fg-muted">{s.text}</span>}
            {typeof s.url === "string" && (
              <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0 text-accent hover:underline">
                查看
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** 附件字段：上传到工作项（记上字段键），再把附件 id 写进字段值。 */
function AttachmentField({
  label,
  fieldKey,
  value,
  attachments,
  workItemId,
  readOnly,
  onChange,
}: {
  label: string;
  fieldKey: string;
  value: readonly string[];
  attachments: readonly FieldAttachment[];
  workItemId: string | undefined;
  readOnly: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const files = value.map((id) => attachments.find((a) => a.id === id) ?? { id, name: "附件", size: 0 });
  async function upload(list: FileList | null) {
    if (!list?.length || !workItemId) return;
    setBusy(true);
    setError(null);
    const added: string[] = [];
    for (const file of list) {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch(
        `${env.apiUrl}/api/work-items/${workItemId}/attachments?field=${encodeURIComponent(fieldKey)}`,
        { method: "POST", body, credentials: "include" },
      );
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        setError(json.error ?? "上传失败。");
        break;
      }
      added.push(json.id);
    }
    setBusy(false);
    if (added.length > 0) onChange([...value, ...added]);
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <ul aria-label={label} className="flex flex-col gap-0.5">
        {files.map((f) => (
          <li key={f.id} className="flex min-w-0 items-center gap-1.5">
            <Paperclip className="size-3.5 shrink-0 text-fg-subtle" />
            <a href={`${env.apiUrl}/api/attachments/${f.id}`} className="min-w-0 truncate text-accent hover:underline">
              {f.name}
            </a>
            {!readOnly && (
              <button
                type="button"
                aria-label={`移除 ${f.name}`}
                className="shrink-0 text-fg-subtle hover:text-danger-600"
                onClick={() => onChange(value.filter((id) => id !== f.id))}
              >
                <X className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly &&
        (workItemId ? (
          <label className="inline-flex w-fit cursor-pointer items-center gap-1 text-accent hover:underline">
            <Upload className="size-3.5" />
            {busy ? "上传中…" : "上传附件"}
            <input
              type="file"
              multiple
              className="sr-only"
              aria-label={`上传${label}`}
              disabled={busy}
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        ) : (
          <span className="text-xs text-fg-subtle">创建后可以上传附件</span>
        ))}
      {error && <span className="text-xs text-danger-600">{error}</span>}
    </div>
  );
}

/** 多选：点开后勾选，适合多选字段和人员字段。 */
function MultiPicker({
  label,
  options,
  value,
  display,
  readOnly,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: readonly string[];
  display: string;
  readOnly: boolean;
  onChange: (value: string[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        disabled={readOnly}
        className={cn(fieldSurface, "flex h-7 w-full min-w-0 cursor-pointer items-center gap-1 px-2 text-left")}
      >
        <span className={cn("min-w-0 flex-1 truncate", !display && "text-fg-subtle")}>{display || "未选择"}</span>
        <ChevronDown className="size-3.5 shrink-0 text-fg-subtle" />
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-56 overflow-y-auto">
        <ul aria-label={`${label}的选项`}>
          {options.map((o) => {
            const on = value.includes(o.value);
            return (
              <li key={o.value}>
                <button
                  type="button"
                  aria-pressed={on}
                  className="flex h-8 w-full items-center gap-2 rounded px-2 text-left hover:bg-hover"
                  onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
                >
                  <Check className={cn("size-3.5 text-accent", !on && "invisible")} />
                  {o.label}
                </button>
              </li>
            );
          })}
          {options.length === 0 && <li className="px-2 py-1.5 text-fg-subtle">没有可选项。</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * 级联选择：点开后一列一级，点有下级的选项展开下一列。
 * 单选时点中就关（不限只能选末级时，中间级也能选）；多选时每项前面有勾，点了不关。
 */
function CascadePicker({
  label,
  options,
  multiple,
  leafOnly,
  readOnly,
  value,
  pathText,
  onChange,
}: {
  label: string;
  options: readonly FieldOption[];
  multiple: boolean;
  leafOnly: boolean;
  readOnly: boolean;
  value: readonly string[];
  pathText: (value: string) => string;
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  // 展开到的路径：每一级展开的是哪一项
  const [trail, setTrail] = useState<string[]>([]);
  const childrenOf = (parent: string | null) => options.filter((o) => (o.parent ?? null) === parent);
  const hasChildren = (v: string) => options.some((o) => o.parent === v);
  const columns = [childrenOf(null), ...trail.map((v) => childrenOf(v))].filter((c) => c.length > 0);
  const shown = value.map(pathText).join("、");

  function pick(o: FieldOption, level: number) {
    const branch = hasChildren(o.value);
    if (branch) setTrail([...trail.slice(0, level), o.value]);
    if (branch && leafOnly) return;
    if (multiple) onChange(value.includes(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value]);
    else if (!branch) {
      onChange([o.value]);
      setOpen(false);
    } else onChange([o.value]);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // 打开时展开到当前选中项所在的位置
        if (next && value[0]) {
          const path: string[] = [];
          let at = options.find((o) => o.value === value[0])?.parent ?? null;
          while (at) {
            path.unshift(at);
            at = options.find((o) => o.value === at)?.parent ?? null;
          }
          setTrail(path);
        } else if (next) setTrail([]);
      }}
    >
      <div className="relative w-full min-w-0">
        <PopoverTrigger
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          disabled={readOnly}
          className={cn(fieldSurface, "flex h-7 w-full min-w-0 cursor-pointer items-center gap-1 px-2 text-left")}
        >
          <span className={cn("min-w-0 flex-1 truncate", !shown && "text-fg-subtle")}>{shown || "未选择"}</span>
          <ChevronDown
            className={cn("size-3.5 shrink-0 text-fg-subtle", value.length > 0 && !readOnly && "invisible")}
          />
        </PopoverTrigger>
        {value.length > 0 && !readOnly && (
          <button
            type="button"
            aria-label={`清空${label}`}
            onClick={() => onChange([])}
            className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-fg-subtle hover:bg-hover hover:text-fg"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="flex max-w-[90vw] overflow-x-auto p-1">
        {columns.map((col, level) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: 列按层级排，层级就是它的身份
            key={level}
            role="listbox"
            aria-label={`${label}第 ${level + 1} 级`}
            aria-multiselectable={multiple || undefined}
            className="flex max-h-72 w-44 shrink-0 flex-col overflow-y-auto border-line-subtle not-first:border-l not-first:pl-1"
          >
            {col.map((o) => {
              const on = value.includes(o.value);
              const branch = hasChildren(o.value);
              const expanded = trail[level] === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={on}
                  disabled={!!o.disabled && !on}
                  onClick={() => pick(o, level)}
                  className={cn(
                    "flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-hover disabled:cursor-not-allowed disabled:text-fg-disabled",
                    expanded && "bg-hover",
                    on && "font-medium text-accent",
                  )}
                >
                  {multiple && (
                    <input
                      type="checkbox"
                      tabIndex={-1}
                      readOnly
                      checked={on}
                      className="fl-checkbox pointer-events-none"
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{o.label || o.value}</span>
                  {branch ? (
                    <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" />
                  ) : (
                    !multiple && on && <Check className="size-3.5 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
        {columns.length === 0 && <p className="px-2 py-1.5 text-fg-subtle text-sm">没有可选项。</p>}
      </PopoverContent>
    </Popover>
  );
}

/** 日期范围：开始、结束两个日期框，两个都填了才提交。 */
function DateRangeInput({
  label,
  readOnly,
  value,
  onChange,
}: {
  label: string;
  readOnly: boolean;
  value: string[] | undefined;
  onChange: (value: [string, string] | null) => void;
}) {
  const [draft, setDraft] = useState<[string, string]>([value?.[0] ?? "", value?.[1] ?? ""]);
  const [seen, setSeen] = useState(value?.join("~") ?? "");
  // 外面的值变了（别人改了、或者清空了）就跟着变
  const key = value?.join("~") ?? "";
  if (key !== seen) {
    setSeen(key);
    setDraft([value?.[0] ?? "", value?.[1] ?? ""]);
  }
  const set = (i: 0 | 1, v: string) => {
    const next: [string, string] = i === 0 ? [v, draft[1]] : [draft[0], v];
    setDraft(next);
    if (next[0] && next[1]) onChange(next[0] <= next[1] ? next : [next[1], next[0]]);
    else if (!next[0] && !next[1]) onChange(null);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: 只是给两个日期框起个共同的名字，fieldset 会带上表单的默认样式
    <div role="group" aria-label={label} className="flex w-full min-w-0 items-center gap-1.5">
      <Input
        type="date"
        aria-label={`${label}开始`}
        value={draft[0]}
        readOnly={readOnly}
        onChange={(e) => set(0, e.target.value)}
      />
      <span className="shrink-0 text-fg-subtle">~</span>
      <Input
        type="date"
        aria-label={`${label}结束`}
        value={draft[1]}
        readOnly={readOnly}
        onChange={(e) => set(1, e.target.value)}
      />
    </div>
  );
}
