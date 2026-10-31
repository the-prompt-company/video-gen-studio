"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { flushSync } from "react-dom";
import type { Draft } from "@/lib/catalog";
import { caught, parseAppError, type Reason } from "@/lib/errors";
import type { PublicGeneration } from "@/lib/generations";
import { isLive } from "@/lib/generation-status";
import { FEED_LIMIT, withAnswer, withOlder, withoutThread, withRow, type Feeds } from "@/lib/thread-feeds";
import type { PublicThread } from "@/lib/threads";
import { ErrorText } from "@/components/ui";
import { Composer, type ComposerHandle, type Offer } from "@/components/Composer";
import { Icon } from "@/components/icons";
import { Stream, type StreamHandle } from "@/components/Stream";
import { DeleteThreadDialog, ThreadBar, ThreadColumn, useThreadName, type ListMode } from "@/components/Threads";
import { useErrorText } from "@/i18n/errors";

type FeedAnswer = { items?: PublicGeneration[]; more?: boolean; now?: number };

const POLL_FIRST_MS = 2000;
const POLL_MAX_MS = 10000;
const POLL_JITTER_MS = 400;
// One poll may wait out Higgsfield's 8 s status timeout. A request still unanswered after this is aborted, because one
// that never answers would otherwise stop polling until a reload.
const POLL_TIMEOUT_MS = 10_000;
const STORE_WAIT_MS = 120_000;
/** The server answers at most this many ids per poll. */
const MAX_POLL_IDS = 24;

const NO_ROWS: readonly PublicGeneration[] = [];
const newThreadId = () => crypto.randomUUID();

/** A queued or running row, or a finished one whose copy into storage is still expected. */
function polled(item: PublicGeneration, now: number) {
  return isLive(item.status) || (item.video?.kind === "provider" && item.video.storing && now - new Date(item.completedAt ?? item.createdAt).getTime() < STORE_WAIT_MS);
}

