import { Popconfirm } from "@douyinfe/semi-ui";
import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { type FormEvent, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn, newId } from "@/lib/utils";

interface CommentRow {
  id: string;
  body: string;
  authorId: string;
  mentions: readonly string[] | null;
  parentId: string | null;
  createdAt: number | null;
  editedAt: number | null;
  deletedAt: number | null;
  author?: { name: string } | null;
  replyTo?: { name: string } | null;
}

type Member = { userId: string; name: string };

/** 一条评论下面的楼：一级评论和挂在它下面的回复。 */
interface Thread {
  root: CommentRow;
  replies: CommentRow[];
}

/** 按楼分组；删掉的回复不显示，删掉的一级评论只在楼里还有回复时留一个占位。 */
export function threadsOf(comments: readonly CommentRow[]): Thread[] {
  const replies = new Map<string, CommentRow[]>();
  for (const c of comments)
    if (c.parentId && c.deletedAt == null) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
  return comments
    .filter((c) => !c.parentId)
    .map((root) => ({ root, replies: replies.get(root.id) ?? [] }))
    .filter((t) => t.root.deletedAt == null || t.replies.length > 0);
}

/** 没删除的评论条数（评论页签上的数字）。 */
export const liveCommentCount = (comments: readonly { deletedAt: number | null }[]) =>
  comments.filter((c) => c.deletedAt == null).length;

/** 写评论的输入框和提及按钮：发表评论、回复、编辑共用。 */
function Composer({
  label,
  placeholder,
  submitLabel,
  others,
  initial,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  others: Member[];
  initial?: { body: string; mentions: readonly string[] };
  autoFocus?: boolean;
  onSubmit: (body: string, mentions: string[]) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initial?.body ?? "");
  const [mentions, setMentions] = useState<string[]>([...(initial?.mentions ?? [])]);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const failed = await onSubmit(body, mentions);
    if (failed) return setError(failed);
    setBody("");
    setMentions([]);
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <Textarea
        aria-label={label}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={onCancel ? 2 : 3}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      <div className="flex items-start gap-2">
        {others.length > 0 && (
          <div className="flex flex-1 flex-wrap items-center gap-1">
            <span className="text-xs text-fg-subtle">提及</span>
            {others.map((m) => {
              const on = mentions.includes(m.userId);
              return (
                <button
                  key={m.userId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setMentions((prev) => (on ? prev.filter((u) => u !== m.userId) : [...prev, m.userId]))}
                  className={cn(
                    "h-6 cursor-pointer rounded-md px-1.5 text-xs transition-colors",
                    on ? "bg-brand-100 text-brand-600" : "text-fg-muted hover:bg-hover",
                  )}
                >
                  @{m.name}
                </button>
              );
            })}
          </div>
        )}
        <div className="ml-auto flex gap-2">
          {onCancel && (
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              取消
            </Button>
          )}
          <Button type="submit" size="sm" disabled={!body.trim()}>
            {submitLabel}
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-danger-600">{error}</p>}
    </form>
  );
}

/**
 * 工作项评论（放在详情页“评论”页签里）：
 * 一级评论按时间排列，下面是楼中楼回复；可以提及空间成员、回复、编辑和删除自己的评论（管理员能删任何评论）。
 */
