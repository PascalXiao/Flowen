import { type Database, schema } from "@fp/db";
import { and, eq, sql } from "drizzle-orm";
import { type DeliverOptions, post, type Sent } from "./webhooks.ts";

/*
 * 自动化「调用外部接口」动作的请求：runRule 在规则的事务里登记，提交后由 worker 逐个发出，失败按退避重试，
 * 最后一次也失败时记为失败。每一步都可以安全重试。
 *
 * 请求头：
 * - X-FP-Delivery：请求 id，重试时不变，接收方可以用它去重
 * - X-FP-Rule：规则 id
 * 以及规则里配置的请求头（比如接收方要的鉴权令牌）。
 */

/** 这条事件上这条规则登记了、还没发出的请求。 */
export async function pendingRequests(database: Database, ruleId: string, eventId: number): Promise<string[]> {
  const rows = await database.db.query.automationRequest.findMany({
    columns: { id: true },
    where: and(
      eq(schema.automationRequest.ruleId, ruleId),
      eq(schema.automationRequest.eventId, eventId),
      eq(schema.automationRequest.status, "pending"),
    ),
  });
  return rows.map((r) => r.id);
}

/** body 是 JSON 时按 JSON 发，否则按纯文本发。 */
const contentType = (body: string) => {
  try {
    JSON.parse(body);
    return "application/json";
  } catch {
    return "text/plain; charset=utf-8";
  }
};

/**
 * 发一次请求。成功返回 "succeeded"；已经发成功过（重复调用）或请求已不存在返回 "skipped"；
 * 失败时记下原因并抛出，由调用方决定是否重试。
 */
export async function sendAutomationRequest(
  database: Database,
  requestId: string,
  options: DeliverOptions = {},
): Promise<"succeeded" | "skipped"> {
  const { db } = database;
  const req = await db.query.automationRequest.findFirst({ where: eq(schema.automationRequest.id, requestId) });
  if (!req || req.status !== "pending") return "skipped";
  const record = (set: Partial<typeof schema.automationRequest.$inferInsert>) =>
    db
      .update(schema.automationRequest)
      .set({ attempts: sql`${schema.automationRequest.attempts} + 1`, ...set })
      .where(eq(schema.automationRequest.id, requestId));
  const headers: Record<string, string> = {
    "content-type": contentType(req.body),
    "user-agent": "flowen-automation/1",
  };
  for (const h of req.headers) headers[h.name.toLowerCase()] = h.value;
  headers["x-fp-delivery"] = req.id;
  headers["x-fp-rule"] = req.ruleId;
  let sent: Sent;
  try {
    sent = await post(new URL(req.url), req.body, headers, options.allowPrivate ?? false);
  } catch (error) {
    await record({
      responseStatus: null,
      responseBody: null,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  if (sent.status >= 200 && sent.status < 300) {
    await record({
      status: "succeeded",
      responseStatus: sent.status,
      responseBody: sent.body || null,
      error: null,
      finishedAt: new Date(),
    });
    return "succeeded";
  }
  await record({
    responseStatus: sent.status,
    responseBody: sent.body || null,
    error: `接收方返回 HTTP ${sent.status}。`,
  });
  throw new Error(`接收方返回 HTTP ${sent.status}。`);
}

/** 重试用完仍然失败。 */
export async function failAutomationRequest(database: Database, requestId: string) {
  await database.db
    .update(schema.automationRequest)
    .set({ status: "failed", finishedAt: new Date() })
    .where(and(eq(schema.automationRequest.id, requestId), eq(schema.automationRequest.status, "pending")));
}
