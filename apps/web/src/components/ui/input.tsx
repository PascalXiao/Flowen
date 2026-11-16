import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { popupSurface } from "./popover";

/** 输入类控件共用的外观：28px 高、细描边，聚焦时描边变强调色。 */
export const fieldSurface =
  "rounded-md border border-line bg-surface text-fg text-sm outline-none transition-[border-color,box-shadow] placeholder:text-fg-subtle hover:border-fg-disabled focus:border-accent focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-raised disabled:text-fg-disabled disabled:hover:border-line";

/** 输入框：原生 input。 */
export function Input({ className, ...props }: Omit<React.ComponentProps<"input">, "size" | "prefix">) {
  return <input className={cn(fieldSurface, "h-7 w-full min-w-0 px-2 read-only:bg-raised", className)} {...props} />;
}

/** 多行输入框：原生 textarea，至少三行，随内容长高。 */
export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        fieldSurface,
        "field-sizing-content block min-h-[4.75rem] w-full min-w-0 resize-y px-2 py-1.5 read-only:bg-raised",
        className,
      )}
      {...props}
    />
  );
}

/** 外层 Label / Field 的文字：下拉框不是原生表单控件，包在 label 里也取不到名字，要自己带上。 */
const LabelText = React.createContext<string | undefined>(undefined);

/** 取 children 里直接写的文字（不进到子元素里）。 */
function ownText(children: React.ReactNode): string | undefined {
  const text = React.Children.toArray(children)
    .filter((c): c is string | number => typeof c === "string" || typeof c === "number")
    .join("")
    .trim();
  return text || undefined;
}

type OptionNode = { value: string; label: React.ReactNode; disabled?: boolean };
type GroupNode = { label: string; options: OptionNode[] };

/** 把写在 Select 里的 <option>、<optgroup> 读成选项。 */
function readOptions(children: React.ReactNode): (OptionNode | GroupNode)[] {
  const out: (OptionNode | GroupNode)[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as { value?: unknown; children?: React.ReactNode; label?: string; disabled?: boolean };
    if (child.type === "optgroup")
      out.push({ label: props.label ?? "", options: readOptions(props.children) as OptionNode[] });
    else if (child.type === "option")
      out.push({
        value: String(props.value ?? ownText(props.children) ?? ""),
        label: props.children,
        ...(props.disabled && { disabled: true }),
      });
    else if (child.type === React.Fragment) out.push(...readOptions(props.children));
  });
  return out;
}

/** Radix 的选项值不能是空字符串，「未选择」这类空值在内部换成这个记号。 */
const EMPTY = "__empty__";
const encode = (value: string) => (value === "" ? EMPTY : value);
const decode = (value: string) => (value === EMPTY ? "" : value);

/**
 * 下拉框。写法和原生 select 一样：里面放 <option>，onChange 收到 { target: { value } }，
 * 有 name 时带一个隐藏输入框，表单提交照常能取到值。选项上带 data-value，测试按值选也能找到。
 */
export function Select({
  className,
  children,
  value,
  defaultValue,
  onChange,
  name,
  disabled,
  required,
  "aria-label": ariaLabel,
  ...rest
}: Omit<React.ComponentProps<"select">, "value" | "defaultValue"> & { value?: string; defaultValue?: string }) {
  const labelText = React.useContext(LabelText);
  const accessibleName = ariaLabel ?? labelText;
  const options = readOptions(children);
  const flat = options.flatMap((o) => ("options" in o ? o.options : [o]));
  const [own, setOwn] = React.useState(defaultValue ?? flat[0]?.value ?? "");
  const current = value ?? own;
  const renderOption = (o: OptionNode) => (
    <RadixSelect.Item
      key={o.value}
      value={encode(o.value)}
      disabled={o.disabled}
      className="relative flex min-h-7 cursor-pointer select-none items-center rounded-md py-1 pr-7 pl-2 outline-none data-[disabled]:cursor-not-allowed data-[highlighted]:bg-hover data-[disabled]:text-fg-disabled"
    >
      <RadixSelect.ItemText>
        <span data-value={o.value}>{o.label}</span>
      </RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className="absolute right-2 text-accent">
        <Check className="size-3.5" />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
  return (
    <span className={cn("inline-flex min-w-0", className)} {...(rest as Record<string, unknown>)}>
      <RadixSelect.Root
        value={encode(current)}
        disabled={disabled}
        onValueChange={(v) => {
          const next = decode(v);
          if (value === undefined) setOwn(next);
          onChange?.({ target: { value: next }, currentTarget: { value: next } } as never);
        }}
      >
        <RadixSelect.Trigger
          aria-label={accessibleName}
          className={cn(
            fieldSurface,
            "flex h-7 w-full min-w-24 cursor-pointer items-center justify-between gap-1 pr-1.5 pl-2 text-left data-[state=open]:border-accent",
          )}
        >
          <span className="min-w-0 truncate">
            <RadixSelect.Value>{flat.find((o) => o.value === current)?.label ?? ""}</RadixSelect.Value>
          </span>
          <RadixSelect.Icon className="shrink-0 text-fg-subtle">
            <ChevronDown className="size-3.5" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={4}
            collisionPadding={8}
            className={cn(
              popupSurface,
              "max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-(--radix-select-trigger-width) overflow-hidden",
            )}
          >
            <RadixSelect.Viewport className="p-1">
              {options.map((o) =>
                "options" in o ? (
                  <RadixSelect.Group key={o.label}>
                    <RadixSelect.Label className="px-2 pt-1.5 pb-1 text-fg-subtle text-xs">{o.label}</RadixSelect.Label>
                    {o.options.map(renderOption)}
                  </RadixSelect.Group>
                ) : (
                  renderOption(o)
                ),
              )}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      {name && <input type="hidden" name={name} value={current} required={required} />}
    </span>
  );
}

export function Label({ className, children, ...props }: React.ComponentProps<"label">) {
  return (
    <LabelText.Provider value={ownText(children)}>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: 控件由调用方通过 htmlFor 或嵌套关联 */}
      <label className={cn("text-fg-muted text-sm", className)} {...props}>
        {children}
      </label>
    </LabelText.Provider>
  );
}

/** 表单项：上面是标签，下面是控件，可选的说明文字。标签包住控件，点标签聚焦控件。 */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Label className={cn("flex flex-col gap-1.5", className)}>
      <span>{label}</span>
      <LabelText.Provider value={typeof label === "string" ? label : undefined}>{children}</LabelText.Provider>
      {hint && <span className="text-fg-subtle text-xs">{hint}</span>}
    </Label>
  );
}
