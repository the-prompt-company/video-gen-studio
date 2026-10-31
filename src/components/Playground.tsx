"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { flushSync } from "react-dom";
import {
  defaultParams,
  describeModel,
  FAMILIES,
  modelLine,
  modesOf,
  paramsFor,
  planGeneration,
  type Draft,
  type Fact,
  type FamilyId,
  type Mode,
  type ParamSpec,
} from "@/lib/catalog";
import { ApiError, appError, caught, parseAppError, type Reason } from "@/lib/errors";
import type { PublicGeneration, Unavailable } from "@/lib/generations";
import { isLive } from "@/lib/generation-status";
import { refUploadName } from "@/lib/ref-name";
import { FEED_LIMIT, withAnswer, withoutThread, withRow, type Feeds } from "@/lib/thread-feeds";
import type { PublicThread } from "@/lib/threads";
import { Button, ErrorText, Field, Input, Select, Textarea } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { DeleteThreadDialog, ThreadBar, ThreadColumn, useThreadName, type ListMode } from "@/components/Threads";
import { useErrorText, useParamLabel, type KeyTranslator } from "@/i18n/errors";
import { usd } from "@/i18n/format";

/**
 * `unavailable` 503: the server cannot run the model at all, so it is listed but cannot be picked. 403: this member
 * has no key for it, and the drawer says so while the Generate button stays off.
 */
type Offer = { family: FamilyId; rateUsd: number; unavailable: Unavailable | null };
type Ref = { id: string; url: string; name: string; kind: "image" | "video"; local?: string; w?: number; h?: number; seconds?: number };
type FeedAnswer = { items?: PublicGeneration[]; now?: number };
type Shape = "landscape" | "portrait" | "square";
type PlaygroundText = ReturnType<typeof useTranslations<"playground">>;

function modeSentence(t: PlaygroundText, mode: Mode, images: number, videos: number) {
  switch (mode) {
    case "t2v":
    case "t2i":
      return t("modeSentence.text");
    case "i2v":
      return t("modeSentence.firstFrame");
    case "r2i":
      return t("modeSentence.edit", { images });
    case "r2v":
      return t("modeSentence.reference", { refs: images > 0 && videos > 0 ? "both" : images > 0 ? "images" : "videos", images, videos });
  }
}

function shapeOf(w?: number, h?: number): Shape | null {
  if (!w || !h) return null;
  const r = w / h;
  return r > 1.05 ? "landscape" : r < 0.95 ? "portrait" : "square";
}

/** "16:9" is landscape. "auto" and anything else that is not a ratio has no shape. */
function ratioShape(ratio: string): Shape | null {
  const m = /^(\d+):(\d+)$/.exec(ratio);
  return m ? shapeOf(Number(m[1]), Number(m[2])) : null;
}

function readImageSize(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function readVideoSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    const done = (s: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(s);
    };
    v.preload = "metadata";
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null);
    v.onerror = () => done(null);
    window.setTimeout(() => done(null), 10_000);
    v.src = url;
  });
}

const DRAWER_ID = "generation-settings";
const SMALL = 4 * 1024 * 1024;
const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
const POLL_FIRST_MS = 2000;
const POLL_MAX_MS = 10000;
const POLL_JITTER_MS = 400;
// One poll may wait out Higgsfield's 8 s status timeout. A request still unanswered after this is aborted, because one
// that never answers would otherwise stop polling until a reload.
const POLL_TIMEOUT_MS = 10_000;
const STORE_WAIT_MS = 120_000;

/**
 * With no `blobPrefix`, the file goes through the server to Higgsfield's storage with the member's key. With one, it
 * goes straight to Blob: an OpenAI model's references always do, so no Higgsfield key is involved, and so does any
 * file over 4 MB.
 */
async function uploadFile(file: File, blobPrefix: string | null): Promise<string> {
  if (blobPrefix === null) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    const body = (await res.json().catch(() => null)) as { url?: string } | null;
    if (res.ok && body?.url) return body.url;
    const error = parseAppError(body, res.status);
    // Vercel answers a body over its 4.5 MB limit itself, with no error code.
    throw new ApiError(error.code === "httpStatus" && res.status === 413 ? appError("uploadTooLarge", { mb: SMALL / 1024 / 1024 }) : error);
  }
  const { upload: blobUpload } = await import("@vercel/blob/client");
  const blob = await blobUpload(`${blobPrefix}${refUploadName(file.name)}`, file, { access: "public", handleUploadUrl: "/api/uploads/blob", multipart: true });
  return blob.url;
}

