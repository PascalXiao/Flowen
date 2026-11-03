import { Input as SemiInput, Select as SemiSelect, TextArea as SemiTextArea } from "@douyinfe/semi-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 输入框（Semi Input）。对外仍是原生 input 的属性：onChange 收到原生事件，name、required 照常进表单。
 * className 加在 Semi 的外层容器上。
 */
export function Input({
  className,
  onChange,
  readOnly,
  ...props
}: Omit<React.ComponentProps<"input">, "size" | "prefix">) {
  return (
    <SemiInput
      {...(props as Record<string, unknown>)}
      // Semi 的只读属性叫 readonly
      readonly={readOnly}
      className={className}
      onChange={(_value, e) => onChange?.(e)}
    />
  );
}

/** 多行输入框（Semi TextArea），onChange 同样收到原生事件。 */
export function Textarea({ className, onChange, readOnly, ...props }: React.ComponentProps<"textarea">) {
  return (
    <SemiTextArea
      {...(props as Record<string, unknown>)}
      readonly={readOnly}
      autosize={{ minRows: 3 }}
      className={className}
      // Semi 把事件类型标成了 MouseEvent，实际收到的是 textarea 的 change 事件
      onChange={(_value, e) => onChange?.(e as unknown as React.ChangeEvent<HTMLTextAreaElement>)}
    />
  );
}

/** 外层 Label / Field 的文字：Semi 的下拉框不是原生表单控件，包在 label 里也取不到名字，要自己带上。 */
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

/** 把写在 Select 里的 <option>、<optgroup> 读成 Semi 的选项。 */
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

/**
 * 下拉框（Semi Select）。写法和原生 select 一样：里面放 <option>，onChange 收到 { target: { value } }，
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
  // Semi 选中后会把 aria-label 改成 "selected"，用 aria-labelledby 指向一段隐藏文字保住名字
  const labelId = React.useId();
  const accessibleName = ariaLabel ?? labelText;
  const options = readOptions(children);
  const flat = options.flatMap((o) => ("options" in o ? o.options : [o]));
  const [own, setOwn] = React.useState(defaultValue ?? flat[0]?.value ?? "");
  const current = value ?? own;
  const renderOption = (o: OptionNode) => (
    <SemiSelect.Option key={o.value} value={o.value} disabled={o.disabled}>
      <span data-value={o.value}>{o.label}</span>
    </SemiSelect.Option>
  );
  return (
    <span className={cn("inline-flex min-w-0", className)} {...(rest as Record<string, unknown>)}>
      <SemiSelect
        aria-labelledby={accessibleName ? labelId : undefined}
        className="w-full min-w-24"
        value={current}
        disabled={disabled}
        onChange={(v) => {
          const next = String(v ?? "");
          if (value === undefined) setOwn(next);
          onChange?.({ target: { value: next }, currentTarget: { value: next } } as never);
        }}
      >
        {options.map((o) =>
          "options" in o ? (
            <SemiSelect.OptGroup key={o.label} label={o.label}>
              {o.options.map(renderOption)}
            </SemiSelect.OptGroup>
          ) : (
            renderOption(o)
          ),
        )}
      </SemiSelect>
      {accessibleName && (
        <span id={labelId} hidden>
          {accessibleName}
        </span>
      )}
      {name && <input type="hidden" name={name} value={current} required={required} />}
    </span>
  );
}

export function Label({ className, children, ...props }: React.ComponentProps<"label">) {
  return (
    <LabelText.Provider value={ownText(children)}>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: 控件由调用方通过 htmlFor 或嵌套关联 */}
      <label className={cn("text-sm text-fg-muted", className)} {...props}>
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
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </Label>
  );
}
