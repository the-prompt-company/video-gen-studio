"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorText, Field, Input } from "@/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/lib/credentials";
import { parseAppError } from "@/lib/errors";
import { useErrorText } from "@/i18n/errors";
import type { Locale } from "@/i18n/locale";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "failed"; error: string } | { kind: "changed" };

type Known =
  | { username?: undefined; currentPassword?: undefined; hideId?: undefined }
  | { username: string; currentPassword?: string; hideId?: boolean };

export type PasswordChangeFormProps = Known & {
  onChanged?: () => void;
  autoFocus?: boolean;
  /** A language picked on the login screen during this visit, stored on the account with the new password. */
  locale?: Locale | null;
};

export function PasswordChangeForm({ username, currentPassword, hideId, onChanged, autoFocus, locale }: PasswordChangeFormProps) {
  const t = useTranslations("auth");
  const errorText = useErrorText();
  const [id, setId] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setStatus({ kind: "failed", error: t("mismatch") });
      return;
    }
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username ?? id, currentPassword: currentPassword ?? current, newPassword: next, ...(locale && { locale }) }),
        cache: "no-store",
      });
      if (!res.ok) {
        setStatus({ kind: "failed", error: errorText(parseAppError(await res.json().catch(() => null), res.status)) });
        return;
      }
    } catch {
      setStatus({ kind: "failed", error: errorText({ code: "network" }) });
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
        <Field label={t("currentPassword")}>
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
      <Field label={t("newPassword")} hint={t("minLength", { min: MIN_PASSWORD_LENGTH })}>
        <Input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          autoFocus={autoFocus && !asksId && !asksCurrent}
          required
        />
      </Field>
      <Field label={t("confirmPassword")}>
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
      </Field>
      {status.kind === "failed" && <ErrorText>{status.error}</ErrorText>}
      {status.kind === "changed" && (
        <p role="status" className="break-keep text-sm text-foreground-2">
          {t("changed")}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={status.kind === "sending"} aria-busy={status.kind === "sending"}>
        {status.kind === "sending" ? t("changing") : t("changePassword")}
      </Button>
    </form>
  );
}
