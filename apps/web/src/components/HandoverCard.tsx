import { Popconfirm, Toast } from "@douyinfe/semi-ui";
import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { ErrorBanner } from "@/components/ui/page";

type Member = { userId: string; name: string; role: string | null };
type Fields = readonly { key: string; dataType: string }[];

/**
 * 工作移交：有人请假、转岗、离职时，管理员把他在进行中的工作项上的角色、未完成节点、
 * 人员字段和未完成的子任务交给另一个人。
 */
export function HandoverCard({
  spaceId,
  members,
  types,
}: {
  spaceId: string;
  members: readonly Member[];
  types: readonly { id: string; fields: Fields }[];
}) {
  const zero = useZero();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [roles, setRoles] = useState(true);
  const [fields, setFields] = useState(true);
  const [tasks, setTasks] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items] = useQuery(queries.workItems.boardBySpace({ spaceId, filter: { statuses: ["inProgress"] } }));
  const name = (id: string) => members.find((m) => m.userId === id)?.name ?? id;

  // 预估：他担任角色的、人员字段里有他的进行中工作项（节点和子任务在服务端一起处理）
  const preview = useMemo(() => {
    if (!from) return null;
    const personFields = new Map(
      types.map((t) => [
        t.id,
        new Set(t.fields.filter((f) => f.dataType === "user" || f.dataType === "singleUser").map((f) => f.key)),
      ]),
    );
    let byRole = 0;
    let byField = 0;
    for (const i of items) {
      if (i.frozen) continue;
      if (i.roleMembers.some((m) => m.userId === from)) byRole++;
      const keys = personFields.get(i.typeId);
      if (
        i.fieldValues.some((v) => {
          if (!keys?.has(v.fieldKey)) return false;
          return Array.isArray(v.value) ? v.value.includes(from) : v.value === from;
        })
      )
        byField++;
    }
    return { byRole, byField };
  }, [from, items, types]);

  async function run() {
    setError(null);
    const { client, server } = zero.mutate(
      mutators.space.handover({ spaceId, fromUserId: from, toUserId: to, roles, fields, tasks }),
    );
    for (const outcome of [await client, await server])
      if (outcome.type === "error") return setError(outcome.error.message);
    Toast.success({ content: `已把 ${name(from)} 的工作移交给 ${name(to)}`, duration: 3 });
    setFrom("");
    setTo("");
  }

  const check = (label: string, value: boolean, set: (v: boolean) => void) => (
    <label className="inline-flex items-center gap-1.5">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
      {label}
    </label>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>工作移交</CardTitle>
        <CardDescription>
          有人请假、转岗或离职时，把他在进行中的工作项上的工作交给另一个人。已完成、已终止、已冻结的工作项不动。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <div className="grid grid-cols-2 gap-4">
          <Field label="移交人">
            <Select aria-label="移交人" value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">选择成员</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="接手人">
            <Select aria-label="接手人" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">选择成员</option>
              {members
                .filter((m) => m.userId !== from && m.role !== "guest")
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-4">
          {check("角色和未完成的节点", roles, setRoles)}
          {check("人员字段", fields, setFields)}
          {check("未完成的子任务", tasks, setTasks)}
        </div>
        {preview && (
          <p className="text-fg-muted">
            {name(from)} 在 {preview.byRole} 个进行中的工作项里担任角色，{preview.byField} 个工作项的人员字段里有他。
          </p>
        )}
        <div>
          <Popconfirm
            title={`把 ${name(from)} 的工作移交给 ${name(to)}？`}
            content="会记在每个工作项的动态里。移交后要换回来，需要再反向移交一次。"
            okText="移交"
            cancelText="取消"
            onConfirm={run}
            disabled={!from || !to || !(roles || fields || tasks)}
          >
            <Button disabled={!from || !to || !(roles || fields || tasks)}>移交</Button>
          </Popconfirm>
        </div>
      </CardContent>
    </Card>
  );
}
