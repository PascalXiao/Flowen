import { type FieldDataType, nodeFlowOf, statusFlowOf } from "@fp/engine";
import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import {
  ArrowRightLeft,
  Ban,
  CircleFadingArrowUp,
  Eye,
  GitBranchPlus,
  ListMinus,
  ListPlus,
  Pencil,
  RotateCcw,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { type FieldConfig, FieldInput, type FieldInputValue, type FieldMember } from "@/components/FieldInput";
import { MultiPick } from "@/components/FilterConditions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { fieldSurface, Select } from "@/components/ui/input";
import { Popconfirm } from "@/components/ui/popconfirm";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Toast } from "@/components/ui/toast";
import { cn, newId } from "@/lib/utils";

/** 不能批量改的字段：关联、公式、附件、字段组由各自的地方维护。 */
const NOT_BATCH: readonly FieldDataType[] = ["relation", "formula", "attachment", "fieldGroup", "multiPerson", "vote"];

interface BatchItem {
  id: string;
  name: string;
  status: string | null;
  typeId: string;
}

/** 批量同步创建能走的一条关联：哪种工作项（itemTypeId）沿它在另一端新建。 */
export interface BatchLink {
  relationDefId: string;
  side: "from" | "to";
  itemTypeId: string;
  /** 本端的字段名。 */
  name: string;
  /** 另一端的类型（别的空间的带空间名）。 */
  target: string;
}

/**
 * 表格勾选后的批量操作栏：批量修改字段、同步创建、关注、收藏、终止、恢复、删除。
 * 逐条执行，权限由服务端判断；有失败的条目时提示第一条原因。
 */
