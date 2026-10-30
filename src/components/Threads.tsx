"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/Modal";
import { Button, ErrorText } from "@/components/ui";
import { parseAppError, type Reason } from "@/lib/errors";
import type { PublicThread } from "@/lib/threads";
import { useErrorText } from "@/i18n/errors";

const icon = (d: string) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-4 w-4 shrink-0">
    <path d={d} />
  </svg>
);
const ICON = {
  plus: icon("M10 4.5v11M4.5 10h11"),
  list: icon("M4 5.5h12M4 10h12M4 14.5h12"),
  trash: icon("M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6"),
  collapse: icon("M12 5l-5 5 5 5"),
  expand: icon("M8 5l5 5-5 5"),
  history: icon("M10 6.5V10l2.5 1.5M4.2 10a5.8 5.8 0 1 0 1.7-4.1M4.2 3.6v2.6h2.6"),
};

const ROUND = "grid h-9 w-9 shrink-0 place-items-center rounded-full text-foreground-2 transition hover:bg-white/15 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** A thread's name: the earlier history in the page's words, an empty first prompt as no prompt, otherwise its title. */
export function useThreadName(): (thread: PublicThread) => string {
  const t = useTranslations("threads");
  const tGeneration = useTranslations("generation");
  return (thread) => (thread.kind === "earlier" ? t("earlier") : thread.title || tGeneration("noPrompt"));
}

type ListProps = {
  threads: PublicThread[];
  currentId: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
  onDelete: (thread: PublicThread) => void;
};

/** The new-thread button and the threads, newest activity first. A plain click picks; a modified click opens a tab. */
function ThreadList({ threads, currentId, onPick, onNew, onDelete }: ListProps) {
  const t = useTranslations("threads");
  const name = useThreadName();
  return (
    <>
      <Button variant="outline" size="sm" className="h-11 w-full lg:h-9" onClick={onNew}>
        {ICON.plus}
        {t("new")}
      </Button>
      <ul className="mt-3 space-y-0.5">
        {threads.map((thread) => {
          const current = thread.id === currentId;
          const label = name(thread);
          return (
            <li key={thread.id} className="group relative">
              <a
                href={`?thread=${thread.id}`}
                aria-current={current ? "page" : undefined}
                title={label}
                onClick={(e) => {
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  onPick(thread.id);
                }}
                className={`flex min-h-11 items-center gap-2 rounded-full pl-3 pr-11 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:min-h-10 ${
                  current ? "bg-white/12 text-foreground" : "text-foreground-2 hover:bg-white/10 hover:text-foreground"
                }`}
              >
                {thread.kind === "earlier" && <span className="text-muted">{ICON.history}</span>}
                <span className="truncate">{label}</span>
              </a>
              <button
                type="button"
                aria-label={t("delete.label", { title: label })}
                onClick={() => onDelete(thread)}
                className={`${ROUND} absolute right-1 top-1/2 -translate-y-1/2 text-muted focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100 ${current ? "opacity-100" : "opacity-0"}`}
              >
                {ICON.trash}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Desktop: the thread list as a column left of the drawer, or a strip of two buttons when collapsed. Until the member
 * chooses (`open` null), it starts open from 1280px and collapsed below, where it would squeeze the stage under 470px.
 */
export function ThreadColumn({ open, onOpen, ...list }: ListProps & { open: boolean | null; onOpen: (open: boolean) => void }) {
  const t = useTranslations("threads");
  const shown = (expanded: boolean) => (open === null ? (expanded ? "hidden xl:flex" : "flex xl:hidden") : open === expanded ? "flex" : "hidden");
  return (
    <nav aria-label={t("label")} className={`hidden shrink-0 border-r border-border bg-background lg:order-1 lg:block lg:h-full ${open === null ? "w-14 xl:w-60" : open ? "w-60" : "w-14"}`}>
      <div className={`${shown(true)} h-full flex-col`}>
        <div className="flex items-center justify-between pb-2 pl-4 pr-2.5 pt-3.5">
          <h2 className="text-xs font-semibold tracking-wider text-muted">{t("label")}</h2>
          <button type="button" aria-label={t("collapse")} aria-expanded onClick={() => onOpen(false)} className={ROUND}>
            {ICON.collapse}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
          <ThreadList {...list} />
        </div>
      </div>
      <div className={`${shown(false)} flex-col items-center gap-2 pt-3.5`}>
        <button type="button" aria-label={t("expand")} aria-expanded={false} onClick={() => onOpen(true)} className={ROUND}>
          {ICON.expand}
        </button>
        <button type="button" aria-label={t("new")} onClick={list.onNew} className={ROUND}>
          {ICON.plus}
        </button>
      </div>
    </nav>
  );
}

/** Under 1024px: the current thread's name opens the list in a sheet, beside a new-thread button. */
export function ThreadBar({ title, ...list }: ListProps & { title: string }) {
  const t = useTranslations("threads");
  const [open, setOpen] = useState(false);
  const closing =
    <A extends unknown[]>(then: (...args: A) => void) =>
    (...args: A) => {
      setOpen(false);
      then(...args);
    };
  return (
    <div className="order-0 flex items-center gap-2 border-b border-border px-3 py-1.5 lg:hidden">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={t("picker")}
        aria-describedby="thread-bar-title"
        onClick={() => setOpen(true)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full px-2 text-left text-sm text-foreground transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="text-muted">{ICON.list}</span>
        <span id="thread-bar-title" className="truncate">{title}</span>
      </button>
      <Button variant="outline" size="sm" className="h-11 shrink-0" onClick={list.onNew}>
        {ICON.plus}
        {t("new")}
      </Button>
      {open && (
        <Modal title={t("label")} onClose={() => setOpen(false)}>
          <ThreadList threads={list.threads} currentId={list.currentId} onPick={closing(list.onPick)} onNew={closing(list.onNew)} onDelete={closing(list.onDelete)} />
        </Modal>
      )}
    </div>
  );
}

/** Confirms a delete and sends it. A 404 means the thread is already gone, which is what the member asked for. */
export function DeleteThreadDialog({ thread, onClose, onDeleted }: { thread: PublicThread; onClose: () => void; onDeleted: (id: string) => void }) {
  const t = useTranslations("threads");
  const name = useThreadName();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Reason | null>(null);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/threads/${thread.id}`, { method: "DELETE" });
      if (res.ok || res.status === 404) return onDeleted(thread.id);
      setError(parseAppError(await res.json().catch(() => null), res.status));
    } catch {
      setError({ code: "network" });
    } finally {
      setBusy(false);
    }
  }
  const footer: ReactNode = (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={onClose}>{t("delete.cancel")}</Button>
      <Button variant="danger" onClick={confirm} disabled={busy}>{busy ? t("delete.deleting") : t("delete.confirm")}</Button>
    </div>
  );
  return (
    <Modal title={t("delete.title")} onClose={onClose} footer={footer}>
      <p className="break-words break-keep text-sm text-foreground">{t("delete.body", { title: name(thread) })}</p>
      <p className="mt-2 break-keep text-sm leading-relaxed text-muted">{t("delete.keeps")}</p>
      {error && <div className="mt-3"><ErrorText>{errorText(error)}</ErrorText></div>}
    </Modal>
  );
}
