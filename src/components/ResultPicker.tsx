"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { describeModel } from "@/lib/catalog";
import type { PublicGeneration } from "@/lib/generations";
import type { Attachment } from "@/lib/composer";
import { attachmentMentions, insertMention } from "@/lib/attachment-mentions";
import type { Reference } from "@/lib/references";
import { mentionQuery, pickable, typedMention, withoutMention } from "@/lib/result-picker";
import { Icon } from "@/components/icons";
import { ago } from "@/i18n/format";

const RECENT_URL = "/api/generations?status=completed&limit=24";

type Mention = { start: number; query: string };
type Recent = { state: "loading" } | { state: "failed" } | { state: "loaded"; rows: PublicGeneration[] };

/** The "@" picker's state, driven from the prompt's own events. */
export function useResultPicker({
  prompt,
  setPrompt,
  input,
  threadRows,
  takes,
  onPick,
  attachments,
}: {
  attachments: readonly Attachment[];
  prompt: string;
  setPrompt: (text: string) => void;
  input: RefObject<HTMLTextAreaElement | null>;
  threadRows: readonly PublicGeneration[];
  takes: readonly Reference["kind"][];
  onPick: (g: PublicGeneration) => void;
}) {
  const id = useId();
  const [mention, setMention] = useState<Mention | null>(null);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Recent>({ state: "loading" });
  const request = useRef<AbortController | null>(null);
  const caretTo = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (caretTo.current === null || !input.current) return;
    input.current.setSelectionRange(caretTo.current, caretTo.current);
    caretTo.current = null;
  });

  const recentRows = recent.state === "loaded" ? recent.rows : [];
  const lists = mention ? pickable(threadRows, recentRows, takes, mention.query) : { thread: [], recent: [] };
  const references = attachmentMentions(attachments).filter((a) => a.url !== null && takes.includes(a.kind) && (!mention?.query || `${a.token} ${a.name}`.toLowerCase().includes(mention.query.toLowerCase())));
  const options = [...references, ...lists.thread, ...lists.recent];
  const current = Math.min(active, options.length - 1);
  const optionId = (g: { id: string }) => `${id}-${g.id}`;

  function open(start: number) {
    request.current?.abort();
    const ask = new AbortController();
    request.current = ask;
    setMention({ start, query: "" });
    setActive(0);
    setRecent({ state: "loading" });
    fetch(RECENT_URL, { signal: ask.signal })
      .then(async (res) => {
        const body = (await res.json()) as { items?: PublicGeneration[] };
        if (!res.ok || !body.items) throw new Error(String(res.status));
        setRecent({ state: "loaded", rows: body.items });
      })
      .catch(() => !ask.signal.aborted && setRecent({ state: "failed" }));
  }

  function close() {
    request.current?.abort();
    setMention(null);
  }

  function pick(g: PublicGeneration | (typeof references)[number]) {
    if (!mention) return;
    const caret = input.current?.selectionStart ?? prompt.length;
    const next = "token" in g ? insertMention(prompt, mention.start, caret, g.token) : withoutMention(prompt, mention.start, caret);
    caretTo.current = next.caret;
    setPrompt(next.text);
    close();
    if (!("token" in g)) onPick(g);
  }

  return {
    insert(token: string) {
      const el = input.current;
      const next = insertMention(prompt, el?.selectionStart ?? prompt.length, el?.selectionEnd ?? prompt.length, token);
      caretTo.current = next.caret;
      setPrompt(next.text);
      close();
      el?.focus();
    },
    /** The textarea's onChange. */
    edited(text: string, caret: number) {
      const typed = typedMention(text, caret);
      if (typed !== null && typed !== mention?.start) return open(typed);
      if (!mention) return;
      const query = mentionQuery(text, mention.start, caret);
      if (query === null) return close();
      if (query !== mention.query) {
        setMention({ ...mention, query });
        setActive(0);
      }
    },
    /** The textarea's onSelect. */
    moved(text: string, caret: number) {
      if (mention && mentionQuery(text, mention.start, caret) === null) close();
    },
    close,
    /** True when the picker took the key. */
    key(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
      // Safari ends an IME composition with an Enter whose isComposing is already false.
      if (!mention || e.nativeEvent.isComposing || e.keyCode === 229) return false;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return true;
      }
      if (options.length === 0) return false;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((current + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        return true;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        pick(options[current]);
        return true;
      }
      return false;
    },
    inputProps: {
      "aria-autocomplete": "list" as const,
      "aria-controls": mention ? id : undefined,
      "aria-activedescendant": mention && options[current] ? optionId(options[current]) : undefined,
    },
    list: mention && { id, lists, references, recent: recent.state, active: options[current]?.id ?? null, optionId, query: mention.query, pick, hover: (g: (typeof options)[number]) => setActive(options.indexOf(g)) },
    videosHidden: !takes.includes("video") && [...threadRows, ...recentRows].some((g) => g.ref?.kind === "video"),
  };
}

