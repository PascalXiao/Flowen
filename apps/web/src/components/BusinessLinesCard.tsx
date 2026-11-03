import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input, Select } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { newId } from "@/lib/utils";

interface Line {
  id: string;
  name: string;
  parentId: string | null;
  admins: string[];
  disabled: boolean;
}

/** 按树的顺序排好（上级在前，下级紧跟其后），每项带上层级深度。 */
function treeOrder(lines: readonly Line[]): { line: Line; depth: number }[] {
  const out: { line: Line; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const line of lines.filter((l) => (l.parentId ?? null) === parentId)) {
      out.push({ line, depth });
      visit(line.id, depth + 1);
    }
  };
  visit(null, 0);
  // 上级丢了的（不应该出现）放在最后，免得看不见
  for (const line of lines) if (!out.some((o) => o.line.id === line.id)) out.push({ line, depth: 0 });
  return out;
}

/**
 * 空间业务线：一棵树，每条业务线可以设管理员、停用。工作项的「业务线」字段从这里选，
 * 角色的出现和默认成员可以按业务线判断。编辑后点保存一次提交。
 */
export function BusinessLinesCard({
  spaceId,
  lines: saved,
  members,
  canManage,
}: {
  spaceId: string;
  lines: readonly {
    id: string;
    name: string;
    parentId: string | null;
    admins: readonly string[] | null;
    disabled: boolean | null;
  }[];
  members: readonly { userId: string; name: string }[];
  canManage: boolean;
}) {
  const zero = useZero();
  const initial = () =>
    saved.map((l) => ({
      id: l.id,
      name: l.name,
      parentId: l.parentId ?? null,
      admins: [...(l.admins ?? [])],
      disabled: !!l.disabled,
    }));
  const [lines, setLines] = useState<Line[]>(initial);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(lines) !== JSON.stringify(initial());
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const ordered = treeOrder(lines);
  const update = (id: string, patch: Partial<Line>) =>
    setLines(lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const descendants = (id: string): Set<string> => {
    const out = new Set<string>();
    const walk = (p: string) => {
      for (const c of lines.filter((l) => l.parentId === p)) {
        out.add(c.id);
        walk(c.id);
      }
    };
    walk(id);
    return out;
  };
  /** 在同一个上级下面和相邻的兄弟换位置。 */
  const move = (id: string, by: -1 | 1) => {
    const line = lines.find((l) => l.id === id);
    if (!line) return;
    const siblings = lines.filter((l) => l.parentId === line.parentId);
    const target = siblings[siblings.indexOf(line) + by];
    if (!target) return;
    const next = [...lines];
    const a = next.indexOf(line);
    const b = next.indexOf(target);
    next[a] = target;
    next[b] = line;
    setLines(next);
  };

  function add() {
    // 可以一次写一条路径「KIMTRUE/且初」，缺的上级一并建出来
    const parts = draft
      .split("/")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...lines];
    let parentId: string | null = null;
    for (const part of parts) {
      const found = next.find((l) => l.name === part && l.parentId === parentId);
      if (found) {
        parentId = found.id;
        continue;
      }
      const line: Line = { id: newId(), name: part, parentId, admins: [], disabled: false };
      next.push(line);
      parentId = line.id;
    }
    setLines(next);
    setDraft("");
  }

  async function save() {
    setSaving(true);
    setError(null);
    // 按树的顺序提交，顺序就是显示顺序
    const outcome = await zero.mutate(
      mutators.space.setBusinessLines({ spaceId, lines: treeOrder(lines).map((o) => o.line) }),
    ).client;
    setSaving(false);
    if (outcome.type === "error") setError(outcome.error.message);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>业务线</CardTitle>
        <CardDescription>
          工作项的「业务线」字段从这里选；角色的出现和默认成员、字段规则都可以按业务线判断，选上级时下级也算。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <ul aria-label="业务线" className="flex flex-col">
          {ordered.map(({ line, depth }) => (
            <li
              key={line.id}
              className="flex min-h-10 items-center gap-2 border-b border-line-subtle py-1 last:border-0"
              style={{ paddingLeft: depth * 20 }}
            >
              <Input
                aria-label={`业务线 ${line.name} 的名称`}
                value={line.name}
                readOnly={!canManage}
                className="w-44"
                onChange={(e) => update(line.id, { name: e.target.value })}
              />
              <Select
                aria-label={`业务线 ${line.name} 的上级`}
                value={line.parentId ?? ""}
                disabled={!canManage}
                className="w-36"
                onChange={(e) => update(line.id, { parentId: e.target.value || null })}
              >
                <option value="">（第一级）</option>
                {lines
                  .filter((p) => p.id !== line.id && !descendants(line.id).has(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
              <AdminsPicker
                label={line.name}
                value={line.admins}
                members={members}
                names={names}
                readOnly={!canManage}
                onChange={(admins) => update(line.id, { admins })}
              />
              <label className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
                <Checkbox
                  checked={line.disabled}
                  disabled={!canManage}
                  onChange={(e) => update(line.id, { disabled: e.target.checked })}
                />
                停用
              </label>
              {canManage && (
                <span className="ml-auto flex shrink-0 items-center">
                  <IconButton label={`上移 ${line.name}`} onClick={() => move(line.id, -1)}>
                    <ArrowUp />
                  </IconButton>
                  <IconButton label={`下移 ${line.name}`} onClick={() => move(line.id, 1)}>
                    <ArrowDown />
                  </IconButton>
                  <IconButton
                    label={`删除业务线 ${line.name}`}
                    onClick={() => {
                      const gone = new Set([line.id, ...descendants(line.id)]);
                      setLines(lines.filter((l) => !gone.has(l.id)));
                    }}
                  >
                    <Trash2 />
                  </IconButton>
                </span>
              )}
            </li>
          ))}
          {lines.length === 0 && <li className="py-2 text-sm text-fg-subtle">还没有业务线。</li>}
        </ul>
        {canManage && (
          <div className="flex items-center gap-2">
            <Input
              aria-label="新业务线"
              value={draft}
              placeholder="新业务线，可写路径：KIMTRUE/且初"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button variant="outline" onClick={add}>
              <Plus />
              添加业务线
            </Button>
            <Button onClick={save} disabled={!dirty || saving}>
              保存业务线
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded text-fg-subtle hover:bg-hover hover:text-fg [&_svg]:size-3.5"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** 业务线管理员：显示头像，点开勾选空间成员。 */
function AdminsPicker({
  label,
  value,
  members,
  names,
  readOnly,
  onChange,
}: {
  label: string;
  value: readonly string[];
  members: readonly { userId: string; name: string }[];
  names: Map<string, string>;
  readOnly: boolean;
  onChange: (admins: string[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label} 的管理员`}
        disabled={readOnly}
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md px-2 text-left text-sm hover:bg-hover disabled:cursor-default"
      >
        {value.length === 0 ? (
          <span className="text-fg-subtle">设置管理员</span>
        ) : (
          value.map((id) => <Avatar key={id} id={id} name={names.get(id) ?? id} size={20} />)
        )}
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-56 overflow-y-auto">
        <p className="px-2 py-1.5 text-xs text-fg-subtle">{label} 的管理员</p>
        {members.map((m) => {
          const on = value.includes(m.userId);
          return (
            <label key={m.userId} className="flex h-8 cursor-pointer items-center gap-2 rounded px-2 hover:bg-hover">
              <Checkbox
                checked={on}
                onChange={() => onChange(on ? value.filter((v) => v !== m.userId) : [...value, m.userId])}
              />
              <Avatar id={m.userId} name={m.name} size={20} />
              <span className="truncate">{m.name}</span>
            </label>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
