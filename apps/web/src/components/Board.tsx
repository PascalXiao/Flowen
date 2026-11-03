import { Checkbox, Popover } from "@douyinfe/semi-ui";
import { nodeFlowOf, optionLabel, type StatusCategory, statusFlowOf } from "@fp/engine";
import { mutators, queries, type WorkItemFilterArgs } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, LayoutList } from "lucide-react";
import { type DragEvent, type ReactNode, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";
import { StatusTag, Tag } from "@/components/ui/tag";
import type { BoardDisplay } from "@/components/WorkItemList";
import { type ListField, renderFieldValue } from "@/lib/list-columns";
import { cn } from "@/lib/utils";

/** 看板列：状态流按状态分，其余按阶段分。 */
interface Column {
  key: string;
  name: string;
  category?: StatusCategory;
}

const CATEGORY_DOT: Record<StatusCategory, string> = {
  todo: "bg-fg-subtle",
  doing: "bg-brand-500",
  done: "bg-success-500",
  closed: "bg-fg-disabled",
};

const NO_STAGE = "\u0000none";
const OTHER = "\u0000other";
const NO_LANE = "\u0000nolane";

/** 能当泳道的字段类型：单选、多选、人员、布尔。多值的工作项会出现在多条泳道里。 */
const LANE_FIELD_TYPES = ["select", "radio", "multiSelect", "businessLine", "user", "singleUser", "bool"];
/** 卡片上不显示的字段类型。 */
const NO_CARD_TYPES = ["relation", "fieldGroup", "richText", "attachment"];

/**
 * 空间看板。只筛了一个状态流类型时按它的状态分列，卡片可以拖到别的列来流转（按状态流的流转规则校验）；
 * 其余情况按阶段分列，阶段由节点推进，不能拖。
 */
export function Board({
  spaceId,
  filter,
  types,
  fields = [],
  roles = [],
  userName = (id) => id,
  display = {},
  onDisplay,
}: {
  spaceId: string;
  filter: WorkItemFilterArgs;
  types: readonly { id: string; name: string; definitions: readonly unknown[] }[];
  /** 能放到卡片上、能当泳道的字段，和能当泳道的角色。 */
  fields?: readonly ListField[];
  roles?: readonly { key: string; name: string }[];
  userName?: (id: string) => string;
  /** 泳道和卡片字段（记在列表的显示设置里）。 */
  display?: BoardDisplay;
  onDisplay?: (display: BoardDisplay) => void;
}) {
  const zero = useZero();
  const [items] = useQuery(queries.workItems.boardBySpace({ spaceId, filter }));
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [folded, setFolded] = useState<string[]>([]);
  const laneBy = display.lanes ?? null;
  const cardFields = (display.cardFields ?? []).flatMap((k) => fields.find((f) => f.key === k) ?? []);

  const only = filter.typeIds?.length === 1 ? types.find((t) => t.id === filter.typeIds?.[0]) : undefined;
  const statusFlow = only?.definitions.map(statusFlowOf).find((d) => d !== null);
  const isGuest = items[0]?.space?.members[0]?.role === "guest";
  const draggable = statusFlow !== undefined && !isGuest;

  // 列：状态流取状态；否则取各类型流程里的阶段（节点到达时设置的阶段、状态流的状态名），再补上工作项里出现过的
  const columns: Column[] = statusFlow
    ? statusFlow.statuses.map((s) => ({ key: s.key, name: s.name, category: s.category }))
    : [
        ...new Set([
          ...types
            .filter((t) => !filter.typeIds?.length || filter.typeIds.includes(t.id))
            .flatMap((t) =>
              t.definitions.flatMap((d) => [
                ...(nodeFlowOf(d)?.nodes.flatMap((n) => (n.stageOnArrival ? [n.stageOnArrival] : [])) ?? []),
                ...(statusFlowOf(d)?.statuses.map((s) => s.name) ?? []),
              ]),
            ),
          ...items.flatMap((i) => (i.stage ? [i.stage] : [])),
        ]),
      ].map((name) => ({ key: name, name }));
  const columnOf = (item: (typeof items)[number]): string => {
    if (statusFlow) {
      if (item.flowStatus && columns.some((c) => c.key === item.flowStatus)) return item.flowStatus;
      // 旧版本流程的状态键可能不同，按名称对上
      return columns.find((c) => c.name === item.stage)?.key ?? OTHER;
    }
    return item.stage ?? NO_STAGE;
  };
  const extra: Column[] = [];
  if (items.some((i) => columnOf(i) === NO_STAGE)) extra.push({ key: NO_STAGE, name: "未设置阶段" });
  if (items.some((i) => columnOf(i) === OTHER)) extra.push({ key: OTHER, name: "其他" });

  async function move(itemId: string, to: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item || to === OTHER || columnOf(item) === to) return;
    setError(null);
    const { client, server } = zero.mutate(mutators.workItem.transition({ workItemId: itemId, to }));
    for (const outcome of [await client, await server])
      if (outcome.type === "error") return setError(`「${item.name}」${outcome.error.message}`);
  }

  const dropProps = (key: string) =>
    draggable && key !== OTHER
      ? {
          onDragOver: (e: DragEvent) => {
            e.preventDefault();
            setOver(key);
          },
          onDragLeave: () => setOver((current) => (current === key ? null : current)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            setOver(null);
            move(e.dataTransfer.getData("text/plain"), key);
          },
        }
      : {};

  /** 工作项属于哪些泳道。 */
  const fieldOf = (item: (typeof items)[number], key: string) =>
    item.fieldValues.find((v) => v.fieldKey === key)?.value;
  const lanesOf = (item: (typeof items)[number]): string[] => {
    if (!laneBy) return [NO_LANE];
    let keys: string[] = [];
    if (laneBy === "creator") keys = item.createdBy ? [item.createdBy] : [];
    else if (laneBy.startsWith("role:")) {
      const role = laneBy.slice(5);
      keys = [...new Set(item.roleMembers.filter((m) => m.roleKey === role).map((m) => m.userId))];
    } else if (laneBy.startsWith("field:")) {
      const v = fieldOf(item, laneBy.slice(6));
      keys = (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]).map(String);
    }
    return keys.length ? keys : [NO_LANE];
  };
  const laneField = laneBy?.startsWith("field:") ? fields.find((f) => f.key === laneBy.slice(6)) : undefined;
  const laneName = (key: string): string => {
    if (key === NO_LANE) return laneBy === "creator" || laneBy?.startsWith("role:") ? "未分配" : "未填写";
    if (laneBy === "creator" || laneBy?.startsWith("role:")) return userName(key);
    if (!laneField) return key;
    if (laneField.dataType === "bool") return key === "true" ? "是" : "否";
    if (laneField.dataType === "user" || laneField.dataType === "singleUser") return userName(key);
    return String(
      optionLabel(
        { name: laneField.name, dataType: laneField.dataType as never, options: laneField.options, config: null },
        key,
      ),
    );
  };
  // 泳道顺序：选项字段按选项顺序，其余按名称；「未分配 / 未填写」放最后
  const laneKeys = [...new Set(items.flatMap(lanesOf))].sort((a, b) => {
    if (a === NO_LANE) return 1;
    if (b === NO_LANE) return -1;
    const order = laneField?.options?.map((o) => String(o.value)) ?? [];
    if (order.includes(a) && order.includes(b)) return order.indexOf(a) - order.indexOf(b);
    return laneName(a).localeCompare(laneName(b), "zh");
  });
  if (laneKeys.length === 0) laneKeys.push(NO_LANE);

  const laneOptions: [string, string][] = [
    ["", "不分泳道"],
    ["creator", "创建者"],
    ...roles.map((r): [string, string] => [`role:${r.key}`, `角色：${r.name}`]),
    ...fields
      .filter((f) => LANE_FIELD_TYPES.includes(f.dataType))
      .map((f): [string, string] => [`field:${f.key}`, f.name]),
  ];
  const cardOptions = fields.filter((f) => !NO_CARD_TYPES.includes(f.dataType));

  const cardList = (cards: typeof items): ReactNode => (
    <ul className="flex flex-col gap-2">
      {cards.map((item) => {
        const people = [...new Map(item.roleMembers.map((m) => [m.userId, m.user?.name ?? m.userId]))];
        return (
          <li
            key={item.id}
            aria-label={item.name}
            draggable={draggable}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", item.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            className={cn(
              "flex flex-col gap-2 rounded-md border border-line-subtle bg-surface p-3 shadow-card",
              draggable && "cursor-grab active:cursor-grabbing",
            )}
          >
            <Link
              to="/items/$itemId"
              params={{ itemId: item.id }}
              draggable={false}
              className="font-medium hover:text-brand-500"
            >
              {item.name}
            </Link>
            {cardFields.length > 0 && (
              <dl className="flex flex-col gap-1 text-xs">
                {cardFields.map((f) => (
                  <div key={f.key} className="flex min-w-0 items-center gap-2">
                    <dt className="w-20 shrink-0 truncate text-fg-subtle">{f.name}</dt>
                    <dd className="min-w-0 truncate">{renderFieldValue(f, fieldOf(item, f.key), userName)}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="flex items-center gap-1.5">
              {!only && item.type && <Tag>{item.type.name}</Tag>}
              {!statusFlow && <StatusTag status={item.status} />}
              <span className="ml-auto flex -space-x-1.5">
                {people.slice(0, 3).map(([id, name]) => (
                  <span key={id} title={name} className="rounded-full ring-2 ring-surface">
                    <Avatar id={id} name={name} size={20} />
                  </span>
                ))}
                {people.length > 3 && <span className="pl-2.5 text-xs text-fg-subtle">+{people.length - 3}</span>}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );

  const columnsRow = (lane: string) => (
    <div className="flex min-h-[200px] gap-3 overflow-x-auto pb-2">
      {[...columns, ...extra].map((column) => {
        const cards = items.filter((i) => columnOf(i) === column.key && lanesOf(i).includes(lane));
        return (
          <section
            key={column.key}
            aria-label={`${column.name}列`}
            className={cn(
              "flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-canvas p-2",
              over === column.key && "ring-2 ring-brand-300",
            )}
            {...dropProps(column.key)}
          >
            <header className="flex h-7 items-center gap-2 px-1.5 text-sm">
              {column.category && <span className={cn("size-2 rounded-full", CATEGORY_DOT[column.category])} />}
              <span className="font-medium">{column.name}</span>
              <span className="text-fg-subtle">{cards.length}</span>
            </header>
            {cardList(cards)}
          </section>
        );
      })}
      {columns.length + extra.length === 0 && <p className="text-sm text-fg-subtle">还没有工作项。</p>}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-col gap-3 p-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="flex flex-wrap items-center gap-3">
        {!statusFlow && (
          <p className="text-xs text-fg-subtle">按阶段分列。只看一个状态流类型时按状态分列，可以拖动卡片流转。</p>
        )}
        {onDisplay && (
          <div className="ml-auto flex items-center gap-2">
            <Select
              aria-label="泳道"
              className="w-44"
              value={laneBy ?? ""}
              onChange={(e) => onDisplay({ ...display, lanes: e.target.value || null })}
            >
              {laneOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Popover
              trigger="click"
              position="bottomRight"
              content={
                <fieldset
                  aria-label="卡片字段"
                  className="m-0 flex max-h-80 w-56 min-w-0 flex-col gap-1 overflow-y-auto border-0 p-2"
                >
                  <span className="px-1 text-xs text-fg-subtle">卡片上显示的字段（最多 8 个）</span>
                  {cardOptions.map((f) => {
                    const on = display.cardFields?.includes(f.key) ?? false;
                    return (
                      <Checkbox
                        key={f.key}
                        checked={on}
                        disabled={!on && (display.cardFields?.length ?? 0) >= 8}
                        onChange={() =>
                          onDisplay({
                            ...display,
                            cardFields: on
                              ? (display.cardFields ?? []).filter((k) => k !== f.key)
                              : [...(display.cardFields ?? []), f.key],
                          })
                        }
                      >
                        {f.name}
                      </Checkbox>
                    );
                  })}
                </fieldset>
              }
            >
              <Button size="sm" variant="ghost">
                <LayoutList />
                卡片字段{cardFields.length ? ` ${cardFields.length}` : ""}
              </Button>
            </Popover>
          </div>
        )}
      </div>
      {laneBy
        ? laneKeys.map((lane) => {
            const open = !folded.includes(lane);
            const count = items.filter((i) => lanesOf(i).includes(lane)).length;
            return (
              <section key={lane} aria-label={`泳道 ${laneName(lane)}`} className="flex flex-col gap-2">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setFolded((f) => (open ? [...f, lane] : f.filter((x) => x !== lane)))}
                  className="flex h-8 cursor-pointer items-center gap-1.5 self-start rounded px-1 text-sm font-medium hover:bg-hover"
                >
                  {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  {laneName(lane)}
                  <span className="font-normal text-fg-subtle">{count}</span>
                </button>
                {open && columnsRow(lane)}
              </section>
            );
          })
        : columnsRow(NO_LANE)}
    </div>
  );
}