type ListProps = NonNullable<ReturnType<typeof useResultPicker>["list"]> & {
  /** URLs the composer already holds. */
  attached: ReadonlySet<string>;
  note: string | null;
};

export function ResultList({ id, lists, references, recent, active, optionId, query, pick, hover, attached, note }: ListProps) {
  const t = useTranslations("playground");
  const tGeneration = useTranslations("generation");
  const format = useFormatter();
  const openedAt = useNow();
  const total = references.length + lists.thread.length + lists.recent.length;
  const groups = [
    { key: "thread", label: t("picker.thread"), rows: lists.thread },
    { key: "recent", label: t("picker.recent"), rows: lists.recent },
  ].filter((g) => g.rows.length > 0);
  useEffect(() => {
    if (active) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [id, active]);
  const status = recent === "loading" ? t("picker.loading") : recent === "failed" ? t("picker.failed") : total === 0 ? (query ? t("picker.noMatch", { query }) : t("picker.empty")) : null;

  return (
    <div className="absolute inset-x-0 bottom-full z-30 mb-2 flex max-h-[min(50dvh,400px)] flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-3 px-3 pb-1.5 pt-2.5">
        <h3 id={`${id}-label`} className="text-xs font-semibold tracking-wider text-muted">
          {t("picker.label")}
        </h3>
        <span aria-hidden className="text-[11px] text-subtle max-sm:hidden">
          {t("picker.hint")}
        </span>
      </div>
      <div role="listbox" id={id} aria-labelledby={`${id}-label`} aria-busy={recent === "loading" || undefined} className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto overscroll-contain px-1.5 pb-1.5">
        {references.length > 0 && <div role="group" aria-label={t("refs.attached")} className="grid gap-0.5">
          <div className="px-2 py-1 text-xs text-subtle">{t("refs.attached")}</div>
          {references.map((a) => <div key={a.id} id={optionId(a)} role="option" aria-selected={a.id === active}
            onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}
            onPointerMove={() => hover(a)} onClick={() => pick(a)}
            className="flex min-h-14 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 aria-selected:bg-white/10">
            {a.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.preview} alt="" className="h-9 w-16 rounded-md object-cover" />
            ) : <video src={a.preview} muted playsInline preload="metadata" className="h-9 w-16 rounded-md object-cover" />}
            <span className="min-w-0"><span className="block text-sm">{a.token}</span><span className="block truncate text-xs text-muted">{a.name}</span></span>
          </div>)}
        </div>}
        {groups.map((group) => (
          <div key={group.key} role="group" aria-labelledby={`${id}-${group.key}`} className="grid gap-0.5">
            <div role="presentation" id={`${id}-${group.key}`} className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-subtle">
              {group.label}
            </div>
            {group.rows.map((g) => {
              const ref = g.ref as Reference;
              const kind = ref.kind === "video" ? t("picker.kind", { kind: "video", seconds: format.number(ref.seconds) }) : t("picker.kind", { kind: "image" });
              return (
                <div
                  key={g.id}
                  id={optionId(g)}
                  role="option"
                  aria-selected={g.id === active}
                  // A press would move focus out of the prompt, whose blur closes the list before the click picks.
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  onPointerMove={() => g.id !== active && hover(g)}
                  onClick={() => pick(g)}
                  className="flex min-h-14 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-foreground-2 aria-selected:bg-white/10 aria-selected:text-foreground"
                >
                  <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded-md bg-surface-2">
                    {ref.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ref.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <video src={ref.url} muted playsInline preload="metadata" aria-hidden className="h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className={`truncate text-sm ${g.prompt ? "" : "text-muted"}`}>{g.prompt || tGeneration("noPrompt")}</span>
                    <span className="truncate text-xs tabular-nums text-subtle">{[describeModel(g.modelId).name, kind, ago(format, g.completedAt ?? g.createdAt, openedAt)].join(" · ")}</span>
                  </span>
                  {attached.has(ref.url) && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
                      <Icon name="check" />
                      {t("picker.attached")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {status && (
        <p role="status" className="px-3 py-2 text-xs text-subtle">
          {status}
        </p>
      )}
      {note && <p className="border-t border-border px-3 py-2 text-[11px] text-subtle">{note}</p>}
    </div>
  );
}
