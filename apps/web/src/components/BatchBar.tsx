import { Popconfirm, Popover, Toast } from "@douyinfe/semi-ui";
import type { FieldDataType } from "@fp/engine";
import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { useState } from "react";
import { type FieldConfig, FieldInput, type FieldInputValue, type FieldMember } from "@/components/FieldInput";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

/** 不能批量改的字段：关联、公式、附件、字段组由各自的地方维护。 */
const NOT_BATCH: readonly FieldDataType[] = ["relation", "formula", "attachment", "fieldGroup"];

interface BatchItem {
  id: string;
  name: string;
  status: string | null;
}

/**
 * 表格勾选后的批量操作栏（对照飞书项目列表的批量操作）：批量修改字段、关注、收藏、终止、恢复。
 * 逐条执行，权限由服务端判断；有失败的条目时提示第一条原因。
 */
export function BatchBar({
  items,
  fields,
  members,
  onClear,
}: {
  items: BatchItem[];
  fields: readonly FieldConfig[];
  members: readonly FieldMember[];
  onClear: () => void;
}) {
  const zero = useZero();
  const editable = fields.filter((f) => !NOT_BATCH.includes(f.dataType as FieldDataType));
  const [fieldKey, setFieldKey] = useState(editable[0]?.key ?? "");
  const [value, setValue] = useState<FieldInputValue | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [reason, setReason] = useState("");
  const field = editable.find((f) => f.key === fieldKey);
  const running = items.filter((i) => i.status !== "terminated");
  const terminated = items.filter((i) => i.status === "terminated");

  /** 逐条执行，等服务端确认；返回成功条数并提示失败原因。 */
  async function each(list: BatchItem[], verb: string, run: (item: BatchItem) => Parameters<typeof zero.mutate>[0]) {
    const results = await Promise.all(
      list.map(async (item) => {
        const { client, server } = zero.mutate(run(item));
        for (const outcome of [await client, await server])
          if (outcome.type === "error") return `${item.name}：${outcome.error.message}`;
        return null;
      }),
    );
    const errors = results.filter((x): x is string => x !== null);
    const done = list.length - errors.length;
    if (errors.length)
      Toast.warning({
        content: `${verb}了 ${done} 项，${errors.length} 项没成功：${errors[0]}${errors.length > 1 ? " 等" : ""}`,
        duration: 4,
      });
    else Toast.success({ content: `已${verb} ${done} 项`, duration: 2 });
    return done;
  }

  const editPanel = (
    <div className="flex w-80 flex-col gap-3 p-3">
      <span className="font-medium">批量修改 {items.length} 项</span>
      <Select
        aria-label="要修改的字段"
        value={fieldKey}
        onChange={(e) => {
          setFieldKey(e.target.value);
          setValue(null);
        }}
      >
        {editable.map((f) => (
          <option key={f.key} value={f.key}>
            {f.name}
          </option>
        ))}
      </Select>
      {field && (
        <FieldInput key={field.key} field={field} value={value} onChange={setValue} members={members} label="改成" />
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setEditOpen(false)}>
          取消
        </Button>
        <Button
          size="sm"
          disabled={!field}
          onClick={async () => {
            if (!field) return;
            setEditOpen(false);
            await each(items, "修改", (item) =>
              mutators.fieldValue.set({ workItemId: item.id, fieldKey: field.key, value: (value ?? null) as never }),
            );
          }}
        >
          应用
        </Button>
      </div>
    </div>
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: 只是给一组按钮起名，fieldset 会带上表单的默认样式
    <div
      role="group"
      aria-label="批量操作"
      className="ml-auto flex items-center gap-1 rounded-md bg-brand-50 px-3 py-1 text-sm"
    >
      <span className="mr-1">已选 {items.length} 项</span>
      {editable.length > 0 && (
        <Popover
          trigger="custom"
          visible={editOpen}
          onClickOutSide={() => setEditOpen(false)}
          position="bottomRight"
          content={editPanel}
        >
          <Button size="sm" variant="ghost" onClick={() => setEditOpen((v) => !v)}>
            修改字段
          </Button>
        </Popover>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => each(items, "关注", (i) => mutators.mark.set({ workItemId: i.id, kind: "follow", on: true }))}
      >
        关注
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => each(items, "收藏", (i) => mutators.mark.set({ workItemId: i.id, kind: "star", on: true }))}
      >
        收藏
      </Button>
      {running.length > 0 && (
        <Popconfirm
          title={`终止 ${running.length} 个工作项？`}
          content={
            <input
              aria-label="终止原因"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="终止原因（选填）"
              className="semi-input-wrapper mt-1 h-8 w-64 rounded-md border border-line px-2"
            />
          }
          okText="终止"
          cancelText="取消"
          okType="danger"
          onConfirm={async () => {
            const text = reason.trim();
            await each(running, "终止", (i) =>
              mutators.workItem.terminate({ workItemId: i.id, ...(text ? { reason: text } : {}) }),
            );
            setReason("");
          }}
        >
          <Button size="sm" variant="ghost">
            终止
          </Button>
        </Popconfirm>
      )}
      {terminated.length > 0 && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => each(terminated, "恢复", (i) => mutators.workItem.restore({ workItemId: i.id }))}
        >
          恢复
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onClear}>
        取消选择
      </Button>
    </div>
  );
}
