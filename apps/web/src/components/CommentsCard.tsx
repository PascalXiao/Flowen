import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { ArrowDownUp, Hash, X } from "lucide-react";
import { useState } from "react";
import {
  CommentEditor,
  type CommentFile,
  CommentFiles,
  type Member,
  type MentionField,
} from "@/components/CommentEditor";
import { RichTextView } from "@/components/RichText";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Popconfirm } from "@/components/ui/popconfirm";
import { newId } from "@/lib/utils";

interface CommentRow {
  id: string;
  body: string;
  authorId: string;
  mentions: readonly string[] | null;
  parentId: string | null;
  fieldKey?: string | null;
  quote?: string | null;
  createdAt: number | null;
  editedAt: number | null;
  deletedAt: number | null;
  author?: { name: string } | null;
  replyTo?: { name: string } | null;
}

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

/** 每个字段上没删除的评论楼数（字段旁的评论数）。 */
export function fieldCommentCounts(comments: readonly CommentRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of comments)
    if (c.fieldKey && !c.parentId && c.deletedAt == null) counts.set(c.fieldKey, (counts.get(c.fieldKey) ?? 0) + 1);
  return counts;
}

const ORDER_KEY = "fl.comments.order";
function savedOrder(): "asc" | "desc" {
  try {
    return localStorage.getItem(ORDER_KEY) === "desc" ? "desc" : "asc";
  } catch {
    return "asc";
  }
}

/** 正在针对的字段：字段键、名称和引用的当前值。 */
export interface CommentTopic {
  fieldKey: string;
  name: string;
  quote: string;
}

/**
 * 工作项评论（放在详情页“评论”页签里）：
 * 一级评论按时间排列（可切换正序、倒序），下面是楼中楼回复；正文是富文本，可以 @人、@字段、带附件；
 * 可以针对某个字段评论（引用字段当时的值，点击定位到字段）。只能编辑自己的评论，管理员能删任何评论。
 */
