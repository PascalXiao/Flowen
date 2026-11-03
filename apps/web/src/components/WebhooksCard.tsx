import { mutators, queries, WEBHOOK_EVENTS, type WebhookEvent } from "@fp/sync";
import type { QueryResultType } from "@rocicorp/zero";
import { useQuery, useZero } from "@rocicorp/zero/react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tag, type TagTone } from "@/components/ui/tag";
import { newId } from "@/lib/utils";

type Webhook = QueryResultType<ReturnType<typeof queries.webhooks.bySpace>>[number];

const EVENT_KEYS = Object.keys(WEBHOOK_EVENTS) as WebhookEvent[];

const DELIVERY: Record<string, [string, TagTone]> = {
  pending: ["推送中", "brand"],
  succeeded: ["成功", "success"],
  failed: ["失败", "danger"],
};

/** 签名密钥：浏览器里随机生成 32 字节。 */
function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `whsec_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

const eventLabel = (kind: string) => WEBHOOK_EVENTS[kind as WebhookEvent] ?? kind;

/**
 * 空间的 Webhook：空间里发生的事件推送到外部地址。只有管理员能看到和配置（里面有签名密钥）。
 */
export function WebhooksCard({ spaceId }: { spaceId: string }) {
  const zero = useZero();
  const [hooks] = useQuery(queries.webhooks.bySpace({ spaceId }));
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function run(request: Parameters<typeof zero.mutate>[0]) {
    setError(null);
    const outcome = await zero.mutate(request).client;
    if (outcome.type === "error") setError(outcome.error.message);
    return outcome.type !== "error";
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const url = String(data.get("url") ?? "").trim();
    if (!name || !url) return;
    const ok = await run(mutators.webhook.create({ id: newId(), spaceId, name, url, secret: newSecret(), events }));
    if (ok) {
      form.reset();
      setEvents([]);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook</CardTitle>
        <CardDescription>
          空间里发生的事件实时推送到你的地址（POST JSON）。请求头 X-FP-Signature
          是用签名密钥对「X-FP-Timestamp.请求体」做的 HMAC-SHA256，接收方用它确认请求来自这里。失败会自动重试 5 次。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {hooks.map((hook) => (
          <WebhookItem key={hook.id} hook={hook} run={run} />
        ))}
        <form aria-label="添加 Webhook" className="flex flex-col gap-2 rounded-lg bg-canvas p-3" onSubmit={add}>
          <div className="flex flex-wrap items-center gap-2">
            <Input name="name" aria-label="Webhook 名称" placeholder="名称，例如：同步到 ERP" className="w-48" />
            <Input name="url" aria-label="推送地址" placeholder="https://example.com/hooks/feishu" className="flex-1" />
          </div>
          <EventPicker value={events} onChange={setEvents} />
          <div>
            <Button type="submit" variant="outline">
              添加 Webhook
            </Button>
          </div>
        </form>
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </CardContent>
    </Card>
  );
}

function EventPicker({ value, onChange }: { value: WebhookEvent[]; onChange: (next: WebhookEvent[]) => void }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <legend className="sr-only">推送的事件</legend>
      <span className="text-fg-muted">事件：</span>
      {EVENT_KEYS.map((key) => (
        <label key={key} className="flex items-center gap-1">
          <Checkbox
            checked={value.includes(key)}
            onChange={(e) => onChange(e.target.checked ? [...value, key] : value.filter((k) => k !== key))}
          />
          {WEBHOOK_EVENTS[key]}
        </label>
      ))}
      {value.length === 0 && <span className="text-xs text-fg-subtle">（不选表示全部事件）</span>}
    </fieldset>
  );
}

function WebhookItem({
  hook,
  run,
}: {
  hook: Webhook;
  run: (request: Parameters<ReturnType<typeof useZero>["mutate"]>[0]) => Promise<boolean>;
}) {
  const [showSecret, setShowSecret] = useState(false);
  const [editing, setEditing] = useState<WebhookEvent[] | null>(null);
  const subscribed = (hook.events ?? []) as WebhookEvent[];
  return (
    <section
      aria-label={`Webhook ${hook.name}`}
      className="flex flex-col gap-2 rounded-lg border border-line-subtle p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{hook.name}</span>
        {!hook.enabled && <Tag>已停用</Tag>}
        <code className="min-w-0 flex-1 truncate text-xs text-fg-muted" title={hook.url}>
          {hook.url}
        </code>
        <label className="flex items-center gap-1 text-sm">
          <Checkbox
            checked={hook.enabled ?? true}
            onChange={(e) => run(mutators.webhook.update({ id: hook.id, enabled: e.target.checked }))}
          />
          启用
        </label>
        <Button
          variant="link"
          size="sm"
          aria-label={`删除 Webhook ${hook.name}`}
          onClick={() => run(mutators.webhook.delete({ id: hook.id }))}
        >
          删除
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        事件：{subscribed.length ? subscribed.map(eventLabel).join("、") : "全部"}
        <Button variant="link" size="sm" onClick={() => setEditing(editing ? null : subscribed)}>
          {editing ? "取消" : "修改"}
        </Button>
      </div>
      {editing && (
        <div className="flex flex-col gap-2 rounded-md bg-canvas p-2">
          <EventPicker value={editing} onChange={setEditing} />
          <div>
            <Button
              size="sm"
              onClick={async () => {
                if (await run(mutators.webhook.update({ id: hook.id, events: editing }))) setEditing(null);
              }}
            >
              保存事件
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
        签名密钥：
        <code className="text-xs">{showSecret ? hook.secret : `${hook.secret.slice(0, 10)}••••••`}</code>
        <Button variant="link" size="sm" onClick={() => setShowSecret(!showSecret)}>
          {showSecret ? "隐藏" : "显示"}
        </Button>
        <Button
          variant="link"
          size="sm"
          onClick={() => run(mutators.webhook.update({ id: hook.id, secret: newSecret() }))}
        >
          重新生成
        </Button>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer select-none text-fg-muted hover:text-fg">
          最近推送 {hook.deliveries.length}
        </summary>
        <ul aria-label={`${hook.name}的推送记录`} className="mt-1.5 flex flex-col gap-1">
          {hook.deliveries.map((d) => {
            const [label, tone] = DELIVERY[d.status ?? "pending"] ?? ["", "neutral"];
            return (
              <li key={d.id} className="flex items-center gap-2 text-xs">
                <Tag tone={tone}>{label}</Tag>
                <span>{eventLabel(d.kind)}</span>
                <span className="text-fg-subtle">
                  {d.createdAt ? new Date(d.createdAt).toLocaleString("zh-CN") : ""}
                  {d.attempts ? ` · 尝试 ${d.attempts} 次` : ""}
                  {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ""}
                </span>
                {d.error && d.status !== "succeeded" && <span className="truncate text-danger-600">{d.error}</span>}
              </li>
            );
          })}
          {hook.deliveries.length === 0 && <li className="text-xs text-fg-subtle">还没有推送。</li>}
        </ul>
      </details>
    </section>
  );
}
