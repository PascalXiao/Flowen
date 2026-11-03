import { Cascader, DatePicker, Radio, RadioGroup } from "@douyinfe/semi-ui";
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
import { useRef, useState } from "react";
import { RichTextEditor } from "@/components/RichText";
import { Input, Select, Textarea } from "@/components/ui/input";
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

/** 级联选项转成 Semi Cascader 的树。 */
function cascadeTree(options: readonly FieldOption[]) {
  type Node = { label: string; value: string; disabled?: boolean; children?: Node[] };
  const nodes = new Map<string, Node>(
    options.map((o) => [o.value, { label: o.label || o.value, value: o.value, ...(o.disabled && { disabled: true }) }]),
  );
  const roots: Node[] = [];
  for (const o of options) {
    const node = nodes.get(o.value);
    const parent = o.parent ? nodes.get(o.parent) : undefined;
    if (!node) continue;
    if (parent) parent.children = [...(parent.children ?? []), node];
    else roots.push(node);
  }
  return roots;
}

/** Cascader 回传的是路径；我们只存最后一级的值。 */
const lastOf = (v: unknown): string => (Array.isArray(v) ? String(v[v.length - 1] ?? "") : String(v));

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
  // Semi 的弹出层默认挂在 body 上；在弹窗里时要挂进弹窗，否则被弹窗的遮罩挡住点不了
  const anchor = useRef<HTMLSpanElement>(null);
  const popupContainer = () => (anchor.current?.closest("[role=dialog]") as HTMLElement | null) ?? document.body;
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
      className="shrink-0 text-fg-subtle hover:text-brand-500"
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
        <RadioGroup
          aria-label={label}
          value={current || undefined}
          disabled={readOnly}
          onChange={(e) => onChange(String(e.target.value))}
          className="flex flex-wrap gap-x-4 gap-y-1"
        >
          {options.map((o) => (
            <Radio key={o.value} value={o.value} disabled={!!o.disabled && o.value !== current}>
              {optionLabel(o)}
            </Radio>
          ))}
        </RadioGroup>
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
        <span ref={anchor} className="contents">
          <Cascader
            aria-label={label}
            getPopupContainer={popupContainer}
            className="w-full"
            treeData={cascadeTree(options)}
            multiple={multiple}
            changeOnSelect={!field.config?.leafOnly}
            disabled={readOnly}
            showClear
            separator=" / "
            placeholder="未选择"
            value={
              multiple
                ? (Array.isArray(value) ? value : []).map((v) => path(String(v)))
                : current
                  ? path(current)
                  : undefined
            }
            onChange={(next) => {
              if (multiple) {
                const list = (Array.isArray(next) ? next : []).map(lastOf).filter(Boolean);
                onChange(list.length > 0 ? list : null);
              } else onChange(next === undefined || next === null ? null : lastOf(next) || null);
            }}
          />
        </span>
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
        <span ref={anchor} className="contents">
          <DatePicker
            aria-label={label}
            getPopupContainer={popupContainer}
            type="dateRange"
            className="w-full"
            density="compact"
            format="yyyy-MM-dd"
            disabled={readOnly}
            value={range}
            onChange={(_date, strings) => {
              const [start, end] = Array.isArray(strings) ? strings : [];
              onChange(start && end ? { start: String(start), end: String(end) } : null);
            }}
          />
        </span>
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
 * 字段组：一张小表，每行按列填（对照飞书项目的字段组）。每改一格就把整张表交出去，
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
          className="flex w-full items-center gap-1 border-t border-line px-2 py-1.5 text-left text-brand-500 text-sm hover:bg-canvas"
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
              <a href={s.url} target="_blank" rel="noreferrer" className="shrink-0 text-brand-500 hover:underline">
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
            <a
              href={`${env.apiUrl}/api/attachments/${f.id}`}
              className="min-w-0 truncate text-brand-500 hover:underline"
            >
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
          <label className="inline-flex w-fit cursor-pointer items-center gap-1 text-brand-500 hover:underline">
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
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-left text-sm",
          "hover:border-brand-300 disabled:cursor-default disabled:bg-canvas disabled:hover:border-line",
        )}
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
                  <Check className={cn("size-3.5 text-brand-500", !on && "invisible")} />
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
