"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/icons";
import { Button, ErrorText, Textarea } from "@/components/ui";
import { useErrorText } from "@/i18n/errors";
import { CONTACT_KINDS, CONTACT_MESSAGE_MAX, type ContactKind } from "@/lib/contact";
import { parseAppError, type Reason } from "@/lib/errors";

/** What opens the dialog: the nav opens it blank, a failed turn opens it as a bug report about itself. */
type Opening = { kind: ContactKind; generationId: string | null };

const OpenContact = createContext<(opening?: Partial<Opening>) => void>(() => {});

/** Opens the contact dialog from anywhere under the app layout. */
export const useContact = () => useContext(OpenContact);

export function ContactProvider({ children }: { children: ReactNode }) {
  const [opening, setOpening] = useState<Opening | null>(null);
  return (
    <OpenContact value={(o) => setOpening({ kind: o?.kind ?? "bug", generationId: o?.generationId ?? null })}>
      {children}
      {opening && <ContactDialog opening={opening} onClose={() => setOpening(null)} />}
    </OpenContact>
  );
}

export function ContactButton() {
  const t = useTranslations("contact");
  const open = useContact();
  return (
    <button
      type="button"
      onClick={() => open()}
      title={t("title")}
      className="inline-flex size-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-xs text-foreground-2 transition hover:bg-white/10 hover:text-foreground sm:h-9 sm:w-auto sm:px-3"
    >
      <Icon name="chat" />
      <span className="sr-only sm:not-sr-only">{t("open")}</span>
    </button>
  );
}

const PILL =
  "inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-checked:border-foreground aria-checked:bg-foreground aria-checked:text-background";

function ContactDialog({ opening, onClose }: { opening: Opening; onClose: () => void }) {
  const t = useTranslations("contact");
  const errorText = useErrorText();
  const [kind, setKind] = useState(opening.kind);
  const [message, setMessage] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const [phase, setPhase] = useState<"writing" | "sending" | "sent">("writing");
  const [error, setError] = useState<Reason | null>(null);

  async function send() {
    if (!message.trim() || phase !== "writing") return;
    setPhase("sending");
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          message,
          key,
          generationId: opening.generationId,
          context: { page: location.href, locale: document.documentElement.lang, userAgent: navigator.userAgent, viewport: `${innerWidth}×${innerHeight}` },
        }),
      });
      if (res.ok) return setPhase("sent");
      setError(parseAppError(await res.json().catch(() => null), res.status));
    } catch {
      setError({ code: "network" });
    }
    setPhase("writing");
  }

  if (phase === "sent") {
    return (
      <Modal title={t("title")} onClose={onClose} footer={<div className="flex justify-end"><Button onClick={onClose} data-autofocus>{t("close")}</Button></div>}>
        <p role="status" className="flex items-center gap-2 text-sm text-foreground">
          <Icon name="check" />
          {t("sent")}
        </p>
      </Modal>
    );
  }

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
      <Button onClick={send} disabled={!message.trim() || phase === "sending"}>{phase === "sending" ? t("sending") : t("send")}</Button>
    </div>
  );
  return (
    <Modal title={t("title")} onClose={onClose} footer={footer}>
      <div className="grid gap-4">
        <div role="radiogroup" aria-label={t("kindLabel")} className="flex flex-wrap gap-1.5">
          {CONTACT_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={`${PILL} border-border text-foreground-2 hover:border-foreground/60`}>
              {t("kind", { kind: k })}
            </button>
          ))}
        </div>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted">{t("messageLabel")}</span>
          <Textarea
            data-autofocus
            rows={6}
            value={message}
            maxLength={CONTACT_MESSAGE_MAX}
            placeholder={t("placeholder", { kind })}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
            }}
            className="resize-y px-3 py-2 leading-relaxed"
          />
        </label>
        <p className="break-keep text-xs leading-relaxed text-subtle">{t("attached", { generation: opening.generationId ? "yes" : "no" })}</p>
        {error && <ErrorText>{errorText(error)}</ErrorText>}
      </div>
    </Modal>
  );
}