export function CommentsCard({
  workItemId,
  comments,
  members,
  isAdmin = false,
}: {
  workItemId: string;
  comments: readonly CommentRow[];
  members: Member[];
  isAdmin?: boolean;
}) {
  const zero = useZero();
  const me = String(zero.userID);
  const others = members.filter((m) => m.userId !== me);
  /** 正在回复的评论（回复框出现在它所在的楼下面）和正在编辑的评论。 */
  const [replying, setReplying] = useState<CommentRow | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const threads = threadsOf(comments);

  async function run(request: Parameters<typeof zero.mutate>[0]): Promise<string | null> {
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server]) if (outcome.type === "error") return outcome.error.message;
    return null;
  }

  async function remove(id: string) {
    setError(await run(mutators.comment.delete({ id })));
  }

  function entry(c: CommentRow, reply: boolean) {
    const time = c.createdAt ? new Date(c.createdAt).toLocaleString("zh-CN") : "";
    if (c.deletedAt != null)
      return (
        <div key={c.id} className="flex gap-2.5 text-fg-subtle">
          <span className="size-7 shrink-0" />
          <p className="italic">该评论已删除</p>
        </div>
      );
    const mine = c.authorId === me;
    return (
      <article
        key={c.id}
        aria-label={`${c.author?.name ?? "—"}的${reply ? "回复" : "评论"}`}
        className="group flex gap-2.5"
      >
        <Avatar name={c.author?.name ?? "?"} size={reply ? 24 : 28} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span className="font-medium">{c.author?.name ?? "—"}</span>
            {reply && c.replyTo && (
              <span className="text-fg-muted">
                回复 <span className="font-medium text-fg">{c.replyTo.name}</span>
              </span>
            )}
            <span className="text-xs text-fg-subtle">{time}</span>
            {c.editedAt != null && <span className="text-xs text-fg-subtle">（已编辑）</span>}
          </div>
          {editing === c.id ? (
            <Composer
              label="编辑评论"
              placeholder="写评论…"
              submitLabel="保存"
              others={others}
              initial={{ body: c.body, mentions: c.mentions ?? [] }}
              autoFocus
              onCancel={() => setEditing(null)}
              onSubmit={async (body, mentions) => {
                const failed = await run(mutators.comment.update({ id: c.id, body, mentions }));
                if (!failed) setEditing(null);
                return failed;
              }}
            />
          ) : (
            <p className="break-words whitespace-pre-wrap">{c.body}</p>
          )}
          {editing !== c.id && (
            <div className="flex gap-3 text-xs text-fg-subtle opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <button type="button" className="cursor-pointer hover:text-brand-500" onClick={() => setReplying(c)}>
                回复
              </button>
              {mine && (
                <button type="button" className="cursor-pointer hover:text-brand-500" onClick={() => setEditing(c.id)}>
                  编辑
                </button>
              )}
              {(mine || isAdmin) && (
                <Popconfirm
                  title="删除这条评论？"
                  content="删除后不能恢复，楼里的回复会保留。"
                  okText="删除"
                  cancelText="取消"
                  okType="danger"
                  onConfirm={() => remove(c.id)}
                >
                  <button type="button" className="cursor-pointer hover:text-danger-500">
                    删除
                  </button>
                </Popconfirm>
              )}
            </div>
          )}
        </div>
      </article>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {threads.length === 0 && <p className="text-fg-subtle">还没有评论。</p>}
      <ol aria-label="评论列表" className="flex flex-col gap-4">
        {threads.map(({ root, replies }) => {
          const replyHere = replying && (replying.id === root.id || replying.parentId === root.id);
          return (
            <li key={root.id} className="flex flex-col gap-2">
              {entry(root, false)}
              {(replies.length > 0 || replyHere) && (
                <section aria-label="回复" className="ml-[38px] flex flex-col gap-2.5 rounded-md bg-canvas px-3 py-2.5">
                  {replies.map((r) => entry(r, true))}
                  {replyHere && replying && (
                    <Composer
                      key={replying.id}
                      label="回复内容"
                      placeholder={`回复 ${replying.author?.name ?? ""}…`}
                      submitLabel="回复"
                      others={others}
                      autoFocus
                      onCancel={() => setReplying(null)}
                      onSubmit={async (body, mentions) => {
                        const failed = await run(
                          mutators.comment.create({ id: newId(), workItemId, body, mentions, replyTo: replying.id }),
                        );
                        if (!failed) setReplying(null);
                        return failed;
                      }}
                    />
                  )}
                </section>
              )}
            </li>
          );
        })}
      </ol>
      {error && <p className="text-sm text-danger-600">{error}</p>}
      <Composer
        label="评论内容"
        placeholder="写评论…"
        submitLabel="发表评论"
        others={others}
        onSubmit={(body, mentions) => run(mutators.comment.create({ id: newId(), workItemId, body, mentions }))}
      />
    </div>
  );
}
