"use client";

import { memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { describeModel, modelLine, type Mode } from "@/lib/catalog";
import { appError } from "@/lib/errors";
import type { PublicGeneration } from "@/lib/generations";
import { isLive } from "@/lib/generation-status";
import { FEED_LIMIT } from "@/lib/thread-feeds";
import { StatusBadge } from "@/components/StatusBadge";
import { Icon } from "@/components/icons";
import { ratioOf, useSettingsSummary } from "@/components/settings-summary";
import { useErrorText } from "@/i18n/errors";
import { usd } from "@/i18n/format";

export type StreamHandle = { toEnd: () => void };

const PINNED_PX = 80;
const MEDIA_MAX_H = "min(60dvh, 560px)";
const ACTION =
  "inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-xs text-foreground-2 transition hover:bg-white/10 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-8";

function fmtElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Elapsed({ since, offset }: { since: number; offset: RefObject<number> }) {
  const [now, setNow] = useState(() => Date.now() + offset.current);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => window.clearInterval(t);
  }, [offset]);
  return <>{fmtElapsed(now - since)}</>;
}

/** cleanupRefs deletes a row's uploads once it finishes, so a broken one keeps only its label. */
function RefThumb({ url, video, label }: { url: string; video: boolean; label: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <li className="relative h-8 w-14 overflow-hidden rounded-xs bg-surface">
      {!broken &&
        (video ? (
          <video src={url} muted playsInline preload="metadata" aria-hidden onError={() => setBroken(true)} className="h-full w-full object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        ))}
      <span aria-hidden className="font-display absolute left-1 top-0.5 text-[11px] leading-none text-foreground drop-shadow">{label}</span>
    </li>
  );
}

type TurnProps = { g: PublicGeneration; n: number; offset: RefObject<number>; onCancel: (g: PublicGeneration) => void; onReuse: (g: PublicGeneration) => void };

const Turn = memo(function Turn({ g, n, offset, onCancel, onReuse }: TurnProps) {
  const t = useTranslations("playground");
  const tGeneration = useTranslations("generation");
  const tStatus = useTranslations("status");
  const tMode = useTranslations("mode");
  const format = useFormatter();
  const errorText = useErrorText();
  const summary = useSettingsSummary();
  const m = describeModel(g.modelId);
  const live = isLive(g.status);
  const isImage = m.output === "image";
  const label = tStatus(g.status);
  const started = new Date(g.createdAt).getTime();
  const params = g.params as Record<string, unknown>;
  const settings = m.family && m.mode ? summary(m.family, m.mode, params) : "";
  const [w, h] = ratioOf(params.aspect_ratio) ?? [16, 9];
  const media = g.video ?? g.image;
  const frames = m.mode === "i2v";
  const refs = [...g.imageRefs.map((url, i) => ({ url, video: false, label: frames ? t("feed.frame", { slot: i === 0 ? "start" : "end" }) : String(i + 1) })), ...g.videoRefs.map((url, i) => ({ url, video: true, label: `V${i + 1}` }))];
  const cost = live || g.status === "completed" ? usd(format, g.costUsd) : null;

  return (
    <article data-id={g.id} aria-label={t("feed.item", { n: String(n), status: label })} className="grid gap-2.5">
      <div className="flex justify-end">
        <div className="grid max-w-[min(620px,92%)] gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5">
          <p className={`max-h-60 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere] ${g.prompt ? "text-foreground" : "text-muted"}`}>{g.prompt || tGeneration("noPrompt")}</p>
          {refs.length > 0 && (
            <ul aria-label={t("feed.refsLabel", { images: g.imageRefs.length, videos: g.videoRefs.length })} className="flex flex-wrap gap-1.5">
              {refs.map((r) => (
                <RefThumb key={r.url} {...r} />
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted">
            <span className="min-w-0">{[modelLine(g.modelId, (mode: Mode) => tMode(mode)), settings].filter(Boolean).join(" · ")}</span>
            {cost && (
              <span>
                {live && <span className="mr-1">{t("feed.estimated")}</span>}
                <span className="font-display text-sm leading-none text-sand">{cost}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-2">
        <div className="relative overflow-hidden rounded-md bg-surface" style={{ aspectRatio: `${w} / ${h}`, width: `min(100%, 720px, calc(${MEDIA_MAX_H} * ${w / h}))` }}>
          {g.video ? (
            <video src={g.video.url} controls playsInline preload="metadata" aria-label={tGeneration("video")} className="h-full w-full object-contain" />
          ) : g.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={g.image.url} alt={tGeneration("image")} loading="lazy" className="h-full w-full object-contain" />
          ) : live ? (
            <div className="absolute inset-0 grid place-content-center justify-items-center gap-2 px-4 text-center">
              <span aria-hidden className="h-9 w-9 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground [animation-duration:1.4s]" />
              <span className="font-display text-5xl leading-none text-foreground">
                <Elapsed since={started} offset={offset} />
              </span>
              <span className="text-xs text-muted">{t("feed.elapsed", { status: label })}</span>
              {g.status === "pending" && <span className="max-w-xs text-xs text-muted">{t("feed.pendingNote")}</span>}
              {isImage && <span className="max-w-xs text-xs text-muted">{t("feed.imageNote")}</span>}
              <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-white/15" role="progressbar" aria-label={t("feed.progress")} aria-valuetext={t("feed.progressUnknown")}>
                <div className="travel h-full w-1/4 bg-foreground" />
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 grid place-content-center justify-items-center gap-2 px-6 text-center">
              <span className="text-2xl font-semibold tracking-tight text-foreground-2">{label}</span>
              <p className="max-w-md break-keep text-sm text-muted">{errorText(g.reason ?? appError("noResult", { kind: g.status === "canceled" ? "canceled" : isImage ? "image" : "video" }))}</p>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <StatusBadge status={g.status} />
          {!live && g.completedAt && <span className="tabular-nums">{t("feed.took", { elapsed: fmtElapsed(new Date(g.completedAt).getTime() - started) })}</span>}
          <span className="flex-1" />
          {(g.status === "pending" || g.status === "queued") && (
            <button type="button" onClick={() => onCancel(g)} className={ACTION}>
              <Icon name="x" />
              {t("actions.cancel")}
            </button>
          )}
          {media && (
            <a href={media.downloadUrl} download target="_blank" rel="noreferrer" className={ACTION}>
              <Icon name="down" />
              {tGeneration("download")}
              <span className="font-display text-sm leading-none text-sand">{g.image ? g.image.format.toUpperCase() : "MP4"}</span>
            </a>
          )}
          <button type="button" title={t("actions.reuseLabel")} onClick={() => onReuse(g)} className={ACTION}>
            <Icon name="redo" />
            {t("actions.reuse")}
          </button>
        </div>
      </div>
    </article>
  );
});

/** `rows` newest first, as the feeds hold them; shown oldest at the top. */
export function Stream({
  ref,
  threadKey,
  rows,
  more,
  offset,
  empty,
  onOlder,
  onCancel,
  onReuse,
}: {
  ref?: Ref<StreamHandle>;
  threadKey: string;
  rows: readonly PublicGeneration[];
  more: boolean;
  offset: RefObject<number>;
  empty: ReactNode;
  /** Loads the next older page; true when it added rows. */
  onOlder: () => Promise<boolean>;
  onCancel: (g: PublicGeneration) => void;
  onReuse: (g: PublicGeneration) => void;
}) {
  const t = useTranslations("playground");
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const restoreFromBottom = useRef<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const chronological = [...rows].reverse();

  const toEnd = (smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    pinned.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
  };
  useImperativeHandle(ref, () => ({ toEnd: () => toEnd() }));

  useLayoutEffect(() => {
    pinned.current = true;
    restoreFromBottom.current = null;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [threadKey]);

  // Only an older page changes the oldest row; a poll that updates rows in place must not spend the restore.
  const oldest = rows[rows.length - 1]?.id;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || restoreFromBottom.current === null) return;
    el.scrollTop = el.scrollHeight - restoreFromBottom.current;
    restoreFromBottom.current = null;
  }, [oldest]);

  useEffect(() => {
    const el = scroller.current;
    const body = content.current;
    if (!el || !body) return;
    // Observe the scroller too: it shrinks when the composer grows.
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(body);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const loading = useRef(false);
  const loadOlder = useRef(async () => {});
  useEffect(() => {
    loadOlder.current = async () => {
      const el = scroller.current;
      if (!el || loading.current) return;
      loading.current = true;
      restoreFromBottom.current = el.scrollHeight - el.scrollTop;
      setLoadingOlder(true);
      if (!(await onOlder())) restoreFromBottom.current = null;
      loading.current = false;
      setLoadingOlder(false);
    };
  }, [onOlder]);
  useEffect(() => {
    const el = scroller.current;
    const target = marker.current;
    if (!more || !el || !target) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && void loadOlder.current(), { root: el, rootMargin: "200px 0px 0px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, threadKey, rows.length]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        tabIndex={-1}
        aria-label={t("stream")}
        role="region"
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < PINNED_PX;
          pinned.current = bottom;
          if (bottom !== atBottom) setAtBottom(bottom);
        }}
        className="h-full overflow-y-auto overscroll-contain [overflow-anchor:none] focus:outline-none"
      >
        <div ref={content} className={`mx-auto grid min-h-full w-full max-w-[820px] grid-cols-[minmax(0,1fr)] gap-7 px-3 py-6 sm:px-4 ${rows.length === 0 ? "place-content-center" : "content-end"}`}>
          {rows.length === 0 ? (
            empty
          ) : (
            <>
              <div ref={marker} className="flex min-h-8 justify-center text-xs text-subtle">
                {more ? (
                  <button type="button" disabled={loadingOlder} onClick={() => void loadOlder.current()} className="inline-flex h-11 items-center rounded-full px-4 text-foreground-2 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60 sm:h-8">
                    {loadingOlder ? t("older.loading") : t("older.load")}
                  </button>
                ) : (
                  rows.length > FEED_LIMIT && <span>{t("older.start")}</span>
                )}
              </div>
              {chronological.map((g, i) => (
                <Turn key={g.id} g={g} n={i + 1} offset={offset} onCancel={onCancel} onReuse={onReuse} />
              ))}
            </>
          )}
        </div>
      </div>
      {!atBottom && rows.length > 0 && (
        <button type="button" onClick={() => toEnd(true)} className="absolute bottom-3 left-1/2 inline-flex h-11 -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-surface px-4 text-xs text-foreground transition hover:border-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-9">
          <Icon name="latest" />
          {t("latest")}
        </button>
      )}
    </div>
  );
}
