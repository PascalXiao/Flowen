import { env } from "@/lib/env";

/** 调 API（带登录 cookie）。 */
export const api = (path: string, init?: RequestInit) =>
  fetch(`${env.apiUrl}${path}`, { credentials: "include", ...init });

/** POST JSON，失败时抛出接口给的错误信息。 */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "操作失败。");
  return data;
}
