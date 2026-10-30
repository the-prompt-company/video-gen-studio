"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { PublicGeneration } from "@/lib/generations";
import { modelLine } from "@/lib/catalog";
import { Button, Empty } from "@/components/ui";
import { useParamLabel } from "@/i18n/errors";
import { ago, dateTime, usd } from "@/i18n/format";

/** A stored video or an image is kept for good. A Higgsfield video is deleted at `until`. */
type Retention = { kind: "permanent" } | ({ until: Date } & ({ kind: "expired" } | { kind: "days"; days: number } | { kind: "hours"; hours: number }));

function retentionOf(g: PublicGeneration, now: number): Retention | null {
  if (g.image || g.video?.kind === "stored") return { kind: "permanent" };
  if (!g.video?.expiresAt) return null;
  const until = new Date(g.video.expiresAt);
  const ms = until.getTime() - now;
  if (ms <= 0) return { kind: "expired", until };
  const days = Math.floor(ms / 86400_000);
  return days > 0 ? { kind: "days", days, until } : { kind: "hours", hours: Math.floor(ms / 3600_000), until };
}

function useRetentionText() {
  const t = useTranslations("gallery.retention");
  return (r: Retention) => (r.kind === "days" ? t("days", { days: r.days }) : r.kind === "hours" ? t("hours", { hours: r.hours }) : t(r.kind));
}

/** "16:9" from params when the model exposes it, otherwise from the loaded video's pixels. */
function aspectLabel(g: PublicGeneration, w?: number, h?: number): string | null {
  const p = (g.params as Record<string, unknown>)?.aspect_ratio;
  if (typeof p === "string" && /^\d+:\d+$/.test(p)) return p;
  if (!w || !h) return null;
  const r = w / h;
  if (Math.abs(r - 16 / 9) < 0.05) return "16:9";
  if (Math.abs(r - 9 / 16) < 0.05) return "9:16";
  if (Math.abs(r - 1) < 0.05) return "1:1";
  if (Math.abs(r - 21 / 9) < 0.08) return "21:9";
  return `${w}×${h}`;
}

function shapeOf(label: string | null): "landscape" | "portrait" | "square" | null {
  if (!label) return null;
  const [a, b] = label.split(/[:×]/).map(Number);
  if (!a || !b) return null;
  return a > b ? "landscape" : a < b ? "portrait" : "square";
}

/* One tile: the video is contained, never cropped, so a 9:16 result reads as 9:16 inside the 16:9 frame. */
function useVideoSize() {
  const ref = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const read = () => {
    const v = ref.current;
    if (v && v.videoWidth && v.videoHeight) setSize({ w: v.videoWidth, h: v.videoHeight });
  };
  useEffect(read, []);
  return { ref, size, read };
}

/** True once the element has come within rootMargin of the viewport, and stays true. */
function useNearViewport<T extends Element>(rootMargin: string) {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, rootMargin]);
  return { ref, near };
}

