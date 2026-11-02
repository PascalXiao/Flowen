import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ListDisplay } from "@/components/WorkItemList";
import { allColumns, defaultColumnKeys, type ListField } from "@/lib/list-columns";

type Column = { key: string; title: string };

/**
 * 工作项配置的「列」页签：管理员定好这种工作项列表默认显示哪些列、按什么顺序。
 * 成员打开列表时从这里开始，自己还能在表头的「+」里再调；保存过的视图用自己的列。
 */
export function ColumnsEditor({
  fields,
  sources = {},
  value,
  canManage,
  onSave,
}: {
  fields: readonly ListField[];
  /** 角色列、节点列的来源。 */
  sources?: { roles?: readonly { key: string; name: string }[]; nodes?: readonly { name: string }[] };
  value: ListDisplay | null;
  canManage: boolean;
  onSave: (display: ListDisplay | null) => Promise<boolean>;
}) {
  const fieldMap = new Map(fields.filter((f) => f.dataType !== "relation").map((f) => [f.key, f]));
  const ctx = { fields: fieldMap, userName: (id: string) => id, spaceName: "", typeName: () => "", ...sources };
  const all: Column[] = allColumns(ctx).map((c) => ({ key: c.key, title: c.title }));
  const known = new Set(all.map((c) => c.key));
  const initial = (value?.columns ?? defaultColumnKeys(fieldMap).map((key) => ({ key }))).map((c) => c.key);
  const [keys, setKeys] = useState(() => initial.filter((k) => known.has(k)));
  const [saved, setSaved] = useState(false);
  const title = (key: string) => all.find((c) => c.key === key)?.title ?? key;
  const move = (index: number, by: -1 | 1) => {
    const next = [...keys];
    const [key] = next.splice(index, 1);
    if (key) next.splice(index + by, 0, key);
    setKeys(next);
    setSaved(false);
  };
  const toggle = (key: string, on: boolean) => {
    setKeys(on ? [...keys, key] : keys.filter((k) => k !== key));
    setSaved(false);
  };

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <section aria-label="可选的列" className="flex flex-col gap-1">
        <h3 className="mb-1 text-sm font-medium">可选的列</h3>
        {all.map((c) => (
          <label key={c.key} className="flex h-8 items-center gap-2 rounded px-2 text-sm hover:bg-hover">
            <Checkbox
              aria-label={`显示列 ${c.title}`}
              checked={keys.includes(c.key)}
              disabled={!canManage}
              onChange={(e) => toggle(c.key, e.target.checked)}
            />
            <span className="truncate">{c.title}</span>
          </label>
        ))}
      </section>
      <section aria-label="已显示的列" className="flex flex-col gap-1">
        <h3 className="mb-1 text-sm font-medium">已显示的列（{keys.length}）</h3>
        <p className="mb-1 text-xs text-fg-subtle">「名称」列固定在最左边，不用选。</p>
        <ol className="flex flex-col">
          {keys.map((key, i) => (
            <li key={key} className="flex h-8 items-center gap-1 rounded px-2 text-sm hover:bg-hover">
              <span className="min-w-0 flex-1 truncate">{title(key)}</span>
              {canManage && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`上移列 ${title(key)}`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`下移列 ${title(key)}`}
                    disabled={i === keys.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`不显示列 ${title(key)}`}
                    onClick={() => toggle(key, false)}
                  >
                    <X />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ol>
        {canManage && (
          <div className="mt-3 flex items-center gap-2">
            <Button
              onClick={async () => {
                const ok = await onSave({ ...(value ?? {}), columns: keys.map((key) => ({ key })) });
                setSaved(ok);
              }}
            >
              保存默认列
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (await onSave(null)) setKeys(defaultColumnKeys(fieldMap).filter((k) => known.has(k)));
                setSaved(false);
              }}
            >
              恢复默认
            </Button>
            {saved && <span className="text-sm text-success-600">已保存</span>}
          </div>
        )}
      </section>
    </div>
  );
}
