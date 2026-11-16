import { type FormEvent, useCallback, useEffect, useState } from "react";
import { useActiveSpace } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { ErrorBanner, PageBody, PageHeader } from "@/components/ui/page";
import { env } from "@/lib/env";

interface Token {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const api = (path: string, init?: RequestInit) => fetch(`${env.apiUrl}${path}`, { credentials: "include", ...init });

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString("zh-CN") : "从未使用");

/**
 * 开放接口：管理自己的访问令牌，查看接口文档。令牌代表自己，权限和自己在界面上一样，
 * 所以它的明文只在创建时显示一次。
 */
export function ApiTokensPage() {
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useActiveSpace(null);

  const load = useCallback(async () => {
    const res = await api("/api/tokens");
    if (res.ok) setTokens((await res.json()) as Token[]);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    if (!name) return;
    setError(null);
    const res = await api("/api/tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await res.json()) as { id: string; name: string; token: string; error?: string };
    if (!res.ok) return setError(body.error ?? "创建失败。");
    setCreated(body);
    form.reset();
    await load();
  }

  async function remove(token: Token) {
    setError(null);
    const res = await api(`/api/tokens/${token.id}`, { method: "DELETE" });
    if (!res.ok) return setError("删除失败。");
    if (created?.id === token.id) setCreated(null);
    await load();
  }

  const docs = `${env.apiUrl}/open-api/v1/docs`;
  return (
    <>
      <PageHeader title="开放接口" />
      <PageBody className="max-w-3xl">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <Card>
          <CardHeader>
            <CardTitle>访问令牌</CardTitle>
            <CardDescription>
              外部系统用令牌调用开放接口。令牌代表你本人，能看到和能做的事跟你在界面上一样；不用了就删掉。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {created && (
              <section
                aria-label="新令牌"
                className="flex flex-col gap-2 rounded-lg border border-brand-200 bg-brand-50/40 p-3"
              >
                <p className="text-sm">令牌「{created.name}」已创建。它只显示这一次，请现在复制保存：</p>
                <div className="flex items-center gap-2">
                  <Input aria-label="令牌" readOnly value={created.token} className="font-mono" />
                  <Button variant="outline" onClick={() => navigator.clipboard?.writeText(created.token)}>
                    复制
                  </Button>
                </div>
              </section>
            )}
            <ul aria-label="令牌列表" className="flex flex-col divide-y divide-line-subtle text-sm">
              {tokens?.map((t) => (
                <li key={t.id} className="flex h-12 items-center gap-3">
                  <span className="flex flex-col leading-tight">
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-fg-subtle">
                      <code>{t.prefix}…</code> · 创建于 {time(t.createdAt)} · 最近使用：{time(t.lastUsedAt)}
                    </span>
                  </span>
                  <Button
                    variant="link"
                    size="sm"
                    className="ml-auto"
                    aria-label={`删除令牌 ${t.name}`}
                    onClick={() => remove(t)}
                  >
                    删除
                  </Button>
                </li>
              ))}
              {tokens?.length === 0 && <li className="py-2 text-fg-subtle">还没有令牌。</li>}
            </ul>
            <form className="flex items-end gap-2" onSubmit={create}>
              <Label className="flex flex-1 flex-col gap-1.5">
                令牌名称
                <Input name="name" placeholder="如：CI 集成、数据同步脚本" maxLength={60} />
              </Label>
              <Button type="submit">创建令牌</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>怎么调用</CardTitle>
            <CardDescription>
              接口说明和在线调试见{" "}
              <a href={docs} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                接口文档
              </a>
              。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-canvas p-3 text-xs">
              {`curl ${env.apiUrl}/open-api/v1/spaces \\\n  -H "Authorization: Bearer <令牌>"`}
            </pre>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