function Tile({ g, now, onOpen }: { g: PublicGeneration; now: number; onOpen: () => void }) {
  const t = useTranslations("gallery");
  const tGen = useTranslations("generation");
  const tMode = useTranslations("mode");
  const retentionText = useRetentionText();
  const format = useFormatter();
  const { ref, size, read } = useVideoSize();
  const { ref: tileRef, near } = useNearViewport<HTMLLIElement>("0px 0px 80px 0px");
  const label = aspectLabel(g, size?.w, size?.h);
  const prompt = g.prompt || tGen("noPrompt");
  const keep = retentionOf(g, now);
  return (
    <li ref={tileRef} className="group overflow-hidden rounded-xl border border-border bg-surface">
      <button type="button" onClick={onOpen} className="relative block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" aria-label={t("openDetail", { prompt })}>
        {g.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={near ? g.image.url : undefined} alt="" className="aspect-video w-full bg-background object-contain" />
        ) : (
          <video
            ref={ref}
            src={near ? g.video?.url : undefined}
            muted
            loop
            playsInline
            preload="metadata"
            className="aspect-video w-full bg-background object-contain"
            onLoadedMetadata={read}
            onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => e.currentTarget.pause()}
          />
        )}
        {label && (
          <span className="font-display absolute left-2 top-2 rounded-sm bg-background/80 px-1.5 pt-0.5 text-[14px] leading-none text-sand">
            {label}
          </span>
        )}
        <span className="font-display absolute right-2 top-2 rounded-sm bg-background/80 px-1.5 pt-0.5 text-[14px] leading-none text-foreground-2">{g.image ? g.image.format.toUpperCase() : `${g.durationS}S`}</span>
      </button>
      <div className="space-y-1.5 p-3">
        <p className="line-clamp-2 text-sm text-foreground-2">{prompt}</p>
        <div className="flex items-center justify-between gap-2 text-[11px] text-subtle">
          <span className="truncate">
            {modelLine(g.modelId, (m) => tMode(m))} · <span className="tabular-nums">{usd(format, g.costUsd)}</span>
          </span>
          <span className="shrink-0">{g.username ? `${g.username} · ` : ""}{ago(format, g.createdAt, now)}</span>
        </div>
        {keep && <div className={`text-[11px] ${keep.kind === "expired" ? "text-rose-300" : "text-subtle"}`}>{t("retention.line", { value: retentionText(keep) })}</div>}
      </div>
    </li>
  );
}

