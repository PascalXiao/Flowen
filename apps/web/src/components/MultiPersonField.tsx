import { type FieldGroupColumn, PERSON_KEY } from "@fp/engine";
import { Plus, Trash2 } from "lucide-react";
import { FieldInput, type FieldInputValue, type FieldMember } from "@/components/FieldInput";
import { Avatar } from "@/components/ui/avatar";
import { Select } from "@/components/ui/input";

type Row = Record<string, unknown>;

const userOf = (row: Row) => String(row[PERSON_KEY] ?? "");
const hasData = (row: Row) =>
  Object.entries(row).some(([k, v]) => k !== PERSON_KEY && v !== null && v !== undefined && v !== "");

/**
 * 多人复合字段（对照飞书项目的多人复合字段）：每个填写人一行，每人填自己的一组。
 * 填写人来自角色时，角色上的人各一行；自行添加时每人把自己加进来，管理员可以替别人加。
 * 只能改自己的一行，管理员可以改所有行（服务端同样校验）。
 */
export function MultiPersonField({
  field,
  value,
  roleMembers,
  members,
  me,
  isAdmin,
  readOnly,
  label,
  onChange,
}: {
  field: { config?: { columns?: readonly FieldGroupColumn[] | null; people?: { role?: string | null } | null } | null };
  value: unknown;
  /** 填写人来自角色时，这个工作项上该角色的人。 */
  roleMembers: readonly string[] | null;
  members: readonly FieldMember[];
  me: string;
  isAdmin: boolean;
  readOnly: boolean;
  label: string;
  onChange: (value: FieldInputValue) => void;
}) {
  const columns = field.config?.columns ?? [];
  const saved = (Array.isArray(value) ? value : []) as Row[];
  const byRole = roleMembers !== null;
  const rows: Row[] = byRole
    ? roleMembers.map((u) => saved.find((r) => userOf(r) === u) ?? { [PERSON_KEY]: u })
    : saved;
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.name ?? "—";
  const canEdit = (row: Row) => !readOnly && (isAdmin || userOf(row) === me);
  const others = members.filter((m) => !rows.some((r) => userOf(r) === m.userId));
  const canJoin = !readOnly && !byRole && !rows.some((r) => userOf(r) === me);
  const addable = !readOnly && !byRole && isAdmin ? others.filter((m) => m.userId !== me) : [];

  function commit(next: Row[]) {
    // 角色模式下没填的人不用存（名单来自角色）；自行添加时名单本身就是值
    const kept = byRole ? next.filter(hasData) : next;
    onChange((kept.length > 0 ? kept : null) as FieldInputValue);
  }
  const setCell = (user: string, key: string, cell: FieldInputValue) =>
    commit(rows.map((r) => (userOf(r) === user ? { ...r, [key]: cell } : r)));
  const add = (user: string) => commit([...rows, { [PERSON_KEY]: user }]);

  return (
    <div className="overflow-x-auto rounded border border-line">
      <table aria-label={label} className="w-full min-w-max text-sm">
        <thead className="bg-canvas text-fg-muted">
          <tr>
            <th className="w-32 px-2 py-1.5 text-left font-normal">填写人</th>
            {columns.map((c) => (
              <th key={c.key} className="px-2 py-1.5 text-left font-normal">
                {c.name}
              </th>
            ))}
            {!byRole && !readOnly && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 2} className="px-2 py-2 text-fg-subtle">
                {byRole ? "角色上还没有人" : "还没有人填写"}
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const user = userOf(row);
            const name = nameOf(user);
            return (
              <tr key={user} className="border-t border-line">
                <td className="px-2 py-1 align-middle">
                  <span className="inline-flex items-center gap-1.5">
                    <Avatar name={name} size={20} />
                    {name}
                  </span>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className="min-w-32 px-1 py-1 align-top">
                    <FieldInput
                      field={{ key: c.key, name: c.name, dataType: c.dataType, options: c.options ?? null }}
                      value={(row[c.key] ?? null) as FieldInputValue}
                      label={`${label} ${name} ${c.name}`}
                      members={members}
                      readOnly={!canEdit(row)}
                      onChange={(cell) => setCell(user, c.key, cell)}
                    />
                  </td>
                ))}
                {!byRole && !readOnly && (
                  <td className="px-1 py-1 align-top">
                    {canEdit(row) && (
                      <button
                        type="button"
                        aria-label={`移除${label} ${name}`}
                        className="rounded p-1.5 text-fg-subtle hover:bg-canvas hover:text-danger-500"
                        onClick={() => commit(rows.filter((r) => userOf(r) !== user))}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {(canJoin || addable.length > 0) && (
        <div className="flex items-center gap-3 border-t border-line px-2 py-1.5">
          {canJoin && (
            <button type="button" className="flex items-center gap-1 text-brand-500 text-sm" onClick={() => add(me)}>
              <Plus className="size-4" />
              我来填写
            </button>
          )}
          {addable.length > 0 && (
            <Select
              aria-label={`给${label}添加填写人`}
              value=""
              className="w-40"
              onChange={(e) => e.target.value && add(e.target.value)}
            >
              <option value="">添加填写人…</option>
              {addable.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
