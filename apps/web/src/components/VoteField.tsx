import type { FieldOption, VoteConfig, VoteSummary } from "@fp/engine";
import { mutators } from "@fp/sync";
import { useZero } from "@rocicorp/zero/react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface Ballot {
  userId: string;
  choices: readonly string[] | null;
  remark: string | null;
  revealed: boolean | null;
  user?: { name: string } | null;
}

/** 每个选项的票数、占比，和按分值算的平均分（没设分值的选项不参与）。 */
export function tally(options: readonly FieldOption[], ballots: readonly Ballot[]) {
  const counts = options.map((o) => ({
    option: o,
    voters: ballots.filter((b) => b.choices?.includes(o.value)),
  }));
  const scores = ballots.flatMap((b) =>
    (b.choices ?? []).flatMap((c) => {
      const score = options.find((o) => o.value === c)?.score;
      return score == null ? [] : [score];
    }),
  );
  const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  return { counts, total: ballots.length, average };
}

/**
 * 投票字段（对照飞书项目的投票字段）：表态 / 单选 / 多选，可带备注；
 * 盲投时没放榜前只看得到自己的票，管理员和放榜角色可以公布或收起结果。
 */
export function VoteField({
  workItemId,
  field,
  summary,
  ballots,
  readOnly,
  canReveal,
  label,
}: {
  workItemId: string;
  field: {
    key: string;
    name: string;
    options: readonly FieldOption[] | null;
    config?: { vote?: VoteConfig | null } | null;
  };
  summary: VoteSummary | null;
  ballots: readonly Ballot[];
  readOnly: boolean;
  canReveal: boolean;
  label: string;
}) {
  const zero = useZero();
  const me = String(zero.userID);
  const config: VoteConfig = field.config?.vote ?? { mode: "single" };
  const options = (field.options ?? []).filter((o) => !o.disabled);
  const mine = ballots.find((b) => b.userId === me);
  const [choices, setChoices] = useState<string[]>([...(mine?.choices ?? [])]);
  const [remark, setRemark] = useState(mine?.remark ?? "");
  const [editing, setEditing] = useState(!mine);
  const [error, setError] = useState<string | null>(null);
  const voters = summary?.voters ?? [];
  const hidden = !!config.blind && !summary?.revealed;
  const visible = hidden ? ballots.filter((b) => b.userId === me) : ballots;
  const { counts, total, average } = tally(options, visible);
  const remarkOn = config.remark !== "off";

  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const { client, server } = zero.mutate(request);
    for (const outcome of [await client, await server])
      if (outcome.type === "error") {
        setError(outcome.error.message);
        return false;
      }
    return true;
  }

  function toggle(value: string) {
    setChoices((prev) =>
      config.mode === "multi" ? (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]) : [value],
    );
  }

  const ballotForm = (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(
          mutators.vote.cast({ workItemId, fieldKey: field.key, choices, ...(remark.trim() && { remark }) }),
        );
        if (ok) setEditing(false);
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: 一组切换按钮，不是表单分组 */}
      <div role="group" aria-label={`${label}选项`} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = choices.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(o.value)}
              className={cn(
                "h-7 cursor-pointer rounded-md border px-2.5 text-sm transition-colors",
                on ? "border-brand-500 bg-brand-50 text-brand-600" : "border-line hover:bg-hover",
              )}
            >
              {o.label ?? o.value}
            </button>
          );
        })}
      </div>
      {remarkOn && (
        <Input
          aria-label="投票备注"
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder={config.remark === "required" ? "投票备注（必填）" : "投票备注（选填）"}
        />
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={choices.length === 0}>
          {mine ? "改票" : "投票"}
        </Button>
        {mine && (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
            取消
          </Button>
        )}
      </div>
    </form>
  );

  return (
    <section aria-label={label} className="flex flex-col gap-2.5 rounded-md border border-line-subtle p-3">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <span>{voters.length} 人已投</span>
        {config.blind && <span>{hidden ? "· 盲投中，放榜后公布结果" : "· 已放榜"}</span>}
        {canReveal && config.blind && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => run(mutators.vote.reveal({ workItemId, fieldKey: field.key, revealed: !summary?.revealed }))}
          >
            {summary?.revealed ? "收起结果" : "放榜"}
          </Button>
        )}
      </div>
      {!readOnly && editing
        ? ballotForm
        : mine && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-fg-muted">我投了</span>
              <span className="font-medium">
                {(mine.choices ?? []).map((c) => options.find((o) => o.value === c)?.label ?? c).join("、")}
              </span>
              {mine.remark && <span className="text-fg-muted">（{mine.remark}）</span>}
              {!readOnly && (
                <button type="button" className="cursor-pointer text-brand-500" onClick={() => setEditing(true)}>
                  改票
                </button>
              )}
            </div>
          )}
      {!hidden && total > 0 && (
        <ul aria-label="投票结果" className="flex flex-col gap-1.5">
          {counts.map(({ option, voters: who }) => {
            const percent = Math.round((who.length / total) * 100);
            return (
              <li key={option.value} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className="w-20 truncate">{option.label ?? option.value}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-canvas">
                    <div className="h-full bg-brand-500" style={{ width: `${percent}%` }} />
                  </div>
                  <span className="w-20 text-right tabular-nums text-fg-muted">
                    {who.length} 票 {percent}%
                  </span>
                </div>
                {who.length > 0 && (
                  <div className="flex flex-wrap gap-2 pl-22 text-xs text-fg-muted">
                    {who.map((b) => (
                      <span key={b.userId} className="inline-flex items-center gap-1" title={b.remark ?? undefined}>
                        <Avatar name={b.user?.name ?? "?"} size={16} />
                        {b.user?.name ?? "—"}
                        {b.remark && <span className="text-fg-subtle">：{b.remark}</span>}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
          {average != null && <li className="text-sm text-fg-muted">平均分 {average.toFixed(2)}</li>}
        </ul>
      )}
      {error && <p className="text-sm text-danger-600">{error}</p>}
    </section>
  );
}
