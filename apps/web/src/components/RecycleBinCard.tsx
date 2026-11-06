import { Popconfirm, Toast } from "@douyinfe/semi-ui";
import { mutators, queries } from "@fp/sync";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorBanner } from "@/components/ui/page";

const pad = (n: number) => String(n).padStart(2, "0");
const formatTime = (ms: number | null | undefined) => {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * 回收站：空间里删除了的工作项。可以恢复（删除的人、空间管理员），
 * 管理员还可以彻底删除（字段值、节点、评论一起删掉，不能再恢复）。
 */
export function RecycleBinCard({ spaceId, isAdmin }: { spaceId: string; isAdmin: boolean }) {
  const zero = useZero();
  const [items] = useQuery(queries.workItems.recycleBin({ spaceId }));
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const shown = keyword.trim() ? items.filter((i) => i.name.includes(keyword.trim())) : items;

  async function run(request: Parameters<typeof zero.mutate>[0], done: string) {
    setError(null);
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") return setError(outcome.error.message);
    Toast.success({ content: done, duration: 2 });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>回收站</CardTitle>
        <CardDescription>
          删除的工作项在这里，恢复后回到原来的位置，字段、节点、评论都还在。
          {isAdmin ? "你是空间管理员，能看到所有人删除的工作项，也可以彻底删除。" : "你能看到自己删除的工作项。"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {items.length === 0 ? (
          <EmptyState title="回收站是空的" description="删除的工作项会出现在这里。" />
        ) : (
          <>
            <Input
              aria-label="搜索回收站"
              placeholder="搜索名称"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="w-56"
            />
            <table aria-label="回收站" className="w-full text-sm">
              <thead className="text-left text-xs text-fg-muted">
                <tr className="border-b border-line-subtle">
                  <th className="h-9 font-normal">名称</th>
                  <th className="font-normal">类型</th>
                  <th className="font-normal">删除人</th>
                  <th className="font-normal">删除时间</th>
                  <th className="w-40" />
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className="border-b border-line-subtle last:border-0">
                    <td className="h-11 pr-3 font-medium">{i.name}</td>
                    <td className="text-fg-muted">{i.type?.name}</td>
                    <td className="text-fg-muted">{i.deleter?.name ?? "—"}</td>
                    <td className="tabular-nums text-fg-muted">{formatTime(i.deletedAt)}</td>
                    <td className="text-right">
                      <span className="inline-flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`恢复 ${i.name}`}
                          onClick={() => run(mutators.workItem.recover({ workItemId: i.id }), `已恢复「${i.name}」`)}
                        >
                          恢复
                        </Button>
                        {isAdmin && (
                          <Popconfirm
                            title={`彻底删除「${i.name}」？`}
                            content="字段值、节点、评论和附件记录会一起删掉，不能再恢复。"
                            okText="彻底删除"
                            okType="danger"
                            cancelText="取消"
                            onConfirm={() =>
                              run(mutators.workItem.purge({ workItemId: i.id }), `已彻底删除「${i.name}」`)
                            }
                          >
                            <Button size="sm" variant="ghost" aria-label={`彻底删除 ${i.name}`}>
                              彻底删除
                            </Button>
                          </Popconfirm>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