/** "jpeg · png · webp", the way the file pickers list what they take. */
function typeList(types: readonly string[]) {
  return types.map((t) => t.replace(/^image\//, "")).join(" · ");
}

function fmtElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ParamInput({ spec, value, onChange }: { spec: ParamSpec; value: unknown; onChange: (v: unknown) => void }) {
  const label = useParamLabel()(spec.key);
  const tValues = useTranslations("paramValues") as unknown as KeyTranslator;
  switch (spec.type) {
    case "int": {
      const isRange = spec.max - spec.min <= 100;
      return (
        <Field label={label} hint={isRange ? String(value) : `${spec.min}~${spec.max}`}>
          {isRange ? (
            <input type="range" min={spec.min} max={spec.max} step={1} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
          ) : (
            <Input type="number" min={spec.min} max={spec.max} value={String(value)} onChange={(e) => onChange(e.target.value)} />
          )}
        </Field>
      );
    }
    case "bool":
      return (
        <label className="flex min-h-11 items-center gap-2 text-sm text-foreground-2">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
          {label}
        </label>
      );
    case "enum":
      return (
        <Field label={label}>
          <Select value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {spec.options.map((o) => (
              <option key={o} value={o}>{tValues.has(spec.key) ? tValues(spec.key, { value: o }) : o}</option>
            ))}
          </Select>
        </Field>
      );
  }
}

/* Rail glyph: circular white-outline control with a display counter and a label. */
function Glyph({ label, counter, icon, active, disabled, onClick, href, download }: { label: string; counter: string; icon: React.ReactNode; active?: boolean; disabled?: boolean; onClick?: () => void; href?: string; download?: boolean }) {
  const cls = `grid h-11 w-11 place-items-center rounded-full border-[1.5px] lg:h-13 lg:w-13 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
    active ? "border-foreground bg-foreground text-background hover:bg-accent-hover" : "border-foreground/80 text-foreground hover:bg-white/15"
  } ${disabled ? "cursor-not-allowed opacity-35" : ""}`;
  const body = (
    <>
      <span aria-hidden className="h-5 w-5">{icon}</span>
    </>
  );
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      {href && !disabled ? (
        download ? (
          <a href={href} download target="_blank" rel="noreferrer" className={cls} aria-label={label}>{body}</a>
        ) : (
          <Link href={href} className={cls} aria-label={label}>{body}</Link>
        )
      ) : (
        <button type="button" onClick={onClick} disabled={disabled} className={cls} aria-label={label}>{body}</button>
      )}
      <span className="font-display text-base leading-none text-sand">{counter}</span>
      <span className="text-[11px] leading-none text-muted">{label}</span>
    </div>
  );
}

const svg = (d: string) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d={d} />
  </svg>
);
const I = {
  play: svg("M6.5 4.5v11l9-5.5z"),
  x: svg("M5.5 5.5l9 9M14.5 5.5l-9 9"),
  down: svg("M10 3.5v10m0 0l-4-4m4 4l4-4M4.5 16.5h11"),
  grid: svg("M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z"),
  redo: svg("M4.5 10a5.5 5.5 0 1 0 1.6-3.9M4.5 4.5v3.5H8"),
  up: svg("M5 12.5l5-5 5 5"),
  downChevron: svg("M5 7.5l5 5 5-5"),
};

