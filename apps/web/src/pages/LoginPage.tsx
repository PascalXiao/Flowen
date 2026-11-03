import { Navigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth";

export function LoginPage() {
  // 登录成功后 Better Auth 会刷新会话，拿到会话就进入应用
  const { data: session } = authClient.useSession();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(true);
    setError(null);
    const { error } =
      mode === "signIn"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(form.get("name")) });
    setBusy(false);
    if (error) setError(error.message ?? "登录失败。");
  }

  if (session) return <Navigate to="/" />;

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-canvas p-4">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-brand-500 font-bold text-white">F</span>
        <span className="text-lg font-semibold">Flowen</span>
      </div>
      <div className="w-full max-w-sm rounded-lg bg-surface p-8 shadow-popover">
        <h1 className="mb-1 text-xl font-semibold">{mode === "signIn" ? "登录" : "注册"}</h1>
        <p className="mb-6 text-sm text-fg-subtle">
          {mode === "signIn" ? "用邮箱和密码登录" : "注册后自动登录，密码至少 8 位"}
        </p>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {mode === "signUp" && (
            <Field label="姓名">
              <Input name="name" required autoComplete="name" className="h-9" />
            </Field>
          )}
          <Field label="邮箱">
            <Input name="email" type="email" required autoComplete="email" className="h-9" />
          </Field>
          <Field label="密码">
            <Input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "signIn" ? "current-password" : "new-password"}
              className="h-9"
            />
          </Field>
          {error && <p className="text-sm text-danger-600">{error}</p>}
          <Button type="submit" size="lg" disabled={busy} className="mt-2">
            {mode === "signIn" ? "登录" : "注册并登录"}
          </Button>
          <Button
            variant="link"
            className="self-center"
            onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}
          >
            {mode === "signIn" ? "没有账号？注册" : "已有账号？登录"}
          </Button>
        </form>
      </div>
    </div>
  );
}