export function CommentsCard({
  workItemId,
  comments,
  members,
  fields = [],
  files = [],
  isAdmin = false,
  topic = null,
  onClearTopic,
  fieldFilter = null,
  onClearFieldFilter,
  onLocateField,
}: {
  workItemId: string;
  comments: readonly CommentRow[];
  members: Member[];
  /** 可以 @ 的字段。 */
  fields?: readonly MentionField[];
  /** 工作项上挂在评论下的附件。 */
  files?: readonly CommentFile[];
  isAdmin?: boolean;
  topic?: CommentTopic | null;
  onClearTopic?: () => void;
  /** 只看某个字段上的评论。 */
  fieldFilter?: string | null;
  onClearFieldFilter?: () => void;
  onLocateField?: (fieldKey: string) => void;
}) {
  const zero = useZero();
  const me = String(zero.userID);
  const others = members.filter((m) => m.userId !== me);
  /** 正在回复的评论（回复框出现在它所在的楼下面，带着新回复的 id）和正在编辑的评论。 */
  const [replying, setReplying] = useState<{ to: CommentRow; id: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftId, setDraftId] = useState(newId);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState(savedOrder);
  const fieldName = (key: string) => fields.find((f) => f.key === key)?.name ?? key;
  const filesOf = (commentId: string) => files.filter((f) => f.commentId === commentId);
  let threads = threadsOf(comments);
  if (fieldFilter) threads = threads.filter((t) => t.root.fieldKey === fieldFilter);
  if (order === "desc") threads = [...threads].reverse();

  async function run(request: Parameters<typeof zero.mutate>[0]): Promise<string | null> {
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server]) if (outcome.type === "error") return outcome.error.message;
    return null;
  }

  async function remove(id: string) {
    setError(await run(mutators.comment.delete({ id })));
  }

  function toggleOrder() {
    const next = order === "asc" ? "desc" : "asc";
    setOrder(next);
    try {
      localStorage.setItem(ORDER_KEY, next);
    } catch {
      // 存不了就只在这次生效
    }
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
        <Avatar id={c.authorId} name={c.author?.name ?? "?"} size={reply ? 24 : 28} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
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
          {c.fieldKey && (
            <button
              type="button"
              aria-label={`定位到字段 ${fieldName(c.fieldKey)}`}
              onClick={() => c.fieldKey && onLocateField?.(c.fieldKey)}
              className="flex w-fit max-w-full cursor-pointer items-start gap-1.5 rounded-md border-l-2 border-line bg-canvas px-2 py-1 text-left text-xs hover:border-accent"
            >
              <Hash className="mt-px size-3.5 shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="font-medium">{fieldName(c.fieldKey)}</span>
                {c.quote && <span className="line-clamp-2 text-fg-muted">{c.quote}</span>}
              </span>
            </button>
          )}
          {editing === c.id ? (
            <CommentEditor
              label="编辑评论"
              placeholder="写评论…"
              submitLabel="保存"
              members={others}
              fields={fields}
              workItemId={workItemId}
              draftId={c.id}
              files={filesOf(c.id)}
              initialHtml={c.body}
              autoFocus
              onCancel={() => setEditing(null)}
              onSubmit={async (body, mentions) => {
                const failed = await run(mutators.comment.update({ id: c.id, body, mentions }));
                if (!failed) setEditing(null);
                return failed;
              }}
            />
          ) : (
            <>
              {c.body && <RichTextView html={c.body} className="break-words" onField={onLocateField} />}
              <CommentFiles files={filesOf(c.id)} />
            </>
          )}
          {editing !== c.id && (
            <div className="flex gap-3 text-xs text-fg-subtle opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                className="cursor-pointer hover:text-accent"
                onClick={() => setReplying({ to: c, id: newId() })}
              >
                回复
              </button>
              {mine && (
                <button type="button" className="cursor-pointer hover:text-accent" onClick={() => setEditing(c.id)}>
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

  const composer = (
    <div data-comment-composer>
      <CommentEditor
        key={`${draftId}-${topic?.fieldKey ?? ""}`}
        label="评论内容"
        placeholder={topic ? `说说「${topic.name}」…` : "写评论，输入 @ 提及成员或字段…"}
        submitLabel="发表评论"
        members={others}
        fields={fields}
        workItemId={workItemId}
        draftId={draftId}
        files={filesOf(draftId)}
        autoFocus={!!topic}
        topic={topic}
        {...(onClearTopic && { onClearTopic })}
        onSubmit={async (body, mentions) => {
          const failed = await run(
            mutators.comment.create({
              id: draftId,
              workItemId,
              body,
              mentions,
              ...(topic && { fieldKey: topic.fieldKey, quote: topic.quote.slice(0, 500) }),
            }),
          );
          if (!failed) {
            setDraftId(newId());
            onClearTopic?.();
          }
          return failed;
        }}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {fieldFilter && (
          <span className="inline-flex items-center gap-1 rounded-md bg-canvas px-2 py-0.5 text-xs">
            <Hash className="size-3 text-accent" />
            只看「{fieldName(fieldFilter)}」的评论
            <button
              type="button"
              aria-label="查看全部评论"
              className="cursor-pointer text-fg-subtle hover:text-fg"
              onClick={onClearFieldFilter}
            >
              <X className="size-3" />
            </button>
          </span>
        )}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={toggleOrder}>
          <ArrowDownUp />
          {order === "asc" ? "最早的在前" : "最新的在前"}
        </Button>
      </div>
      {order === "desc" && composer}
      {threads.length === 0 && (
        <p className="text-fg-subtle">{fieldFilter ? "这个字段还没有评论。" : "还没有评论。"}</p>
      )}
      <ol aria-label="评论列表" className="flex flex-col gap-4">
        {threads.map(({ root, replies }) => {
          const replyHere = replying && (replying.to.id === root.id || replying.to.parentId === root.id);
          return (
            <li key={root.id} className="flex flex-col gap-2">
              {entry(root, false)}
              {(replies.length > 0 || replyHere) && (
                <section aria-label="回复" className="ml-[38px] flex flex-col gap-2.5 rounded-md bg-canvas px-3 py-2.5">
                  {replies.map((r) => entry(r, true))}
                  {replyHere && replying && (
                    <CommentEditor
                      key={replying.id}
                      label="回复内容"
                      placeholder={`回复 ${replying.to.author?.name ?? ""}…`}
                      submitLabel="回复"
                      members={others}
                      fields={fields}
                      workItemId={workItemId}
                      draftId={replying.id}
                      files={filesOf(replying.id)}
                      autoFocus
                      onCancel={() => setReplying(null)}
                      onSubmit={async (body, mentions) => {
                        const failed = await run(
                          mutators.comment.create({
                            id: replying.id,
                            workItemId,
                            body,
                            mentions,
                            replyTo: replying.to.id,
                          }),
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
      {order === "asc" && composer}
    </div>
  );
}