export function BatchBar({
  items,
  fields,
  members,
  links = [],
  fixedViews = [],
  inView,
  types = [],
  onClear,
}: {
  /** 工作项类型的角色和已发布的流程（批量流转、改角色用）。 */
  types?: readonly {
    id: string;
    roles: readonly { key: string; name: string }[];
    definitions: readonly unknown[];
  }[];
  items: BatchItem[];
  fields: readonly FieldConfig[];
  members: readonly FieldMember[];
  links?: readonly BatchLink[];
  /** 自己能编辑的固定视图：可以把选中的工作项加进去。 */
  fixedViews?: readonly { id: string; name: string }[];
  /** 当前打开的固定视图：可以把选中的移出去。 */
  inView?: { id: string; name: string };
  onClear: () => void;
}) {
  const usable = links.filter((l) => items.some((i) => i.typeId === l.itemTypeId));
  const linkKey = (l: BatchLink) => `${l.relationDefId}|${l.side}`;
  const [syncKey, setSyncKey] = useState("");
  const [syncOpen, setSyncOpen] = useState(false);
  const [copyFields, setCopyFields] = useState(true);
  const link = usable.find((l) => linkKey(l) === syncKey) ?? usable[0];
  const syncItems = link ? items.filter((i) => i.typeId === link.itemTypeId) : [];
  const zero = useZero();
  const editable = fields.filter((f) => !NOT_BATCH.includes(f.dataType as FieldDataType));
  const [fieldKey, setFieldKey] = useState(editable[0]?.key ?? "");
  const [value, setValue] = useState<FieldInputValue | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [reason, setReason] = useState("");
  const field = editable.find((f) => f.key === fieldKey);
  const running = items.filter((i) => i.status !== "terminated");
  const terminated = items.filter((i) => i.status === "terminated");

  /** 一次提交的操作（如加入视图）：成功提示，失败报原因。 */
  async function once(verb: string, request: Parameters<typeof zero.mutate>[0]) {
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") {
        Toast.warning({ content: `${verb}没成功：${outcome.error.message}`, duration: 4 });
        return;
      }
    Toast.success({ content: `已${verb} ${items.length} 项`, duration: 2 });
  }

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

  const syncPanel = link && (
    <div className="flex w-80 flex-col gap-3 p-3">
      <span className="font-medium">批量同步创建</span>
      <p className="text-xs text-fg-muted">
        为每个工作项在关联的另一端新建一个同名工作项并关联上，跨空间关联就建在对方空间里。
      </p>
      <Select aria-label="沿哪个关联新建" value={linkKey(link)} onChange={(e) => setSyncKey(e.target.value)}>
        {usable.map((l) => (
          <option key={linkKey(l)} value={linkKey(l)}>
            {l.name} → {l.target}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox aria-label="带上同名字段" checked={copyFields} onChange={(e) => setCopyFields(e.target.checked)} />
        带上同名字段的值
      </label>
      {syncItems.length < items.length && (
        <p className="text-xs text-fg-subtle">选中的工作项里有 {syncItems.length} 项能用这个关联，其余跳过。</p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setSyncOpen(false)}>
          取消
        </Button>
        <Button
          size="sm"
          disabled={syncItems.length === 0}
          onClick={async () => {
            setSyncOpen(false);
            await each(syncItems, "同步创建", (item) =>
              mutators.relation.createItem({
                id: newId(),
                relationId: newId(),
                relationDefId: link.relationDefId,
                itemId: item.id,
                side: link.side,
                name: item.name,
                copyFields,
              }),
            );
          }}
        >
          创建 {syncItems.length} 项
        </Button>
      </div>
    </div>
  );

  // 批量流转：状态流选目标状态，节点流选要完成的节点；不适用的条目由服务端拒绝并提示
  const chosenTypes = types.filter((t) => items.some((i) => i.typeId === t.id));
  const statusTargets = [
    ...new Map(
      chosenTypes.flatMap((t) =>
        t.definitions.flatMap((d) => statusFlowOf(d)?.statuses.map((x) => [x.key, x.name] as const) ?? []),
      ),
    ),
  ];
  const nodeTargets = [
    ...new Map(
      chosenTypes.flatMap((t) =>
        t.definitions.flatMap((d) => nodeFlowOf(d)?.nodes.map((n) => [n.key, n.name] as const) ?? []),
      ),
    ),
  ];
  const flowTargets = [
    ...statusTargets.map(([k, n]) => ({ value: `status:${k}`, label: `流转到「${n}」` })),
    ...nodeTargets.map(([k, n]) => ({ value: `node:${k}`, label: `完成节点「${n}」` })),
  ];
  const [flowTarget, setFlowTarget] = useState("");
  const [flowOpen, setFlowOpen] = useState(false);
  const roles = [...new Map(chosenTypes.flatMap((t) => t.roles.map((r) => [r.key, r.name] as const)))];
  const [roleKey, setRoleKey] = useState("");
  const [roleMode, setRoleMode] = useState<"add" | "remove" | "set">("add");
  const [roleUsers, setRoleUsers] = useState<string[]>([]);
  const [roleOpen, setRoleOpen] = useState(false);

  const flowPanel = (
    <div className="flex w-80 flex-col gap-3 p-3">
      <span className="font-medium">批量流转 {running.length} 项</span>
      <p className="text-xs text-fg-muted">
        状态流的工作项流转到选中的状态；节点流的完成选中的节点。走不了的会提示原因。
      </p>
      <Select
        aria-label="流转到"
        value={flowTarget || flowTargets[0]?.value || ""}
        onChange={(e) => setFlowTarget(e.target.value)}
      >
        {flowTargets.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </Select>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setFlowOpen(false)}>
          取消
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            const target = flowTarget || flowTargets[0]?.value || "";
            const [kind, ...rest] = target.split(":");
            const key = rest.join(":");
            setFlowOpen(false);
            await each(running, "流转", (i) =>
              kind === "status"
                ? mutators.workItem.transition({ workItemId: i.id, to: key })
                : mutators.node.confirm({ workItemId: i.id, nodeKey: key }),
            );
          }}
        >
          流转
        </Button>
      </div>
    </div>
  );

  const rolePanel = (
    <div className="flex w-80 flex-col gap-3 p-3">
      <span className="font-medium">批量修改角色 {items.length} 项</span>
      <div className="flex gap-2">
        <Select aria-label="角色" value={roleKey || roles[0]?.[0] || ""} onChange={(e) => setRoleKey(e.target.value)}>
          {roles.map(([k, n]) => (
            <option key={k} value={k}>
              {n}
            </option>
          ))}
        </Select>
        <Select
          aria-label="修改方式"
          className="w-28 shrink-0"
          value={roleMode}
          onChange={(e) => setRoleMode(e.target.value as typeof roleMode)}
        >
          <option value="add">添加</option>
          <option value="remove">移除</option>
          <option value="set">替换为</option>
        </Select>
      </div>
      <MultiPick
        label="角色人员"
        placeholder="选人"
        choices={members.map((m) => ({ value: m.userId, label: m.name }))}
        value={roleUsers}
        onChange={setRoleUsers}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => setRoleOpen(false)}>
          取消
        </Button>
        <Button
          size="sm"
          disabled={roleMode !== "set" && roleUsers.length === 0}
          onClick={async () => {
            const key = roleKey || roles[0]?.[0];
            if (!key) return;
            setRoleOpen(false);
            await each(items, "修改", (i) =>
              roleMode === "set"
                ? mutators.role.set({ workItemId: i.id, roleKey: key, userIds: roleUsers })
                : mutators.role.adjust({
                    workItemId: i.id,
                    roleKey: key,
                    ...(roleMode === "add" ? { add: roleUsers } : { remove: roleUsers }),
                  }),
            );
            setRoleUsers([]);
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
      className="fixed bottom-6 left-[calc(50%+7.125rem)] z-[900] flex h-10 -translate-x-1/2 items-center gap-0.5 rounded-[11px] bg-inverse pr-1.5 pl-3.5 text-sm text-inverse-fg shadow-float"
    >
      <span className="mr-2 font-medium whitespace-nowrap">已选 {items.length} 项</span>
      <span aria-hidden className="mx-1 h-4 w-px bg-inverse-fg/20" />
      {editable.length > 0 && (
        <Popover open={editOpen} onOpenChange={setEditOpen}>
          <PopoverTrigger className={barButton}>
            <Pencil />
            修改字段
          </PopoverTrigger>
          <PopoverContent align="center" side="top" className="p-0">
            {editPanel}
          </PopoverContent>
        </Popover>
      )}
      {flowTargets.length > 0 && running.length > 0 && (
        <Popover open={flowOpen} onOpenChange={setFlowOpen}>
          <PopoverTrigger className={barButton}>
            <ArrowRightLeft />
            流转
          </PopoverTrigger>
          <PopoverContent align="center" side="top" className="p-0">
            {flowPanel}
          </PopoverContent>
        </Popover>
      )}
      {roles.length > 0 && (
        <Popover open={roleOpen} onOpenChange={setRoleOpen}>
          <PopoverTrigger className={barButton}>
            <Users />
            改角色
          </PopoverTrigger>
          <PopoverContent align="center" side="top" className="p-0">
            {rolePanel}
          </PopoverContent>
        </Popover>
      )}
      {running.length > 0 && (
        <Popconfirm
          title={`把 ${running.length} 个工作项升级到流程模板的最新版本？`}
          content="已是最新版本的会提示不用升级；新版本里去掉的节点会从工作项上移除。"
          okText="升级"
          cancelText="取消"
          onConfirm={() => each(running, "升级", (i) => mutators.node.upgrade({ workItemId: i.id }))}
        >
          <button type="button" className={barButton}>
            <CircleFadingArrowUp />
            升级模板
          </button>
        </Popconfirm>
      )}
      {syncPanel && (
        <Popover open={syncOpen} onOpenChange={setSyncOpen}>
          <PopoverTrigger className={barButton}>
            <GitBranchPlus />
            同步创建
          </PopoverTrigger>
          <PopoverContent align="center" side="top" className="p-0">
            {syncPanel}
          </PopoverContent>
        </Popover>
      )}
      {fixedViews.length > 0 && (
        <Popover>
          <PopoverTrigger className={barButton}>
            <ListPlus />
            加入视图
          </PopoverTrigger>
          <PopoverContent align="center" side="top" className="flex w-56 flex-col p-1">
            <span className="px-2 pt-1.5 pb-1 text-fg-subtle text-xs">加入固定视图</span>
            {fixedViews.map((v) => (
              <button
                key={v.id}
                type="button"
                className="flex h-7 cursor-pointer items-center rounded-md px-2 text-left hover:bg-hover"
                onClick={() =>
                  once(`加入「${v.name}」`, mutators.view.addItems({ id: v.id, itemIds: items.map((i) => i.id) }))
                }
              >
                {v.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
      {inView && (
        <button
          type="button"
          className={barButton}
          onClick={async () => {
            await once(
              `移出「${inView.name}」`,
              mutators.view.removeItems({ id: inView.id, itemIds: items.map((i) => i.id) }),
            );
            onClear();
          }}
        >
          <ListMinus />
          移出视图
        </button>
      )}
      <button
        type="button"
        className={barButton}
        onClick={() => each(items, "关注", (i) => mutators.mark.set({ workItemId: i.id, kind: "follow", on: true }))}
      >
        <Eye />
        关注
      </button>
      <button
        type="button"
        className={barButton}
        onClick={() => each(items, "收藏", (i) => mutators.mark.set({ workItemId: i.id, kind: "star", on: true }))}
      >
        <Star />
        收藏
      </button>
      {running.length > 0 && (
        <Popconfirm
          title={`终止 ${running.length} 个工作项？`}
          content={
            <input
              aria-label="终止原因"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="终止原因（选填）"
              className={cn(fieldSurface, "mt-1 h-7 w-64 px-2")}
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
          <button type="button" className={barButton}>
            <Ban />
            终止
          </button>
        </Popconfirm>
      )}
      {terminated.length > 0 && (
        <button
          type="button"
          className={barButton}
          onClick={() => each(terminated, "恢复", (i) => mutators.workItem.restore({ workItemId: i.id }))}
        >
          <RotateCcw />
          恢复
        </button>
      )}
      <Popconfirm
        title={`删除 ${items.length} 个工作项？`}
        content="删除后放进回收站，删除的人和空间管理员可以在「空间配置 → 回收站」里恢复。"
        okText="删除"
        okType="danger"
        cancelText="取消"
        onConfirm={async () => {
          await each(items, "删除", (i) => mutators.workItem.delete({ workItemId: i.id }));
          onClear();
        }}
      >
        <button type="button" className={barButton}>
          <Trash2 />
          删除
        </button>
      </Popconfirm>
      <span aria-hidden className="mx-1 h-4 w-px bg-inverse-fg/20" />
      <button
        type="button"
        aria-label="取消选择"
        title="取消选择"
        className={cn(barButton, "px-1.5")}
        onClick={onClear}
      >
        <X />
      </button>
    </div>
  );
}

/** 浮动批量栏里的按钮：反色底上的文字按钮。 */
const barButton =
  "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 font-medium whitespace-nowrap hover:bg-inverse-fg/12 [&_svg]:size-[15px] [&_svg]:opacity-80";
