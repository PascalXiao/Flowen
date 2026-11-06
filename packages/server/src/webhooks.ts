import { createHmac } from "node:crypto";
import { type LookupAddress, lookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { type Database, schema } from "@fp/db";
import { and, eq, sql } from "drizzle-orm";

/*
 * Webhook 推送：事件处理时找出要推送的 Webhook（matchWebhooks），再由 worker 逐个推送（deliverWebhook），
 * 失败按退避重试，最后一次也失败时记为失败（failWebhookDelivery）。每一步都可以安全重试。
 *
 * 请求头：
 * - X-FP-Event：事件类型
 * - X-FP-Delivery：推送 id，重试时不变，接收方可以用它去重
 * - X-FP-Timestamp：发送时间（Unix 秒）
 * - X-FP-Signature：sha256=HMAC-SHA256(密钥, "<X-FP-Timestamp>.<请求体>") 的十六进制
 */

/** 一次请求的超时。 */
const TIMEOUT_MS = 10_000;

export const deliveryId = (webhookId: string, eventId: number) => `${webhookId}:${eventId}`;

/** 地址指向内网、本机等不该从服务端访问的地方。重试也没用，worker 据此不再重试。 */
export class WebhookBlockedError extends Error {}

/** 不允许推送的地址段：本机、内网、链路本地、组播、保留地址。 */
const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  PRIVATE.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  PRIVATE.addSubnet(net, prefix, "ipv6");

export function isPrivateAddress(address: string): boolean {
  // IPv4 映射的 IPv6 地址（::ffff:127.0.0.1）按 IPv4 判断
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return PRIVATE.check(mapped, "ipv4");
  const family = isIP(address);
  if (family === 0) return true;
  return PRIVATE.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** 解析域名时检查每个地址；连接用的就是检查过的地址，所以换 DNS 记录（DNS rebinding）绕不过去。 */
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number | string },
  callback: (error: Error | null, address: string | LookupAddress[], family?: number) => void,
) {
  lookup(hostname, { family: options.family as 0 | 4 | 6 | undefined, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address)))
      return callback(new WebhookBlockedError(`不允许推送到内网地址（${hostname}）。`), "");
    const [first] = addresses as [LookupAddress];
    if (options.all) callback(null, addresses);
    else callback(null, first.address, first.family);
  });
}

export interface DeliverOptions {
  /** 允许推送到内网和本机地址。只在测试或全内网部署时打开。 */
  allowPrivate?: boolean;
}

interface Sent {
  status: number;
}

function post(url: URL, body: string, headers: Record<string, string>, allowPrivate: boolean): Promise<Sent> {
  // 地址直接写 IP 时不会走 lookup，单独检查
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate && isIP(host) && isPrivateAddress(host))
    return Promise.reject(new WebhookBlockedError(`不允许推送到内网地址（${url.hostname}）。`));
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: "POST",
        headers: { ...headers, "content-length": Buffer.byteLength(body).toString() },
        timeout: TIMEOUT_MS,
        ...(!allowPrivate && { lookup: guardedLookup as never }),
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`${TIMEOUT_MS / 1000} 秒内没有响应。`)));
    req.on("error", reject);
    req.end(body);
  });
}

/**
 * 找出要推送这条事件的 Webhook（同空间、已启用、订阅了这类事件），并登记待推送记录。
 * 自动化引发的事件也推送：外部系统关心的是发生了什么，不管是谁做的。
 */
export async function matchWebhooks(database: Database, eventId: number): Promise<string[]> {
  const { db } = database;
  const event = await db.query.eventLog.findFirst({ where: eq(schema.eventLog.id, eventId) });
  if (!event) throw new Error(`event_log 里没有事件 ${eventId}`);
  const hooks = await db.query.webhook.findMany({
    where: and(eq(schema.webhook.spaceId, event.spaceId), eq(schema.webhook.enabled, true)),
  });
  const matched = hooks.filter((h) => !h.events?.length || h.events.includes(event.kind)).map((h) => h.id);
  if (matched.length > 0)
    await db
      .insert(schema.webhookDelivery)
      .values(
        matched.map((webhookId) => ({ id: deliveryId(webhookId, eventId), webhookId, eventId, kind: event.kind })),
      )
      .onConflictDoNothing();
  return matched;
}

/** 推送给接收方的请求体。 */
export async function webhookBody(database: Database, eventId: number) {
  const { db } = database;
  const event = await db.query.eventLog.findFirst({ where: eq(schema.eventLog.id, eventId) });
  if (!event) throw new Error(`event_log 里没有事件 ${eventId}`);
  const item = event.workItemId
    ? await db.query.workItem.findFirst({ where: eq(schema.workItem.id, event.workItemId) })
    : undefined;
  return {
    id: event.id,
    event: event.kind,
    spaceId: event.spaceId,
    actor: event.actor,
    /** 由自动化引发时，引发它的事件 id。 */
    causedBy: event.causedBy,
    at: event.at.toISOString(),
    data: event.payload,
    workItem: item
      ? { id: item.id, name: item.name, typeId: item.typeId, status: item.status, stage: item.stage }
      : null,
  };
}

/**
 * 推送一次。成功返回 "succeeded"；Webhook 已删除或停用时返回 "skipped"，不再推送；
 * 失败时记下原因并抛出，由调用方决定是否重试。
 */
export async function deliverWebhook(
  database: Database,
  webhookId: string,
  eventId: number,
  options: DeliverOptions = {},
): Promise<"succeeded" | "skipped"> {
  const { db } = database;
  const id = deliveryId(webhookId, eventId);
  const hook = await db.query.webhook.findFirst({ where: eq(schema.webhook.id, webhookId) });
  if (!hook?.enabled) return "skipped";
  const payload = await webhookBody(database, eventId);
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", hook.secret).update(`${timestamp}.${body}`).digest("hex");
  const record = (set: Partial<typeof schema.webhookDelivery.$inferInsert>) =>
    db
      .update(schema.webhookDelivery)
      .set({ attempts: sql`${schema.webhookDelivery.attempts} + 1`, ...set })
      .where(eq(schema.webhookDelivery.id, id));
  let sent: Sent;
  try {
    sent = await post(
      new URL(hook.url),
      body,
      {
        "content-type": "application/json",
        "user-agent": "flowen-webhook/1",
        "x-fp-event": payload.event,
        "x-fp-delivery": id,
        "x-fp-timestamp": timestamp,
        "x-fp-signature": `sha256=${signature}`,
      },
      options.allowPrivate ?? false,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await record({ responseStatus: null, error: message });
    throw error;
  }
  if (sent.status >= 200 && sent.status < 300) {
    await record({ status: "succeeded", responseStatus: sent.status, error: null, finishedAt: new Date() });
    return "succeeded";
  }
  await record({ responseStatus: sent.status, error: `接收方返回 HTTP ${sent.status}。` });
  throw new Error(`接收方返回 HTTP ${sent.status}。`);
}

/** 重试用完仍然失败。 */
export async function failWebhookDelivery(database: Database, webhookId: string, eventId: number) {
  await database.db
    .update(schema.webhookDelivery)
    .set({ status: "failed", finishedAt: new Date() })
    .where(eq(schema.webhookDelivery.id, deliveryId(webhookId, eventId)));
}
