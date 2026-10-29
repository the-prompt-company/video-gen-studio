"use client";

import { useState, type FormEvent } from "react";
import { Button, ErrorText, Field, Input } from "@/components/ui";
import { PasswordChangeForm } from "@/components/PasswordChangeForm";

type Mode = { kind: "login" } | { kind: "change" } | { kind: "temporary"; username: string; password: string };

const HEADING: Record<Mode["kind"], { title: string; lead: string }> = {
  login: { title: "로그인", lead: "배부받은 ID와 비밀번호를 입력하세요." },
  change: { title: "비밀번호 변경", lead: "현재 비밀번호를 확인한 뒤 새 비밀번호로 바꿉니다. 다른 기기의 로그인은 모두 끝납니다." },
  temporary: { title: "새 비밀번호 정하기", lead: "관리자가 정한 임시 비밀번호로 로그인했습니다. 계속하려면 나만 아는 새 비밀번호를 정하세요." },
};

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>({ kind: "login" });
  const heading = HEADING[mode.kind];

  const enter = () => window.location.assign(next);

  return (
    <>
      <h1 className="text-2xl font-semibold">{heading.title}</h1>
      <p className="mt-1 break-keep text-sm text-muted">{heading.lead}</p>
      <div className="mt-6">
        {mode.kind === "login" && (
          <SignInForm onSignedIn={enter} onTemporary={(username, password) => setMode({ kind: "temporary", username, password })} />
        )}
        {mode.kind === "change" && <PasswordChangeForm autoFocus onChanged={enter} />}
        {mode.kind === "temporary" && (
          <PasswordChangeForm autoFocus username={mode.username} currentPassword={mode.password} onChanged={enter} />
        )}
        <Button
          type="button"
          variant="ghost"
          className="mt-3 min-h-11 w-full"
          onClick={() => setMode(mode.kind === "login" ? { kind: "change" } : { kind: "login" })}
        >
          {mode.kind === "login" ? "비밀번호 변경" : "로그인으로 돌아가기"}
        </Button>
      </div>
    </>
  );
}

function SignInForm({ onSignedIn, onTemporary }: { onSignedIn: () => void; onTemporary: (username: string, password: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let body: { error?: string; mustChangePassword?: boolean };
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        cache: "no-store",
      });
      body = (await res.json().catch(() => ({}))) as typeof body;
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
    if (body.mustChangePassword) onTemporary(username, password);
    else onSignedIn();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="ID">
        <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
      </Field>
      <Field label="비밀번호">
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
        {busy ? "확인 중…" : "로그인"}
      </Button>
    </form>
  );
}