function FeedItem({ g, index, total, active, now, modelName }: { g: PublicGeneration; index: number; total: number; active: boolean; now: number; modelName: string }) {
  const t = useTranslations("playground");
  const tGeneration = useTranslations("generation");
  const tStatus = useTranslations("status");
  const format = useFormatter();
  const errorText = useErrorText();
  const live = isLive(g.status);
  const isImage = describeModel(g.modelId).output === "image";
  const started = new Date(g.createdAt).getTime();
  const took = g.completedAt ? new Date(g.completedAt).getTime() - started : now - started;
  const label = tStatus(g.status);
  return (
    <article data-id={g.id} aria-current={active ? "true" : undefined} aria-label={t("feed.item", { n: String(index + 1), status: label })} className="relative flex h-[calc(100%_-_72px)] w-full flex-col overflow-hidden bg-surface lg:block">
      {/* Peek strip: what shows when this item waits one snap below. */}
      <div className="scrim-top absolute inset-x-0 top-0 z-10 flex h-[72px] items-start justify-between gap-4 px-5 pt-3 text-xs text-muted">
        <span className="min-w-0 truncate">
          <span className="font-display mr-2 text-sm text-sand">{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
          {g.prompt || tGeneration("noPrompt")}
        </span>
        <StatusBadge status={g.status} />
      </div>

      {g.video ? (
        <div className="min-h-0 flex-1 pt-[72px] lg:h-full lg:pt-0">
          <video src={g.video.url} controls={active} autoPlay={active} loop muted playsInline preload={active ? "auto" : "metadata"} className="h-full w-full object-contain" aria-label={tGeneration("video")} />
        </div>
      ) : g.image ? (
        <div className="min-h-0 flex-1 pt-[72px] lg:h-full lg:pt-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={g.image.url} alt={tGeneration("image")} loading={active ? "eager" : "lazy"} className="h-full w-full object-contain" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 pt-[72px] text-center lg:h-full lg:pt-0">
          {live ? (
            <>
              <span aria-hidden className="h-14 w-14 animate-spin rounded-full border-2 border-foreground border-t-transparent [animation-duration:1.4s]" />
              <span className="font-display text-7xl leading-none text-foreground sm:text-8xl" aria-live="polite">{fmtElapsed(took)}</span>
              <span className="text-sm text-muted">{t("feed.elapsed", { status: label })}</span>
              {g.status === "pending" && <span className="max-w-xs text-xs text-muted">{t("feed.pendingNote")}</span>}
              {isImage && <span className="max-w-xs text-xs text-muted">{t("feed.imageNote")}</span>}
            </>
          ) : (
            <>
              <span className="text-4xl font-semibold leading-none tracking-tight text-foreground-2 sm:text-5xl">{label}</span>
              <p className="max-w-md text-sm text-muted">{errorText(g.reason ?? appError("noResult", { kind: g.status === "canceled" ? "canceled" : isImage ? "image" : "video" }))}</p>
            </>
          )}
        </div>
      )}

      {/* Caption scrim */}
      <div className={`pointer-events-none shrink-0 bg-surface px-4 pb-4 pt-3 lg:scrim lg:absolute lg:inset-x-0 lg:bottom-0 lg:z-10 lg:bg-transparent lg:px-5 lg:pt-24 ${g.video && active ? "lg:pb-16" : "lg:pb-5"}`}>
        <div className="text-xs text-muted">
          <span className="text-foreground-2">{modelName}</span>
          {live && <span className="ml-2">{t("feed.estimated")}</span>}
          <span className={`font-display text-sm text-sand ${live ? "ml-1" : "ml-2"}`}>{isImage ? usd(format, g.costUsd) : `${g.durationS}S · ${usd(format, g.costUsd)}`}</span>
          {/^\d+:\d+$/.test(String((g.params as Record<string, unknown>)?.aspect_ratio)) && (
            <span className="font-display ml-2 text-sm text-sand">{String((g.params as Record<string, unknown>).aspect_ratio)}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-sm text-foreground">
          <span className="font-medium">{label}</span>
          {!live && g.completedAt && <span className="text-muted">· {t("feed.took", { elapsed: fmtElapsed(took) })}</span>}
          {live && <span className="text-muted" aria-hidden>· {fmtElapsed(took)}</span>}
        </div>
        <p className="mt-1 line-clamp-2 max-w-2xl break-words text-sm leading-relaxed text-foreground-2">{g.prompt || tGeneration("noPrompt")}</p>
        {(g.imageRefs.length > 0 || g.videoRefs.length > 0) && (
          <ul className="mt-2 flex items-center gap-1.5" aria-label={t("feed.refsLabel", { images: g.imageRefs.length, videos: g.videoRefs.length })}>
            {g.imageRefs.slice(0, 6).map((u, i) => (
              <li key={u} className="relative h-10 overflow-hidden rounded-sm border border-white/20 bg-background/60">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" className="h-full w-auto object-contain" />
                <span aria-hidden className="font-display absolute left-0.5 top-0 text-[11px] text-foreground drop-shadow">{i + 1}</span>
              </li>
            ))}
            {g.videoRefs.slice(0, 3).map((u, i) => (
              <li key={u} className="relative h-10 overflow-hidden rounded-sm border border-white/20 bg-background/60">
                <video src={u} muted playsInline preload="metadata" className="h-full w-auto object-contain" aria-hidden />
                <span aria-hidden className="font-display absolute left-0.5 top-0 text-[11px] text-foreground drop-shadow">V{i + 1}</span>
              </li>
            ))}
            <li className="ml-1 text-[11px] text-muted">{t("feed.refsCount", { count: g.imageRefs.length + g.videoRefs.length })}</li>
          </ul>
        )}
        {live && (
          <div className="mt-3 h-0.5 w-full overflow-hidden bg-white/15" role="progressbar" aria-label={t("feed.progress")} aria-valuetext={t("feed.progressUnknown")}>
            <div className="travel h-full w-1/4 bg-foreground" />
          </div>
        )}
      </div>
    </article>
  );
}

function RefThumbs({ refs, images, videos, onRemove, size = "w-28" }: { refs: Ref[]; images: Ref[]; videos: Ref[]; onRemove: (id: string) => void; size?: string }) {
  const t = useTranslations("playground");
  const tGeneration = useTranslations("generation");
  const format = useFormatter();
  return (
    <ul className="flex flex-wrap gap-2" aria-label={t("refs.attached")}>
      {refs.map((r) => {
        const i = (r.kind === "image" ? images : videos).findIndex((x) => x.id === r.id);
        const tag = r.kind === "image" ? String(i + 1) : `V${i + 1}`;
        const shape = shapeOf(r.w, r.h);
        return (
          <li key={r.id} className={`group relative aspect-video ${size} overflow-hidden rounded-md border border-border bg-background`}>
            {r.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.local ?? r.url} alt={r.name} className="h-full w-full object-contain" />
            ) : (
              <video src={r.local ?? r.url} className="h-full w-full object-contain" muted playsInline aria-label={r.name} />
            )}
            <span aria-hidden className="font-display absolute left-1.5 top-1 text-[14px] text-foreground drop-shadow">{tag}</span>
            {shape && <span aria-hidden className="absolute bottom-1 right-1.5 text-[11px] tabular-nums text-foreground-2 drop-shadow">{tGeneration("shape", { shape })}</span>}
            {r.seconds !== undefined && <span aria-hidden className="absolute bottom-1 right-1.5 text-[11px] tabular-nums text-foreground-2 drop-shadow">{t("refs.seconds", { seconds: format.number(r.seconds, ONE_DECIMAL) })}</span>}
            <button type="button" aria-label={t("refs.removeLabel", { kind: r.kind, tag, name: r.name })} onClick={() => onRemove(r.id)} className="absolute inset-x-0 bottom-0 min-h-7 bg-background/80 text-[11px] text-rose-300 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100">
              {t("refs.remove")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* Drop zone: click opens the picker, files can also be dragged in. */
function DropZone({ kind, max, count, disabled, uploading, hint, accept, onFiles }: { kind: "image" | "video"; max: number; count: number; disabled: boolean; uploading: boolean; hint: string; accept: string; onFiles: (files: FileList | null) => void }) {
  const t = useTranslations("playground");
  const [over, setOver] = useState(false);
  const full = count >= max;
  return (
    <label
      onDragOver={(e) => { if (!disabled && !full) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && !full) onFiles(e.dataTransfer.files); }}
      className={`flex min-h-36 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-4 text-center transition focus-within:ring-2 focus-within:ring-accent/40 ${
        disabled ? "cursor-not-allowed border-border opacity-50" : over ? "border-foreground bg-white/5" : "border-border hover:border-foreground/60"
      }`}
    >
      <span className="font-display text-2xl leading-none text-sand">{count}/{max}</span>
      <span className="text-sm text-foreground-2">{disabled ? t("drop.off", { kind }) : uploading ? t("uploading") : full ? t("drop.full", { kind, max }) : t("drop.pick", { kind })}</span>
      <span className="text-[11px] text-subtle">{hint}</span>
      <input type="file" accept={accept} multiple={kind === "image"} className="sr-only" aria-label={t("drop.add", { kind })} disabled={disabled || uploading || full} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
    </label>
  );
}

function RefDialog({ modelName, refNote, imageHint, imageAccept, refs, images, videos, imageMax, videoMax, uploading, largeUploads, error, onAdd, onRemove, onClose }: {
  modelName: string; refNote: string; imageHint: string; imageAccept: string; refs: Ref[]; images: Ref[]; videos: Ref[]; imageMax: number; videoMax: number; uploading: boolean; largeUploads: boolean; error: string | null;
  onAdd: (files: FileList | null, kind: "image" | "video") => void; onRemove: (id: string) => void; onClose: () => void;
}) {
  const t = useTranslations("playground");
  const tCommon = useTranslations("common");
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/85 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ref-dialog-title" className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-xl border border-border bg-surface focus:outline-none sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h2 id="ref-dialog-title" className="text-base font-semibold">{t("refs.add")}</h2>
            <p className="text-xs text-muted">{t("refs.limits", { model: modelName, images: imageMax, videos: videoMax })}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={tCommon("close")}>{tCommon("close")}</Button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <DropZone kind="image" max={imageMax} count={images.length} disabled={false} uploading={uploading} hint={imageHint} accept={imageAccept} onFiles={(f) => onAdd(f, "image")} />
            <DropZone kind="video" max={videoMax} count={videos.length} disabled={videoMax === 0} uploading={uploading} hint={t("refs.fileHint", { types: "mp4", mb: largeUploads ? "200" : "4" })} accept="video/mp4" onFiles={(f) => onAdd(f, "video")} />
          </div>

          <p className="text-xs leading-relaxed text-muted">{refNote}</p>

          {error && <ErrorText>{error}</ErrorText>}

          {refs.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted">{t("refs.attachedCount", { images: images.length, videos: videos.length })}</h3>
              <RefThumbs refs={refs} images={images} videos={videos} onRemove={onRemove} size="w-36" />
            </div>
          ) : (
            <p className="text-xs text-subtle">{t("refs.none")}</p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button onClick={onClose} disabled={uploading}>{uploading ? t("uploading") : t("refs.done")}</Button>
        </footer>
      </div>
    </div>
  );
}

const NO_ITEMS: readonly PublicGeneration[] = [];
const newThreadId = () => crypto.randomUUID();
/** The server answers at most this many ids per poll. */
const MAX_POLL_IDS = 24;

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
  const tGeneration = useTranslations("generation");
  const tMode = useTranslations("mode");
  const tFamilies = useTranslations("families");
  const tPrices = useTranslations("prices");
  const tPages = useTranslations("pages");
  const tThreads = useTranslations("threads");
  const format = useFormatter();
  const errorText = useErrorText();
  const modeName = (m: Mode) => tMode(m);
  function factText(f: Fact): string {
    switch (f.kind) {
      case "seconds":
        return t("fact.seconds", { seconds: format.number(f.seconds) });
      case "inputVideo":
        return t("fact.inputVideo", { seconds: format.number(f.seconds, ONE_DECIMAL) });
      case "refImages":
        return t("fact.refImages", { count: f.count });
      case "token":
        return f.text;
    }
  }
  const [familyId, setFamilyId] = useState<FamilyId | null>(() => (offers.find((o) => !o.unavailable) ?? offers.find((o) => o.unavailable?.status !== 503) ?? offers[0])?.family ?? null);
  const offer = offers.find((o) => o.family === familyId) ?? offers[0];
  const [params, setParams] = useState<Record<string, unknown>>(() => (offer ? { ...defaultParams(offer.family) } : {}));
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<Ref[]>([]);
  const [startFromImage, setStartFromImage] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [refsOpen, setRefsOpen] = useState(false);
  const refsButtonRef = useRef<HTMLButtonElement>(null);

  // A pick moves the stage at once, before the router commits. After that the address bar decides, read whenever the
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

  // The gallery count shares the list's state so one pure update moves both; React may run an updater twice.
  const [feeds, setFeeds] = useState<Feeds>({ byThread: {}, galleryTotal: galleryCount });
  const { galleryTotal } = feeds;
  const items = feeds.byThread[stageThread] ?? NO_ITEMS;
  const [loadFailure, setLoadFailure] = useState<{ thread: string; reason: Reason } | null>(null);
  const failed = loadFailure?.thread === stageThread ? loadFailure.reason : null;
  const loaded = stageThread in feeds.byThread || selectedId === null || failed !== null;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Server clock minus this browser's clock. Rows carry the database's created_at, and a member's computer clock can
  // be seconds off, so the elapsed times count on the server's clock.
  const clockOffset = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const pollDelay = useRef(POLL_FIRST_MS);

  function upsert(item: PublicGeneration, thread = stageThreadRef.current) {
    setFeeds((feeds) => withRow(feeds, item, thread));
  }

  // The answer's `now` is taken as the request's midpoint, so the offset is off by at most half the round trip.
  function syncClock(sentAt: number, serverNow: number | undefined) {
    if (serverNow === undefined) return;
    clockOffset.current = serverNow - (sentAt + Date.now()) / 2;
    setNow(Date.now() + clockOffset.current);
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
        setFeeds((feeds) => withAnswer(feeds, selectedId, body?.items ?? []));
      })
      .catch(() => current && setLoadFailure({ thread: selectedId, reason: { code: "network" } }));
    return () => {
      current = false;
    };
  }, [selectedId]);

  // Every thread this tab has shown keeps its live rows polled, the stage's first, so results that finish elsewhere
  // still count in the gallery glyph. A finished row stays in the poll set while the server still expects to copy it,
  // so the stored URL replaces the provider URL without a reload. The window bounds a copy that keeps failing.
  const offStage = Object.entries(feeds.byThread).flatMap(([thread, rows]) => (thread === stageThread ? [] : rows));
  const liveKey = [...items, ...offStage]
    .filter((i) => polled(i, now))
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

  // Elapsed-time clock while anything is live.
  useEffect(() => {
    if (!liveKey) return;
    const t = window.setInterval(() => setNow(Date.now() + clockOffset.current), 1000);
    return () => window.clearInterval(t);
  }, [liveKey]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0 });
  }, [stageThread]);

  // The item occupying the stage is the active one.
  const idsKey = items.map((i) => i.id).join(",");
  useEffect(() => {
    const root = feedRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActiveId((e.target as HTMLElement).dataset.id ?? null);
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll<HTMLElement>("[data-id]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [idsKey]);

  const active = items.find((i) => i.id === activeId) ?? items[0] ?? null;
  const images = refs.filter((r) => r.kind === "image");
  const videos = refs.filter((r) => r.kind === "video");
  const family = offer ? FAMILIES[offer.family] : null;
  const imageMax = family?.maxImages ?? 0;
  const videoMax = family?.maxVideos ?? 0;
  const offersStartFromImage = Boolean(family?.modes.firstFrame) && images.length === 1 && videos.length === 0;
  const mode = !family ? "t2v" : images.length + videos.length === 0 ? family.modes.text : offersStartFromImage && startFromImage && family.modes.firstFrame ? family.modes.firstFrame : family.modes.reference;
  const draft: Draft | null = offer
    ? {
        family: offer.family,
        mode,
        prompt,
        params,
        images: images.map((r) => r.url),
        videos: videos.map((r) => ({ url: r.url, seconds: r.seconds ?? 0 })),
        endImage: null,
      }
    : null;
  const plan = draft && offer ? planGeneration(draft, offer.rateUsd) : null;

  async function addFiles(files: FileList | null, kind: "image" | "video") {
    if (!files || !family) return;
    const room = kind === "image" ? imageMax - images.length : videoMax - videos.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (picked.length === 0) {
      setError(t("upload.tooMany", { kind, max: kind === "image" ? imageMax : videoMax }));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      for (const f of picked) {
        const { types, maxBytes } = family.refImages;
        const openai = family.provider === "openai";
        if (kind === "image" && !types.includes(f.type === "image/jpg" ? "image/jpeg" : f.type)) throw new Error(t("upload.badType", { file: f.name, model: family.name, types: typeList(types) }));
        if (kind === "image" && maxBytes !== null && f.size > maxBytes) throw new Error(t("upload.tooBig", { file: f.name, mb: String(Math.round(maxBytes / 1024 / 1024)) }));
        const seconds = kind === "video" ? await readVideoSeconds(f) : undefined;
        if (seconds === null) throw new Error(t("upload.noLength", { file: f.name }));
        const viaBlob = openai || f.size > SMALL;
        if (viaBlob && largeUploadPrefix === null) throw new Error(openai ? t("upload.blobForImages") : t("upload.blobForLarge", { mb: String(SMALL / 1024 / 1024) }));
        const url = await uploadFile(f, viaBlob ? largeUploadPrefix : null);
        const size = kind === "image" ? await readImageSize(f) : null;
        setRefs((r) => [...r, { id: crypto.randomUUID(), url, name: f.name, kind, local: URL.createObjectURL(f), w: size?.w, h: size?.h, seconds }]);
      }
    } catch (e) {
      setError(errorText(caught(e)));
    } finally {
      setUploading(false);
    }
  }

  async function generate() {
    if (!draft || !plan) return;
    if (!plan.ready) return setError(errorText(plan.blocker));
    setSubmitting(true);
    setError(null);
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
          // The new item must be in the DOM before the scroll, or scroll anchoring keeps the previous item on the stage.
          flushSync(() => {
            upsert(item, target);
            setActiveId(item.id);
          });
          if (opensDraft) showThread(thread.id, "replace");
          feedRef.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
          feedRef.current?.closest("section")?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        } else {
          upsert(item, target);
        }
        // The draft id now names a thread, so the next new thread needs its own.
        if (opensDraft) setDraftId(newThreadId());
      }
      // A refused submit still returns its row, whose reason says why it failed.
      if (!res.ok || !item) setError(errorText(item?.reason ?? parseAppError(body, res.status)));
    } catch (e) {
      setError(errorText(caught(e)));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(g: PublicGeneration) {
    try {
      const res = await fetch(`/api/generations/${g.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { item?: PublicGeneration } | null;
      if (body?.item) upsert(body.item);
      else setError(errorText(parseAppError(body, res.status)));
    } catch {
      setError(errorText({ code: "network" }));
    }
  }

  function pickFamily(next: FamilyId) {
    setFamilyId(next);
    setParams({ ...defaultParams(next) });
    setError(null);
  }

  function reuse(g: PublicGeneration) {
    const m = describeModel(g.modelId);
    const next = m.family && offers.some((o) => o.family === m.family) ? m.family : offer?.family;
    if (!next) return;
    setFamilyId(next);
    setParams({ ...defaultParams(next), ...(m.family === next ? (g.params as Record<string, unknown>) : {}) });
    setStartFromImage(m.mode === "i2v");
    setPrompt(g.prompt ?? "");
    setRefs([]);
    setError(null);
    document.getElementById("prompt")?.focus();
  }

  function pickThread(id: string) {
    if (id !== threadParam) showThread(id, "push");
    setError(null);
  }

  function startThread() {
    setDraftId(newThreadId());
    if (threadParam !== null) showThread(null, "push");
    setError(null);
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

  if (!offer || !family || !plan) return <div className="p-8 text-center text-sm text-subtle">{t("noModels")}</div>;

  const specs = paramsFor(family.id, mode);
  const aspectSpec = specs.find((p): p is Extract<ParamSpec, { type: "enum" }> => p.key === "aspect_ratio" && p.type === "enum");
  const aspectShape = aspectSpec ? ratioShape(String(params[aspectSpec.key])) : null;
  const firstImage = images[0];
  const firstShape = shapeOf(firstImage?.w, firstImage?.h);
  const priced = offer.rateUsd > 0;
  const rate = tPrices("rate", { usd: usd(format, offer.rateUsd), unit: family.rate.unit });
  const facts = plan.facts.map(factText);
  const estimateNote = [...facts, t("cost.rate", { rate })].join(" · ");
  const canGenerate = !offer.unavailable && !submitting && !uploading && plan.ready;
  const offline = offers.filter((o) => o.unavailable?.status === 503 && o.family !== family.id);
  const canCancel = Boolean(active && (active.status === "pending" || active.status === "queued"));
  const activeStarted = active ? new Date(active.createdAt).getTime() : 0;
  const activeIndex = active ? items.findIndex((i) => i.id === active.id) : -1;
  const reuseCount = active ? items.filter((i) => i.prompt === active.prompt && i.modelId === active.modelId).length : 0;
  function goTo(i: number) {
    const feed = feedRef.current;
    if (!feed || i < 0 || i >= items.length) return;
    feed.scrollTo({ top: i * (feed.clientHeight - 72), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  const missing = threadParam !== null && selected === null;
  const byWidth = {
    wide: (chunks: React.ReactNode) => <span className="hidden lg:inline">{chunks}</span>,
    narrow: (chunks: React.ReactNode) => <span className="lg:hidden">{chunks}</span>,
  };
  const threadList = { threads, currentId: selectedId, onPick: pickThread, onNew: startThread, onDelete: setDeleting };

  return (
    <div className="flex flex-1 flex-col lg:h-[calc(100dvh_-_3.5rem)] lg:flex-none lg:flex-row lg:overflow-hidden">
      <ThreadColumn {...threadList} mode={listMode} onMode={setListMode} />
      <ThreadBar {...threadList} title={selected ? threadName(selected) : tThreads("label")} />

      {/* STAGE: one result owns it; the next waits one snap below. */}
      <section aria-label={t("stage")} className="order-1 flex h-[72dvh] min-h-[480px] min-w-0 shrink-0 flex-col bg-background lg:order-3 lg:h-full lg:flex-1 lg:shrink lg:flex-row">
        <div ref={feedRef} className="feed relative h-full min-h-0 flex-1 overflow-y-auto" tabIndex={-1}>
          {items.length === 0 ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
              {failed ? (
                <div className="max-w-md">
                  <ErrorText>{errorText(failed)}</ErrorText>
                </div>
              ) : loaded ? (
                <>
                  <p className="text-xl font-semibold text-foreground sm:text-2xl">{missing ? tThreads("missing.title") : threads.length > 0 ? tThreads("fresh.title") : t("empty.title")}</p>
                  <p className="max-w-sm break-keep text-sm text-muted">
                    {missing ? tThreads("missing.lead") : threads.length > 0 ? tThreads.rich("fresh.lead", byWidth) : t.rich("empty.lead", byWidth)}
                  </p>
                  <Button variant="outline" size="sm" className="lg:hidden" onClick={() => document.getElementById(DRAWER_ID)?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" })}>
                    {t("empty.toSettings")}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted">{t("loading")}</p>
              )}
            </div>
          ) : (
            items.map((g, i) => <FeedItem key={g.id} g={g} index={i} total={items.length} active={g.id === active?.id} now={now} modelName={modelLine(g.modelId, modeName)} />)
          )}
        </div>
        <div aria-label={t("rail.label")} className="flex shrink-0 items-center justify-center gap-3 border-t border-border px-2 py-3 sm:gap-5 lg:w-24 lg:flex-col lg:gap-4 lg:border-t-0 lg:border-l lg:py-4">
          {items.length > 1 && (
            <div className="flex flex-col items-center gap-0.5 lg:gap-1" aria-label={t("rail.position")}>
              <button type="button" aria-label={t("rail.previous")} disabled={activeIndex <= 0} onClick={() => goTo(activeIndex - 1)} className="grid h-9 w-9 place-items-center rounded-full text-foreground-2 transition hover:bg-white/15 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent">
                {I.up}
              </button>
              <ol className="hidden flex-col items-center gap-1.5 py-1 lg:flex" aria-hidden>
                {items.map((g, i) => (
                  <li key={g.id} className={`h-1.5 w-1.5 rounded-full ${i === activeIndex ? "bg-foreground" : "bg-foreground/30"}`} />
                ))}
              </ol>
              <button type="button" aria-label={t("rail.next")} disabled={activeIndex >= items.length - 1} onClick={() => goTo(activeIndex + 1)} className="grid h-9 w-9 place-items-center rounded-full text-foreground-2 transition hover:bg-white/15 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent">
                {I.downChevron}
              </button>
            </div>
          )}
          <Glyph label={t("rail.generate")} counter={priced && plan.ready ? usd(format, plan.costUsd) : "—"} icon={I.play} active={canGenerate} disabled={!canGenerate} onClick={generate} />
          <Glyph label={t("rail.cancel")} counter={canCancel ? fmtElapsed(now - activeStarted) : "—"} icon={I.x} disabled={!canCancel} onClick={() => active && cancel(active)} />
          <Glyph label={tGeneration("download")} counter={active?.video ? "MP4" : active?.image ? active.image.format.toUpperCase() : "—"} icon={I.down} disabled={!active?.video && !active?.image} href={(active?.video ?? active?.image)?.downloadUrl} download />
          <Glyph label={tPages("gallery")} counter={galleryTotal > 0 ? String(galleryTotal) : "—"} icon={I.grid} href="/gallery" />
          <Glyph label={t("rail.reuse")} counter={active ? `×${reuseCount}` : "—"} icon={I.redo} disabled={!active} onClick={() => active && reuse(active)} />
        </div>
      </section>

      {/* DRAWER: the form that puts the next item on the stage. */}
      <aside id={DRAWER_ID} aria-label={t("drawer")} className="order-2 flex w-full flex-col border-t border-border bg-background lg:order-2 lg:h-full lg:w-[480px] lg:shrink-0 lg:border-r lg:border-t-0">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <h1 className="text-base font-semibold">{tPages("playground")}</h1>

          {offer.unavailable && (
            <div role="status" className="flex items-start gap-2.5 rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-foreground-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              <span>{errorText(offer.unavailable.error)}</span>
            </div>
          )}

          <section className="space-y-3">
            <h2 className="text-xs font-semibold tracking-wider text-muted">{t("section.prompt")}</h2>
            <Field label={t("prompt")} hint={prompt.length > 0 ? t("promptLength", { count: prompt.length }) : undefined}>
              <Textarea id="prompt" rows={3} placeholder={t("promptPlaceholder")} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </Field>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button ref={refsButtonRef} variant="outline" size="sm" onClick={() => setRefsOpen(true)} disabled={uploading} aria-haspopup="dialog" aria-expanded={refsOpen}>
                {uploading ? t("uploading") : t("refs.add")}
              </Button>
              <span className="text-xs tabular-nums text-muted">
                {t("refs.imageCount", { count: String(images.length), max: String(imageMax) })}
                {videoMax > 0 && (
                  <>
                    <span className="mx-1.5 text-subtle">·</span>
                    {t("refs.videoCount", { count: String(videos.length), max: String(videoMax) })}
                  </>
                )}
                <span className="mx-1.5 text-subtle">·</span>
                <span className="text-subtle">{t("refs.optional")}</span>
              </span>
            </div>
            {refs.length > 0 && <RefThumbs refs={refs} images={images} videos={videos} onRemove={(id) => setRefs((list) => list.filter((x) => x.id !== id))} />}
            {offersStartFromImage && (
              <label className="flex min-h-11 items-center gap-2 text-sm text-foreground-2 lg:min-h-10">
                <input type="checkbox" checked={startFromImage} onChange={(e) => setStartFromImage(e.target.checked)} className="h-4 w-4" />
                {t("startFromImage")}
                <span className="text-xs text-subtle">{t("startFromImageHint")}</span>
              </label>
            )}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted">{t("modes")}</div>
              <ol aria-label={t("modes")} className="flex flex-wrap gap-1.5">
                {modesOf(family.id).map((m) => (
                  <li
                    key={m}
                    aria-current={m === mode ? "step" : undefined}
                    className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs ${m === mode ? "bg-foreground font-medium text-background" : "text-subtle"}`}
                  >
                    {tMode(m)}
                  </li>
                ))}
              </ol>
              <p aria-live="polite" className="text-xs text-muted">{modeSentence(t, mode, images.length, videos.length)}</p>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-semibold tracking-wider text-muted">{t("section.model")}</h2>
            <Field label={t("model")} hint={priced ? t("rateHint", { basis: tPrices(`basis.${family.key}`), rate }) : t("rateUnset")}>
              <Select
                value={family.id}
                onChange={(e) => {
                  const next = offers.find((o) => o.family === e.target.value);
                  if (next) pickFamily(next.family);
                }}
              >
                {(["video", "image"] as const).map((output) => {
                  const group = offers.filter((o) => FAMILIES[o.family].modes.output === output);
                  if (group.length === 0) return null;
                  return (
                    <optgroup key={output} label={t("output", { output })}>
                      {group.map((o) => {
                        const f = FAMILIES[o.family];
                        const off = o.unavailable?.status === 503;
                        return (
                          <option key={o.family} value={o.family} disabled={off}>
                            {f.name} · {f.vendor}{off ? ` · ${t("unavailable")}` : o.rateUsd > 0 ? ` · ${tPrices("rate", { usd: usd(format, o.rateUsd), unit: f.rate.unit })}` : ""}
                          </option>
                        );
                      })}
                    </optgroup>
                  );
                })}
              </Select>
            </Field>
            {offline.map((o) => (
              <p key={o.family} role="status" className="flex items-start gap-2 text-xs leading-relaxed text-foreground-2">
                <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <span>
                  {t.rich("offline", {
                    name: FAMILIES[o.family].name,
                    reason: o.unavailable ? errorText(o.unavailable.error) : "",
                    model: (chunks) => <span className="text-foreground">{chunks}</span>,
                  })}
                </span>
              </p>
            ))}
            <p className="text-xs leading-relaxed text-muted">
              {tFamilies(`${family.key}.blurb`)}
              <span className="block text-subtle">{tFamilies(`${family.key}.note`)}</span>
            </p>
            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-xs font-medium text-muted">
                <span>{t("aspect.label")}</span>
                {aspectSpec ? (
                  <span className="font-normal text-subtle">{aspectShape ? tGeneration("shape", { shape: aspectShape }) : ""}</span>
                ) : (
                  <span className="font-normal text-subtle">{t("aspect.followsImage")}</span>
                )}
              </div>
              {aspectSpec ? (
                <div role="group" aria-label={t("aspect.label")} className="flex flex-wrap gap-1.5">
                  {aspectSpec.options.map((o) => {
                    const on = String(params[aspectSpec.key]) === o;
                    const shape = ratioShape(o);
                    return (
                      <button key={o} type="button" aria-pressed={on} onClick={() => setParams((st) => ({ ...st, [aspectSpec.key]: o }))} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${on ? "border-foreground bg-foreground text-background" : "border-border text-foreground-2 hover:border-foreground/60"}`}>
                        {o === "auto" ? t("aspect.auto") : shape ? t("aspect.pill", { shape: tGeneration("shape", { shape }), ratio: o }) : o}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs leading-relaxed text-foreground-2">
                  {firstImage && firstShape
                    ? t.rich("aspect.firstFrameNote", {
                        size: `${firstImage.w}×${firstImage.h}`,
                        shape: firstShape,
                        num: (chunks) => <span className="tabular-nums">{chunks}</span>,
                        em: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                      })
                    : t("aspect.firstFrameRule")}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {specs.filter((p) => p.key !== "aspect_ratio").map((p) => (
                <ParamInput key={p.key} spec={p} value={params[p.key]} onChange={(v) => setParams((s) => ({ ...s, [p.key]: v }))} />
              ))}
            </div>
            {error && <ErrorText>{error}</ErrorText>}
          </section>
        </div>

        <div className="border-t border-border bg-background/90 px-5 py-3 backdrop-blur">
          {!plan.ready && (
            <p role="status" className="mb-2 flex items-start gap-2 text-xs leading-relaxed text-foreground-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              {errorText(plan.blocker)}
            </p>
          )}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 text-sm text-muted">
              <div className="flex items-baseline gap-2">
                <span>{t("cost.label")}</span>
                {priced && plan.ready ? (
                  <span className="font-display text-2xl leading-none text-sand">{usd(format, plan.costUsd)}</span>
                ) : (
                  <span className="font-semibold text-foreground">{priced ? "—" : t("cost.unset")}</span>
                )}
                <span className="text-xs text-subtle">{tMode(mode)}</span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-subtle tabular-nums">
                {priced ? estimateNote : t("cost.unpriced", { facts: facts.join(" · ") })}
              </div>
            </div>
            <Button size="lg" onClick={generate} disabled={!canGenerate}>
              {submitting ? t("submitting") : t("generate")}
            </Button>
          </div>
        </div>
      </aside>

      {refsOpen && (
        <RefDialog
          modelName={family.name}
          refNote={t("refs.note", { provider: family.provider })}
          imageHint={t("refs.fileHint", { types: typeList(family.refImages.types), mb: String((family.refImages.maxBytes ?? SMALL) / 1024 / 1024) })}
          imageAccept={family.refImages.types.join(",")}
          refs={refs}
          images={images}
          videos={videos}
          imageMax={imageMax}
          videoMax={videoMax}
          uploading={uploading}
          largeUploads={largeUploadPrefix !== null}
          error={error}
          onAdd={addFiles}
          onRemove={(id) => setRefs((list) => list.filter((x) => x.id !== id))}
          onClose={() => {
            setRefsOpen(false);
            refsButtonRef.current?.focus();
          }}
        />
      )}
      {deleting && <DeleteThreadDialog thread={deleting} onClose={() => setDeleting(null)} onDeleted={threadDeleted} />}
    </div>
  );
}
