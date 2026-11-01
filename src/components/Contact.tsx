"use client";

import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/icons";
import { Button, ErrorText, Input, Textarea } from "@/components/ui";
import { useErrorText } from "@/i18n/errors";
import { attachmentProblem, CONTACT_FILE_ACCEPT, CONTACT_FILES_BYTES, CONTACT_FILES_MAX, CONTACT_KINDS, CONTACT_MESSAGE_MAX, CONTACT_SUBJECT_MAX, fileSize, type ContactKind } from "@/lib/contact";
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
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState(opening.kind);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<"writing" | "sending" | "sent">("writing");
  const [error, setError] = useState<Reason | null>(null);

  /** Adds all of `more` or none of it, saying why when the limits refuse. */
  function attach(more: File[]) {
    if (more.length === 0) return;
    const next = [...files, ...more];
    const problem = attachmentProblem(next);
    setError(problem);
    if (!problem) setFiles(next);
  }

  async function send() {
    if (!message.trim() || phase !== "writing") return;
    setPhase("sending");
    setError(null);
    const form = new FormData();
    form.append(
      "report",
      JSON.stringify({
        kind,
        subject,
        message,
        generationId: opening.generationId,
        context: { page: location.href, locale: document.documentElement.lang, userAgent: navigator.userAgent, viewport: `${innerWidth}×${innerHeight}` },
      }),
    );
    for (const f of files) form.append("files", f);
    try {
      const res = await fetch("/api/contact", { method: "POST", body: form });
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
          <span className="text-xs font-medium text-muted">{t("subjectLabel")}</span>
          <Input value={subject} maxLength={CONTACT_SUBJECT_MAX} placeholder={t("subjectPlaceholder")} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-muted">{t("messageLabel")}</span>
          <Textarea
            data-autofocus
            rows={6}
            value={message}
            maxLength={CONTACT_MESSAGE_MAX}
            placeholder={t("placeholder", { kind })}
            onChange={(e) => setMessage(e.target.value)}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.length === 0) return;
              e.preventDefault();
              attach(pasted);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
            }}
            className="resize-y px-3 py-2 leading-relaxed"
          />
        </label>
        <div className="grid gap-2">
          {files.length > 0 && (
            <ul aria-label={t("attachmentsLabel")} className="flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <li key={`${i}-${f.name}`} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-2 py-0.5 pl-3 pr-0.5 text-xs text-foreground-2">
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 tabular-nums text-subtle">{fileSize(f.size)}</span>
                  <button
                    type="button"
                    aria-label={t("removeFile", { name: f.name })}
                    onClick={() => {
                      setFiles(files.filter((_, j) => j !== i));
                      setError(null);
                    }}
                    className="grid size-8 shrink-0 place-items-center rounded-full transition hover:bg-white/10 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <Icon name="x" className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={files.length >= CONTACT_FILES_MAX}>
              <Icon name="clip" />
              {t("attach")}
            </Button>
            <span className="break-keep text-xs text-subtle">{t("attachHint", { max: CONTACT_FILES_MAX, mb: String(CONTACT_FILES_BYTES / 1024 / 1024) })}</span>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept={CONTACT_FILE_ACCEPT}
            onChange={(e) => {
              attach([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
        <p className="break-keep text-xs leading-relaxed text-subtle">{t("attached", { generation: opening.generationId ? "yes" : "no" })}</p>
        {error && <ErrorText>{errorText(error)}</ErrorText>}
      </div>
    </Modal>
  );
}
