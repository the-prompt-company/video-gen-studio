"use client";

import { useState, type FormEvent } from "react";
import { Button, ErrorText, Field, Input } from "@/components/ui";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "failed"; error: string } | { kind: "changed" };

type Known =
  | { username?: undefined; currentPassword?: undefined; hideId?: undefined }
  | { username: string; currentPassword?: string; hideId?: boolean };

export type PasswordChangeFormProps = Known & {
  onChanged?: () => void;
  autoFocus?: boolean;
};

export function PasswordChangeForm({ username, currentPassword, hideId, onChanged, autoFocus }: PasswordChangeFormProps) {
  const [id, setId] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setStatus({ kind: "failed", error: "새 비밀번호 확인이 다릅니다. 같은 비밀번호를 두 번 입력하세요" });
      return;
    }
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username ?? id, currentPassword: currentPassword ?? current, newPassword: next }),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus({ kind: "failed", error: body.error ?? "비밀번호를 바꾸지 못했습니다. 다시 시도하세요" });
        return;
      }
    } catch {
      setStatus({ kind: "failed", error: "서버에 연결할 수 없습니다" });
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setStatus({ kind: "changed" });
    onChanged?.();
  }

  const asksId = username === undefined;
  const asksCurrent = currentPassword === undefined;

  return (
    <form onSubmit={submit} className="space-y-4">
      {hideId ? (
        <input type="text" value={username} readOnly autoComplete="username" tabIndex={-1} aria-hidden="true" className="sr-only" />
      ) : (
        <Field label="ID">
          {asksId ? (
            <Input value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" autoFocus={autoFocus} required />
          ) : (
            <Input value={username} readOnly autoComplete="username" className="text-muted" />
          )}
        </Field>
      )}
      {asksCurrent && (
        <Field label="현재 비밀번호">
          <Input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            autoFocus={autoFocus && !asksId}
            required
          />
        </Field>
      )}
      <Field label="새 비밀번호" hint="8자 이상">
        <Input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          autoFocus={autoFocus && !asksId && !asksCurrent}
          required
        />
      </Field>
      <Field label="새 비밀번호 확인">
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      </Field>
      {status.kind === "failed" && <ErrorText>{status.error}</ErrorText>}
      {status.kind === "changed" && (
        <p role="status" className="break-keep text-sm text-foreground-2">
          비밀번호를 바꿨습니다. 다른 기기와 브라우저의 로그인은 모두 끝났습니다.
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={status.kind === "sending"} aria-busy={status.kind === "sending"}>
        {status.kind === "sending" ? "변경 중…" : "비밀번호 변경"}
      </Button>
    </form>
  );
}
