import {
  type Grantee,
  PERMISSION_OP_LABEL,
  PERMISSION_OPS,
  type PermissionOp,
  type TypePermissions,
  VIEW_LEVEL_LABEL,
  VIEW_LEVELS,
  type ViewLevel,
} from "@fp/sync";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";

const UNSET = "unset";
const OP_DEFAULT: Record<PermissionOp, string> = {
  create: "所有成员",
  terminate: "工作项负责人",
  freeze: "工作项负责人",
  upgrade: "工作项负责人",
};

/**
 * 工作项配置的「权限」页签：
 * 每行一个授权对象（空间成员、用户组、工作项角色），列是查看范围和各项操作。
 * 操作：禁止优先，其次允许，都没设就不能做；一项操作整列都没设时按默认规则。空间管理员不受限制。
 */
export function PermissionsEditor({
  roles,
  groups,
  value,
  canManage,
  onSave,
}: {
  roles: readonly { key: string; name: string }[];
  groups: readonly { id: string; name: string }[];
  value: TypePermissions | null;
  canManage: boolean;
  onSave: (permissions: TypePermissions | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<TypePermissions>(() => value ?? {});
  const [saved, setSaved] = useState(false);
  const rows: { grantee: Grantee; name: string; kind: "members" | "group" | "role" }[] = [
    { grantee: "members", name: "空间成员", kind: "members" },
    ...groups.map((g) => ({ grantee: `group:${g.id}` as Grantee, name: g.name, kind: "group" as const })),
    ...roles.map((r) => ({ grantee: `role:${r.key}` as Grantee, name: `角色：${r.name}`, kind: "role" as const })),
  ];

  const setView = (g: Grantee, level: string) => {
    const view = { ...(draft.view ?? {}) };
    if (level === UNSET) delete view[g];
    else view[g] = level as ViewLevel;
    setDraft({ ...draft, view });
    setSaved(false);
  };
  const setOp = (op: PermissionOp, g: Grantee, rule: string) => {
    const rules = { ...(draft.ops?.[op] ?? {}) };
    if (rule === UNSET) delete rules[g];
    else rules[g] = rule as "allow" | "deny";
    setDraft({ ...draft, ops: { ...(draft.ops ?? {}), [op]: rules } });
    setSaved(false);
  };
  const configured = (op: PermissionOp) => Object.keys(draft.ops?.[op] ?? {}).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-muted">
        查看：每人取所在授权对象里最大的范围；担任角色、创建或关注了工作项的人总能看到它，空间管理员看全部。
        操作：禁止优先，其次允许，都没设就不能做；一项操作整列都没设时按默认规则。空间管理员不受限制。
      </p>
      <div className="overflow-x-auto rounded-lg border border-line-subtle">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-left text-fg-muted">
            <tr>
              <th className="px-3 py-2 font-medium">授权对象</th>
              <th className="px-3 py-2 font-medium">查看工作项</th>
              {PERMISSION_OPS.map((op) => (
                <th key={op} className="px-3 py-2 font-medium">
                  {PERMISSION_OP_LABEL[op]}
                  {!configured(op) && (
                    <span className="block text-xs font-normal text-fg-subtle">默认：{OP_DEFAULT[op]}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {rows.map((row) => (
              <tr key={row.grantee}>
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  {row.name}
                </th>
                <td className="px-3 py-2">
                  {row.kind === "role" ? (
                    <span className="text-fg-subtle">担任即可见</span>
                  ) : (
                    <Select
                      aria-label={`${row.name} 查看工作项`}
                      value={draft.view?.[row.grantee] ?? (row.kind === "members" ? "all" : UNSET)}
                      disabled={!canManage}
                      onChange={(e) => setView(row.grantee, e.target.value)}
                      className="w-28"
                    >
                      {row.kind === "group" && <option value={UNSET}>不设置</option>}
                      {VIEW_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {VIEW_LEVEL_LABEL[l]}
                        </option>
                      ))}
                    </Select>
                  )}
                </td>
                {PERMISSION_OPS.map((op) => (
                  <td key={op} className="px-3 py-2">
                    {row.kind === "role" && op === "create" ? (
                      <span className="text-fg-subtle">—</span>
                    ) : (
                      <Select
                        aria-label={`${row.name} ${PERMISSION_OP_LABEL[op]}`}
                        value={draft.ops?.[op]?.[row.grantee] ?? UNSET}
                        disabled={!canManage}
                        onChange={(e) => setOp(op, row.grantee, e.target.value)}
                        className="w-24"
                      >
                        <option value={UNSET}>不设置</option>
                        <option value="allow">允许</option>
                        <option value="deny">禁止</option>
                      </Select>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && (
        <div className="flex items-center gap-2">
          <Button
            onClick={async () => {
              // 空的操作列去掉，让它回到默认规则
              const ops = Object.fromEntries(
                Object.entries(draft.ops ?? {}).filter(([, rules]) => Object.keys(rules ?? {}).length > 0),
              );
              setSaved(await onSave({ view: draft.view ?? {}, ops }));
            }}
          >
            保存权限
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              if (await onSave(null)) setDraft({});
              setSaved(false);
            }}
          >
            恢复默认
          </Button>
          {saved && <span className="text-sm text-success-600">已保存</span>}
        </div>
      )}
    </div>
  );
}
