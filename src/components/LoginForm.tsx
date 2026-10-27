"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";

export function LoginForm() {
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "로그인 실패");
        setBusy(false);
        return;
      }
    } catch {
      setError("서버에 연결할 수 없습니다");
      setBusy(false);
      return;
    }
    // Full navigation (not router.push): the client router may have cached the
    // logged-out redirect for the target page, and the new cookie must reach proxy.ts.
    const next = params.get("next");
    window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/playground");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="ID">
        <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
      </Field>
      <Field label="비밀번호">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </Field>
      {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "확인 중…" : "로그인"}
      </Button>
    </form>
  );
}
