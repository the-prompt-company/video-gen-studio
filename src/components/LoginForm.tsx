"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button, ErrorText, Field, Input } from "@/components/ui";
import { LanguagePicker } from "@/components/LanguagePicker";
import { PasswordChangeForm } from "@/components/PasswordChangeForm";
import { useErrorText } from "@/i18n/errors";
import type { Locale } from "@/i18n/locale";
import { parseAppError } from "@/lib/errors";

type Mode = { kind: "login" } | { kind: "change" } | { kind: "temporary"; username: string; password: string };

export function LoginForm({ next }: { next: string }) {
  const t = useTranslations("auth");
  const [mode, setMode] = useState<Mode>({ kind: "login" });
  // Only a pick made during this visit is stored on the account at sign-in; a cookie left by someone else is not.
  const [picked, setPicked] = useState<Locale | null>(null);

  const enter = () => window.location.assign(next);

  return (
    <>
      <h1 className="text-2xl font-semibold">{t(`heading.${mode.kind}.title`)}</h1>
      <p className="mt-1 break-keep text-sm text-muted">{t(`heading.${mode.kind}.lead`)}</p>
      <div className="mt-6">
        {mode.kind === "login" && (
          <SignInForm picked={picked} onSignedIn={enter} onTemporary={(username, password) => setMode({ kind: "temporary", username, password })} />
        )}
        {mode.kind === "change" && <PasswordChangeForm autoFocus locale={picked} onChanged={enter} />}
        {mode.kind === "temporary" && (
          <PasswordChangeForm autoFocus username={mode.username} currentPassword={mode.password} locale={picked} onChanged={enter} />
        )}
        <Button
          type="button"
          variant="ghost"
          className="mt-3 min-h-11 w-full"
          onClick={() => setMode(mode.kind === "login" ? { kind: "change" } : { kind: "login" })}
        >
          {mode.kind === "login" ? t("changePassword") : t("backToSignIn")}
        </Button>
      </div>
      <LanguagePicker className="mt-8 flex flex-col items-center" onPicked={setPicked} />
    </>
  );
}

function SignInForm({
  picked,
  onSignedIn,
  onTemporary,
}: {
  picked: Locale | null;
  onSignedIn: () => void;
  onTemporary: (username: string, password: string) => void;
}) {
  const t = useTranslations("auth");
  const errorText = useErrorText();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    let body: { mustChangePassword?: boolean } | null;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, ...(picked && { locale: picked }) }),
        cache: "no-store",
      });
      body = (await res.json().catch(() => null)) as typeof body;
      if (!res.ok) {
        setError(errorText(parseAppError(body, res.status)));
        setBusy(false);
        return;
      }
    } catch {
      setError(errorText({ code: "network" }));
      setBusy(false);
      return;
    }
    if (body?.mustChangePassword) onTemporary(username, password);
    else onSignedIn();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="ID">
        <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
      </Field>
      <Field label={t("password")}>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </Field>
      {error && <ErrorText>{error}</ErrorText>}
      <Button type="submit" size="lg" className="w-full" disabled={busy} aria-busy={busy}>
        {busy ? t("checking") : t("signIn")}
      </Button>
    </form>
  );
}