export function Playground({
  offers,
  largeUploadPrefix,
  galleryCount,
  threads: initialThreads,
  initialThread,
}: {
  offers: Offer[];
  largeUploadPrefix: string | null;
  galleryCount: number;
  threads: PublicThread[];
  initialThread: string | null;
}) {
  const t = useTranslations("playground");
  const tPages = useTranslations("pages");
  const tThreads = useTranslations("threads");
  const errorText = useErrorText();

  // A pick moves the stream at once, before the router commits. After that the address bar decides, read whenever the
  // router's search changes (a link to /playground keeps this instance) and on Back and Forward. useSearchParams alone
  // can still hold an older search while Back's server request is out.
  const [threadParam, setThreadParam] = useState(initialThread);
  const routerSearch = useSearchParams().toString();
  useEffect(() => {
    const follow = () => setThreadParam(new URL(window.location.href).searchParams.get("thread"));
    follow();
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, [routerSearch]);
  // Through the router, not history.pushState: a raw push that lands while Back's request is out stops the router from
  // committing any later navigation, the header's links included.
  const router = useRouter();
  function showThread(thread: string | null, entry: "push" | "replace") {
    const url = thread === null ? window.location.pathname : `${window.location.pathname}?thread=${thread}`;
    setThreadParam(thread);
    router[entry](url, { scroll: false });
  }
  // The server's list replaces this tab's whenever the page renders again, which a link to /playground does.
  // A thread deleted in this tab stays off the list even when a later answer still names it.
  const [known, setKnown] = useState(initialThreads);
  const [served, setServed] = useState(initialThreads);
  if (initialThreads !== served) {
    setServed(initialThreads);
    setKnown(initialThreads);
  }
  const [deletedHere, setDeletedHere] = useState<ReadonlySet<string>>(() => new Set());
  const threads = useMemo(() => known.filter((x) => !deletedHere.has(x.id)), [known, deletedHere]);
  const [draftId, setDraftId] = useState(newThreadId);
  const [deleting, setDeleting] = useState<PublicThread | null>(null);
  const [listMode, setListMode] = useState<ListMode>("auto");
  const threadName = useThreadName();
  const selected = threadParam === null ? null : (threads.find((x) => x.id === threadParam) ?? null);
  const selectedId = selected?.id ?? null;
  const stageThread = selectedId ?? draftId;
  const stageThreadRef = useRef(stageThread);
  useEffect(() => {
    stageThreadRef.current = stageThread;
  }, [stageThread]);

  // The gallery count shares the feeds' state so one pure update moves both; React may run an updater twice.
  const [feeds, setFeeds] = useState<Feeds>({ byThread: {}, galleryTotal: galleryCount });
  const feedsRef = useRef(feeds);
  useEffect(() => {
    feedsRef.current = feeds;
  }, [feeds]);
  const { galleryTotal } = feeds;
  const feed = feeds.byThread[stageThread];
  const items = feed?.rows ?? NO_ROWS;
  const [loadFailure, setLoadFailure] = useState<{ thread: string; reason: Reason } | null>(null);
  const failed = loadFailure?.thread === stageThread ? loadFailure.reason : null;
  const loaded = stageThread in feeds.byThread || selectedId === null || failed !== null;
  // Server clock minus this browser's clock. Rows carry the database's created_at, and a member's computer clock can
  // be seconds off, so the elapsed times count on the server's clock.
  const clockOffset = useRef(0);
  const pollDelay = useRef(POLL_FIRST_MS);
  const composer = useRef<ComposerHandle>(null);
  const stream = useRef<StreamHandle>(null);

  function upsert(item: PublicGeneration, thread = stageThreadRef.current) {
    setFeeds((feeds) => withRow(feeds, item, thread));
  }

  // The answer's `now` is taken as the request's midpoint, so the offset is off by at most half the round trip.
  const [answeredAt, setAnsweredAt] = useState(() => Date.now());
  function syncClock(sentAt: number, serverNow: number | undefined) {
    setAnsweredAt(Date.now());
    if (serverNow !== undefined) clockOffset.current = serverNow - (sentAt + Date.now()) / 2;
  }

  useEffect(() => {
    if (selectedId === null) return;
    let current = true;
    const sentAt = Date.now();
    fetch(`/api/generations?thread=${selectedId}&limit=${FEED_LIMIT}`)
      .then(async (r) => ({ status: r.status, body: (await r.json().catch(() => null)) as FeedAnswer | null }))
      .then(({ status, body }) => {
        if (!current) return;
        if (status === 404) return setKnown((list) => list.filter((x) => x.id !== selectedId));
        if (status !== 200) return setLoadFailure({ thread: selectedId, reason: parseAppError(body, status) });
        syncClock(sentAt, body?.now);
        setLoadFailure(null);
        setFeeds((feeds) => withAnswer(feeds, selectedId, body?.items ?? [], body?.more ?? false));
      })
      .catch(() => current && setLoadFailure({ thread: selectedId, reason: { code: "network" } }));
    return () => {
      current = false;
    };
  }, [selectedId]);

  const loadOlder = useCallback(async (): Promise<boolean> => {
    const thread = stageThreadRef.current;
    const oldest = feedsRef.current.byThread[thread]?.rows.at(-1);
    if (!oldest) return false;
    const res = await fetch(`/api/generations?thread=${thread}&limit=${FEED_LIMIT}&before=${oldest.id}`).catch(() => null);
    const body = (await res?.json().catch(() => null)) as FeedAnswer | null;
    if (!res?.ok || !body?.items || stageThreadRef.current !== thread) return false;
    setFeeds((feeds) => withOlder(feeds, thread, body.items ?? [], body.more ?? false));
    return body.items.length > 0;
  }, [feedsRef, stageThreadRef]);

  // Every thread this tab has shown keeps its live rows polled, the stream's first, so results that finish elsewhere
  // still count in the gallery link. A finished row stays in the poll set while the server still expects to copy it,
  // so the stored URL replaces the provider URL without a reload. The window bounds a copy that keeps failing.
  const offStream = Object.entries(feeds.byThread).flatMap(([thread, f]) => (thread === stageThread ? [] : f.rows));
  const liveKey = [...items, ...offStream]
    .filter((i) => polled(i, answeredAt))
    .slice(0, MAX_POLL_IDS)
    .map((i) => i.id)
    .join(",");

  // The delay lives in a ref so a change in the live set does not restart the backoff; only this tab's own submit
  // does. Each wait counts from the request start, and jitter never compounds into the next delay.
  useEffect(() => {
    if (!liveKey) return;
    let stopped = false;
    let t = 0;
    let inflight: AbortController | null = null;
    const wait = (ms: number) => {
      t = window.setTimeout(tick, Math.max(0, ms + (Math.random() - 0.5) * POLL_JITTER_MS));
    };
    const tick = async () => {
      const started = Date.now();
      const request = new AbortController();
      inflight = request;
      const timeout = window.setTimeout(() => request.abort(), POLL_TIMEOUT_MS);
      const body = await fetch(`/api/generations?ids=${liveKey}`, { cache: "no-store", signal: request.signal })
        .then((res) => res.json() as Promise<FeedAnswer>)
        .catch(() => null);
      window.clearTimeout(timeout);
      if (stopped) return;
      syncClock(started, body?.now);
      body?.items?.forEach((item) => upsert(item));
      pollDelay.current = Math.min(POLL_MAX_MS, pollDelay.current * 1.5);
      wait(pollDelay.current - (Date.now() - started));
    };
    wait(pollDelay.current);
    return () => {
      stopped = true;
      window.clearTimeout(t);
      inflight?.abort();
    };
  }, [liveKey]);

  async function submit(draft: Draft): Promise<Reason | null> {
    const target = stageThread;
    const opensDraft = selectedId === null;
    try {
      const res = await fetch("/api/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, thread: target }),
      });
      const body = (await res.json().catch(() => null)) as { item?: PublicGeneration; thread?: PublicThread } | null;
      const item = body?.item;
      const thread = body?.thread;
      if (item && thread) {
        setKnown((list) => [thread, ...list.filter((x) => x.id !== thread.id)]);
        pollDelay.current = POLL_FIRST_MS;
        if (stageThreadRef.current === target) {
          // The new turn must be in the DOM before the stream scrolls to it.
          flushSync(() => upsert(item, target));
          stream.current?.toEnd();
          if (opensDraft) showThread(thread.id, "replace");
        } else {
          upsert(item, target);
        }
        // The draft id now names a thread, so the next new thread needs its own.
        if (opensDraft) setDraftId(newThreadId());
      }
      // A refused submit still returns its row, whose reason says why it failed.
      if (!res.ok || !item) return item?.reason ?? parseAppError(body, res.status);
      return null;
    } catch (e) {
      return caught(e);
    }
  }

  const [cancelError, setCancelError] = useState<Reason | null>(null);
  const cancel = useCallback(async (g: PublicGeneration) => {
    setCancelError(null);
    try {
      const res = await fetch(`/api/generations/${g.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { item?: PublicGeneration; error?: unknown } | null;
      if (body?.item) setFeeds((feeds) => withRow(feeds, body.item as PublicGeneration, stageThreadRef.current));
      if (!res.ok) setCancelError(parseAppError(body, res.status));
    } catch {
      setCancelError({ code: "network" });
    }
  }, [stageThreadRef]);
  const reuse = useCallback((g: PublicGeneration) => composer.current?.reuse(g), [composer]);

  function pickThread(id: string) {
    if (id !== threadParam) showThread(id, "push");
  }

  function startThread() {
    setDraftId(newThreadId());
    if (threadParam !== null) showThread(null, "push");
  }

  function threadDeleted(id: string) {
    setDeleting(null);
    setDeletedHere((ids) => new Set(ids).add(id));
    setFeeds((feeds) => withoutThread(feeds, id));
    if (id === threadParam) {
      setDraftId(newThreadId());
      showThread(null, "replace");
    }
    // The delete button that opened the dialog is gone with its row, so focus moves to the visible new-thread button.
    requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>("[data-new-thread]")].find((el) => el.offsetParent !== null)?.focus());
  }

  if (offers.length === 0) return <div className="p-8 text-center text-sm text-subtle">{t("noModels")}</div>;

  const missing = threadParam !== null && selected === null;
  const title = selected ? threadName(selected) : tThreads("fresh.title");
  const threadList = { threads, currentId: selectedId, onPick: pickThread, onNew: startThread, onDelete: setDeleting };
  const gallery = (
    <Link
      href="/gallery"
      aria-label={t("galleryCount", { count: galleryTotal })}
      className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs text-foreground-2 transition hover:bg-white/10 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:h-9"
    >
      <Icon name="grid" />
      <span className="hidden sm:inline">{tPages("gallery")}</span>
      <span className="font-display text-base leading-none text-sand">{galleryTotal > 0 ? galleryTotal : "—"}</span>
    </Link>
  );
  const empty = failed ? (
    <div className="max-w-md">
      <ErrorText>{errorText(failed)}</ErrorText>
    </div>
  ) : loaded ? (
    <div className="grid max-w-md justify-items-center gap-3 text-center">
      <p className="text-xl font-semibold text-foreground sm:text-2xl">{missing ? tThreads("missing.title") : threads.length > 0 ? tThreads("fresh.title") : t("empty.title")}</p>
      <p className="break-keep text-sm text-muted">{missing ? tThreads("missing.lead") : threads.length > 0 ? tThreads("fresh.lead") : t("empty.lead")}</p>
    </div>
  ) : (
    <p className="text-sm text-muted">{t("loading")}</p>
  );

  return (
    <div data-fill-viewport className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <h1 className="sr-only">{tPages("playground")}</h1>
      <ThreadColumn {...threadList} mode={listMode} onMode={setListMode} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ThreadBar {...threadList} title={selected ? threadName(selected) : tThreads("label")} trailing={gallery} />
        <div className="hidden h-12 shrink-0 items-center gap-3 border-b border-border pl-5 pr-3 lg:flex">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</p>
          {gallery}
        </div>
        <Stream ref={stream} threadKey={stageThread} rows={items} more={feed?.more ?? false} offset={clockOffset} empty={empty} onOlder={loadOlder} onCancel={cancel} onReuse={reuse} />
        {cancelError && (
          <div className="mx-auto w-full max-w-[820px] px-3 sm:px-4">
            <ErrorText>{errorText(cancelError)}</ErrorText>
          </div>
        )}
        <Composer ref={composer} offers={offers} largeUploadPrefix={largeUploadPrefix} onSubmit={submit} />
      </div>
      {deleting && <DeleteThreadDialog thread={deleting} onClose={() => setDeleting(null)} onDeleted={threadDeleted} />}
    </div>
  );
}