function Detail({ g, now, onClose }: { g: PublicGeneration; now: number; onClose: () => void }) {
  const t = useTranslations("gallery");
  const tGen = useTranslations("generation");
  const tCommon = useTranslations("common");
  const tStatus = useTranslations("status");
  const tMode = useTranslations("mode");
  const paramLabel = useParamLabel();
  const retentionText = useRetentionText();
  const format = useFormatter();
  const { ref, size: videoSize, read } = useVideoSize();
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const size = videoSize ?? imageSize;
  const label = aspectLabel(g, size?.w, size?.h);
  const shape = shapeOf(label);
  const keep = retentionOf(g, now);
  const params = Object.entries((g.params as Record<string, unknown>) ?? {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t("detail.title")} className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-[58dvh] min-h-[240px] shrink-0 items-center justify-center overflow-hidden bg-background">
          {g.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={g.image.url}
              alt={tGen("image")}
              className="h-full w-full object-contain"
              onLoad={(e) => setImageSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            />
          ) : (
            <video
              ref={ref}
              src={g.video?.url}
              controls
              autoPlay
              loop
              playsInline
              className="h-full w-full object-contain"
              onLoadedMetadata={read}
              aria-label={tGen("video")}
            />
          )}
        </div>
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-[minmax(0,1fr)_200px]">
          <div className="min-w-0 space-y-4">
            <div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
                <span className="text-foreground-2">{modelLine(g.modelId, (m) => tMode(m))}</span>
                {label && (
                  <span className="font-display text-[15px] text-sand">
                    {label}
                    {shape && <span className="ml-1 font-sans text-xs text-muted">{tGen("shape", { shape })}</span>}
                  </span>
                )}
                {size && <span className="tabular-nums">{size.w}×{size.h}</span>}
                <span className="font-display text-[15px] text-sand">{g.image ? usd(format, g.costUsd) : `${g.durationS}S · ${usd(format, g.costUsd)}`}</span>
                <span>{tStatus(g.status)}</span>
              </div>
              <p className="mt-2 break-words text-sm leading-relaxed text-foreground">{g.prompt || tGen("noPrompt")}</p>
            </div>

            {(g.imageRefs.length > 0 || g.videoRefs.length > 0) && (
              <div>
                <h3 className="mb-2 text-xs font-medium text-muted">{t("detail.refs", { images: g.imageRefs.length, videos: g.videoRefs.length })}</h3>
                <ul className="flex flex-wrap gap-2">
                  {g.imageRefs.map((u, i) => (
                    <li key={u} className="relative h-20 overflow-hidden rounded-md border border-border bg-background">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={tGen("imageRef", { n: String(i + 1) })} className="h-full w-auto object-contain" />
                      <span aria-hidden className="font-display absolute left-1 top-0.5 text-[13px] text-foreground drop-shadow">{i + 1}</span>
                    </li>
                  ))}
                  {g.videoRefs.map((u, i) => (
                    <li key={u} className="relative h-20 overflow-hidden rounded-md border border-border bg-background">
                      <video src={u} muted playsInline preload="metadata" className="h-full w-auto object-contain" aria-label={tGen("videoRef", { n: String(i + 1) })} onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
                      <span aria-hidden className="font-display absolute left-1 top-0.5 text-[13px] text-foreground drop-shadow">V{i + 1}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
              {params.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{paramLabel(k)}</dt>
                  <dd className="break-words tabular-nums text-foreground-2">{typeof v === "boolean" ? t(v ? "detail.on" : "detail.off") : String(v)}</dd>
                </div>
              ))}
              <dt className="text-muted">{t("detail.created")}</dt>
              <dd className="tabular-nums text-foreground-2">{dateTime(format, g.createdAt)}</dd>
              {g.completedAt && (
                <>
                  <dt className="text-muted">{t("detail.completed")}</dt>
                  <dd className="tabular-nums text-foreground-2">{dateTime(format, g.completedAt)}</dd>
                </>
              )}
              {keep && (
                <>
                  <dt className="text-muted">{t("retention.label")}</dt>
                  <dd className="tabular-nums text-foreground-2">{keep.kind === "permanent" ? retentionText(keep) : t("retention.until", { date: dateTime(format, keep.until), left: retentionText(keep) })}</dd>
                </>
              )}
              {g.username && (
                <>
                  <dt className="text-muted">{t("detail.member")}</dt>
                  <dd className="text-foreground-2">{g.username}</dd>
                </>
              )}
            </dl>
          </div>
          <div className="flex gap-2 md:flex-col">
            {(g.image ?? g.video) && (
              <a href={(g.image ?? g.video)?.downloadUrl} download target="_blank" rel="noreferrer" className="inline-flex h-10 flex-1 items-center justify-center rounded-full bg-accent px-5 text-sm font-medium text-background transition hover:bg-accent-hover md:flex-none">
                {tGen("download")}
              </a>
            )}
            <Button variant="outline" onClick={onClose} className="flex-1 md:flex-none">
              {tCommon("close")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** `now` is when the page was rendered. Ages and time left count from it, so the server and the browser print the same text. */
export function Gallery({ items, isAdmin, showAll, now }: { items: PublicGeneration[]; isAdmin: boolean; showAll: boolean; now: number }) {
  const t = useTranslations("gallery");
  const tPages = useTranslations("pages");
  const [open, setOpen] = useState<PublicGeneration | null>(null);
  const expiring = items.some((g) => g.video?.kind === "provider");

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{tPages("gallery")}</h1>
          <p className="mt-1 text-sm text-muted">{t("lead", { count: items.length, expiring: expiring ? "yes" : "no" })}</p>
        </div>
        {isAdmin && (
          <div className="flex rounded-full border border-border p-0.5 text-sm">
            <Link href="/gallery" className={`rounded-full px-3 py-1 ${!showAll ? "bg-white/12 text-foreground" : "text-muted"}`}>
              {t("scope.mine")}
            </Link>
            <Link href="/gallery?all=1" className={`rounded-full px-3 py-1 ${showAll ? "bg-white/12 text-foreground" : "text-muted"}`}>
              {t("scope.all")}
            </Link>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <Empty>
          {t.rich("empty", {
            link: (chunks) => (
              <Link href="/playground" className="text-accent-soft underline-offset-4 hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((g) => (
            <Tile key={g.id} g={g} now={now} onOpen={() => setOpen(g)} />
          ))}
        </ul>
      )}

      {open && <Detail g={open} now={now} onClose={() => setOpen(null)} />}
    </div>
  );
}
