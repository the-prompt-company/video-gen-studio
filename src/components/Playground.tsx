"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { flushSync } from "react-dom";
import {
  defaultParams,
  describeModel,
  FAMILIES,
  MODE_LABEL,
  modelLine,
  modesOf,
  paramsFor,
  planGeneration,
  routeMode,
  type Draft,
  type FamilyId,
  type Mode,
  type ParamSpec,
} from "@/lib/catalog";
import { ApiError, appError, caught, parseAppError } from "@/lib/errors";
import type { PublicGeneration, Unavailable } from "@/lib/generations";
import { isLive } from "@/lib/generation-status";
import { refUploadName } from "@/lib/ref-name";
import { Button, ErrorText, Field, Input, Select, Textarea } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { useErrorText } from "@/i18n/errors";
import { usd } from "@/i18n/format";

/**
 * `unavailable` 503: the server cannot run the model at all, so it is listed but cannot be picked. 403: this member
 * has no key for it, and the drawer says so while 생성하기 stays off.
 */
type Offer = { family: FamilyId; rateUsd: number; unavailable: Unavailable | null };
type Ref = { id: string; url: string; name: string; kind: "image" | "video"; local?: string; w?: number; h?: number; seconds?: number };
type FeedAnswer = { items?: PublicGeneration[]; now?: number };

const ASPECT_LABEL: Record<string, string> = {
  "16:9": "가로 16:9",
  "3:2": "가로 3:2",
  "21:9": "가로 21:9",
  "4:3": "가로 4:3",
  "9:16": "세로 9:16",
  "3:4": "세로 3:4",
  "2:3": "세로 2:3",
  "1:1": "정사각 1:1",
  auto: "자동",
};

function modeSentence(mode: Mode, images: number, videos: number) {
  if (mode === "t2v" || mode === "t2i") return "레퍼런스 없이 프롬프트만으로 만듭니다.";
  if (mode === "i2v") return "1번 이미지를 첫 프레임으로 씁니다.";
  if (mode === "r2i") return `이미지 ${images}장을 레퍼런스로 OpenAI 편집에 보냅니다.`;
  const parts = [images > 0 && `이미지 ${images}장`, videos > 0 && `영상 ${videos}개`].filter(Boolean);
  return `${parts.join(" · ")}${videos > 0 ? "를" : "을"} 레퍼런스로 씁니다.`;
}

function orientation(w?: number, h?: number) {
  if (!w || !h) return null;
  const r = w / h;
  return r > 1.05 ? "가로" : r < 0.95 ? "세로" : "정사각";
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

const SMALL = 4 * 1024 * 1024;
const FEED_LIMIT = 12;
const POLL_FIRST_MS = 2000;
const POLL_MAX_MS = 10000;
const POLL_JITTER_MS = 400;
// One poll may wait out Higgsfield's 8 s status timeout. A request still unanswered after this is aborted, because one
// that never answers would otherwise stop polling until a reload.
const POLL_TIMEOUT_MS = 10_000;
const STORE_WAIT_MS = 120_000;

/**
 * Small files go through the server to Higgsfield's storage with the member's key. An OpenAI model's references always
 * go straight to Blob (`viaBlob`), so no Higgsfield key is involved.
 */
async function uploadFile(file: File, largeUploadPrefix: string | null, viaBlob: boolean): Promise<string> {
  if (file.size <= SMALL && !viaBlob) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    const body = (await res.json().catch(() => null)) as { url?: string } | null;
    if (res.ok && body?.url) return body.url;
    const error = parseAppError(body, res.status);
    // Vercel answers a body over its 4.5 MB limit itself, with no error code.
    throw new ApiError(error.code === "httpStatus" && res.status === 413 ? appError("uploadTooLarge", { mb: SMALL / 1024 / 1024 }) : error);
  }
  if (largeUploadPrefix === null) throw new Error(viaBlob ? "이미지 레퍼런스는 Blob 스토어가 연결돼야 올릴 수 있습니다" : "4 MB를 넘는 파일은 Blob 스토어가 연결돼야 올릴 수 있습니다");
  const { upload: blobUpload } = await import("@vercel/blob/client");
  const blob = await blobUpload(`${largeUploadPrefix}${refUploadName(file.name)}`, file, { access: "public", handleUploadUrl: "/api/uploads/blob", multipart: true });
  return blob.url;
}

function fmtElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function ParamInput({ spec, value, onChange }: { spec: ParamSpec; value: unknown; onChange: (v: unknown) => void }) {
  switch (spec.type) {
    case "int": {
      const isRange = spec.max - spec.min <= 100;
      return (
        <Field label={spec.label} hint={isRange ? String(value) : `${spec.min}~${spec.max}`}>
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
          {spec.label}
        </label>
      );
    case "enum":
      return (
        <Field label={spec.label}>
          <Select value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {spec.options.map((o) => (
              <option key={o} value={o}>{spec.labels?.[o] ?? o}</option>
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
  const tStatus = useTranslations("status");
  const format = useFormatter();
  const errorText = useErrorText();
  const live = isLive(g.status);
  const isImage = describeModel(g.modelId).output === "image";
  const started = new Date(g.createdAt).getTime();
  const took = g.completedAt ? new Date(g.completedAt).getTime() - started : now - started;
  const label = tStatus(g.status);
  return (
    <article data-id={g.id} aria-current={active ? "true" : undefined} aria-label={`${index + 1}번째 결과: ${label}`} className="relative flex h-[calc(100%_-_72px)] w-full flex-col overflow-hidden bg-surface lg:block">
      {/* Peek strip: what shows when this item waits one snap below. */}
      <div className="scrim-top absolute inset-x-0 top-0 z-10 flex h-[72px] items-start justify-between gap-4 px-5 pt-3 text-xs text-muted">
        <span className="min-w-0 truncate">
          <span className="font-display mr-2 text-sm text-sand">{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
          {g.prompt || "(프롬프트 없음)"}
        </span>
        <StatusBadge status={g.status} />
      </div>

      {g.video ? (
        <div className="min-h-0 flex-1 pt-[72px] lg:h-full lg:pt-0">
          <video src={g.video.url} controls={active} autoPlay={active} loop muted playsInline preload={active ? "auto" : "metadata"} className="h-full w-full object-contain" aria-label="생성된 영상" />
        </div>
      ) : g.image ? (
        <div className="min-h-0 flex-1 pt-[72px] lg:h-full lg:pt-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={g.image.url} alt="생성된 이미지" loading={active ? "eager" : "lazy"} className="h-full w-full object-contain" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 pt-[72px] text-center lg:h-full lg:pt-0">
          {live ? (
            <>
              <span aria-hidden className="h-14 w-14 animate-spin rounded-full border-2 border-foreground border-t-transparent [animation-duration:1.4s]" />
              <span className="font-display text-7xl leading-none text-foreground sm:text-8xl" aria-live="polite">{fmtElapsed(took)}</span>
              <span className="text-sm text-muted">{label} · 경과 시간</span>
              {g.status === "pending" && <span className="max-w-xs text-xs text-muted">Higgsfield가 요청을 받는 대로 자동으로 시작합니다</span>}
              {isImage && <span className="max-w-xs text-xs text-muted">OpenAI가 이미지를 만드는 중입니다. 보통 수십 초에서 2분 걸립니다</span>}
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
          {live && <span className="ml-2">예상</span>}
          <span className={`font-display text-sm text-sand ${live ? "ml-1" : "ml-2"}`}>{isImage ? usd(format, g.costUsd) : `${g.durationS}S · ${usd(format, g.costUsd)}`}</span>
          {/^\d+:\d+$/.test(String((g.params as Record<string, unknown>)?.aspect_ratio)) && (
            <span className="font-display ml-2 text-sm text-sand">{String((g.params as Record<string, unknown>).aspect_ratio)}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-sm text-foreground">
          <span className="font-medium">{label}</span>
          {!live && g.completedAt && <span className="text-muted">· {fmtElapsed(took)} 걸림</span>}
          {live && <span className="text-muted" aria-hidden>· {fmtElapsed(took)}</span>}
        </div>
        <p className="mt-1 line-clamp-2 max-w-2xl break-words text-sm leading-relaxed text-foreground-2">{g.prompt || "(프롬프트 없음)"}</p>
        {(g.imageRefs.length > 0 || g.videoRefs.length > 0) && (
          <ul className="mt-2 flex items-center gap-1.5" aria-label={`레퍼런스 이미지 ${g.imageRefs.length}장, 영상 ${g.videoRefs.length}개`}>
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
            <li className="ml-1 text-[11px] text-muted">레퍼런스 {g.imageRefs.length + g.videoRefs.length}</li>
          </ul>
        )}
        {live && (
          <div className="mt-3 h-0.5 w-full overflow-hidden bg-white/15" role="progressbar" aria-label="생성 진행 중" aria-valuetext="진행률을 알 수 없음">
            <div className="travel h-full w-1/4 bg-foreground" />
          </div>
        )}
      </div>
    </article>
  );
}

function RefThumbs({ refs, images, videos, onRemove, size = "w-28" }: { refs: Ref[]; images: Ref[]; videos: Ref[]; onRemove: (id: string) => void; size?: string }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="첨부한 레퍼런스">
      {refs.map((r) => {
        const i = (r.kind === "image" ? images : videos).findIndex((x) => x.id === r.id);
        const tag = r.kind === "image" ? String(i + 1) : `V${i + 1}`;
        return (
          <li key={r.id} className={`group relative aspect-video ${size} overflow-hidden rounded-md border border-border bg-background`}>
            {r.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.local ?? r.url} alt={r.name} className="h-full w-full object-contain" />
            ) : (
              <video src={r.local ?? r.url} className="h-full w-full object-contain" muted playsInline aria-label={r.name} />
            )}
            <span aria-hidden className="font-display absolute left-1.5 top-1 text-[14px] text-foreground drop-shadow">{tag}</span>
            {r.w && r.h && <span aria-hidden className="absolute bottom-1 right-1.5 text-[11px] tabular-nums text-foreground-2 drop-shadow">{orientation(r.w, r.h)}</span>}
            {r.seconds !== undefined && <span aria-hidden className="absolute bottom-1 right-1.5 text-[11px] tabular-nums text-foreground-2 drop-shadow">{r.seconds.toFixed(1)}s</span>}
            <button type="button" aria-label={`${r.kind === "image" ? "이미지" : "영상"} 레퍼런스 ${tag} ${r.name} 제거`} onClick={() => onRemove(r.id)} className="absolute inset-x-0 bottom-0 min-h-7 bg-background/80 text-[11px] text-rose-300 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100">
              제거
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* Drop zone: click opens the picker, files can also be dragged in. */
function DropZone({ kind, max, count, disabled, uploading, hint, accept, onFiles }: { kind: "image" | "video"; max: number; count: number; disabled: boolean; uploading: boolean; hint: string; accept: string; onFiles: (files: FileList | null) => void }) {
  const [over, setOver] = useState(false);
  const full = count >= max;
  const label = kind === "image" ? "이미지" : "영상";
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
      <span className="text-sm text-foreground-2">{disabled ? `${label} 레퍼런스를 받지 않는 모델` : uploading ? "업로드 중…" : full ? `${label} ${max}개 모두 추가됨` : `${label} 파일을 끌어다 놓거나 클릭해서 선택`}</span>
      <span className="text-[11px] text-subtle">{hint}</span>
      <input type="file" accept={accept} multiple={kind === "image"} className="sr-only" aria-label={`${label} 레퍼런스 추가`} disabled={disabled || uploading || full} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
    </label>
  );
}

function RefDialog({ modelName, refNote, imageHint, imageAccept, refs, images, videos, imageMax, videoMax, uploading, largeUploads, error, onAdd, onRemove, onClose }: {
  modelName: string; refNote: string; imageHint: string; imageAccept: string; refs: Ref[]; images: Ref[]; videos: Ref[]; imageMax: number; videoMax: number; uploading: boolean; largeUploads: boolean; error: string | null;
  onAdd: (files: FileList | null, kind: "image" | "video") => void; onRemove: (id: string) => void; onClose: () => void;
}) {
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
            <h2 id="ref-dialog-title" className="text-base font-semibold">레퍼런스 추가</h2>
            <p className="text-xs text-muted">{modelName} · 이미지 최대 {imageMax}장{videoMax > 0 && ` · 영상 최대 ${videoMax}개`} · 선택</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="닫기">닫기</Button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <DropZone kind="image" max={imageMax} count={images.length} disabled={false} uploading={uploading} hint={imageHint} accept={imageAccept} onFiles={(f) => onAdd(f, "image")} />
            <DropZone kind="video" max={videoMax} count={videos.length} disabled={videoMax === 0} uploading={uploading} hint={largeUploads ? "mp4 · 최대 200 MB" : "mp4 · 4 MB 이하"} accept="video/mp4" onFiles={(f) => onAdd(f, "video")} />
          </div>

          <p className="text-xs leading-relaxed text-muted">{refNote}</p>

          {error && <ErrorText>{error}</ErrorText>}

          {refs.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-medium text-muted">첨부됨 · 이미지 {images.length} · 영상 {videos.length}</h3>
              <RefThumbs refs={refs} images={images} videos={videos} onRemove={onRemove} size="w-36" />
            </div>
          ) : (
            <p className="text-xs text-subtle">아직 첨부한 레퍼런스가 없습니다.</p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button onClick={onClose} disabled={uploading}>{uploading ? "업로드 중…" : "완료"}</Button>
        </footer>
      </div>
    </div>
  );
}

export function Playground({ offers, largeUploadPrefix, galleryCount }: { offers: Offer[]; largeUploadPrefix: string | null; galleryCount: number }) {
  const format = useFormatter();
  const errorText = useErrorText();
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
  // The 갤러리 count shares the list's state so one pure update moves both; React may run an updater twice.
  const [{ items, galleryTotal }, setFeed] = useState({ items: [] as PublicGeneration[], galleryTotal: galleryCount });
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Server clock minus this browser's clock. Rows carry the database's created_at, and a member's computer clock can
  // be seconds off, so the elapsed times count on the server's clock.
  const clockOffset = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const pollDelay = useRef(POLL_FIRST_MS);

  function upsert(item: PublicGeneration) {
    setFeed(({ items, galleryTotal }) => {
      const prev = items.find((x) => x.id === item.id);
      return {
        items: prev ? items.map((x) => (x.id === item.id ? item : x)) : [item, ...items].slice(0, FEED_LIMIT),
        galleryTotal: galleryTotal + (item.status === "completed" && prev && prev.status !== "completed" ? 1 : 0),
      };
    });
  }

  // The answer's `now` is taken as the request's midpoint, so the offset is off by at most half the round trip.
  function syncClock(sentAt: number, serverNow: number | undefined) {
    if (serverNow === undefined) return;
    clockOffset.current = serverNow - (sentAt + Date.now()) / 2;
    setNow(Date.now() + clockOffset.current);
  }

  useEffect(() => {
    const sentAt = Date.now();
    fetch(`/api/generations?limit=${FEED_LIMIT}`)
      .then((r) => r.json())
      .then((b: FeedAnswer) => {
        syncClock(sentAt, b.now);
        setFeed((feed) => ({ ...feed, items: b.items ?? [] }));
        setActiveId(b.items?.[0]?.id ?? null);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // A finished row stays in the poll set while the server still expects to copy it, so the stored URL replaces the
  // provider URL without a reload. The window bounds a copy that keeps failing.
  const liveIds = useMemo(
    () =>
      items
        .filter((i) => isLive(i.status) || (i.video?.kind === "provider" && i.video.storing && now - new Date(i.completedAt ?? i.createdAt).getTime() < STORE_WAIT_MS))
        .map((i) => i.id),
    [items, now],
  );
  const liveKey = liveIds.join(",");

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
      body?.items?.forEach(upsert);
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
  const mode = family ? routeMode(family.id, images.length, videos.length, startFromImage) : "t2v";
  const draft: Draft | null = offer
    ? {
        family: offer.family,
        mode,
        prompt,
        params,
        images: images.map((r) => r.url),
        videos: videos.map((r) => ({ url: r.url, seconds: r.seconds ?? 0 })),
        startFromImage,
      }
    : null;
  const plan = draft && offer ? planGeneration(draft, offer.rateUsd) : null;

  async function addFiles(files: FileList | null, kind: "image" | "video") {
    if (!files || !family) return;
    const room = kind === "image" ? imageMax - images.length : videoMax - videos.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (picked.length === 0) {
      setError(kind === "image" ? `이미지는 최대 ${imageMax}장` : `영상은 최대 ${videoMax}개`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      for (const f of picked) {
        const { types, hint, maxBytes } = family.refImages;
        if (kind === "image" && !types.includes(f.type === "image/jpg" ? "image/jpeg" : f.type)) throw new Error(`${f.name}: ${family.name}이(가) 받지 않는 형식입니다. ${hint}인 파일로 올려 주세요`);
        if (kind === "image" && maxBytes !== null && f.size > maxBytes) throw new Error(`${f.name}: ${Math.round(maxBytes / 1024 / 1024)} MB를 넘습니다. 줄여서 다시 올려 주세요`);
        const seconds = kind === "video" ? await readVideoSeconds(f) : undefined;
        if (seconds === null) throw new Error(`${f.name}: 영상 길이를 읽지 못했습니다. 다른 mp4로 올려 주세요`);
        const url = await uploadFile(f, largeUploadPrefix, family.provider === "openai");
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
    try {
      const res = await fetch("/api/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = (await res.json().catch(() => null)) as { item?: PublicGeneration } | null;
      const item = body?.item;
      if (item) {
        pollDelay.current = POLL_FIRST_MS;
        // The new item must be in the DOM before the scroll, or scroll anchoring keeps the previous item on the stage.
        flushSync(() => {
          upsert(item);
          setActiveId(item.id);
        });
        feedRef.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
        feedRef.current?.closest("section")?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
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

  if (!offer || !family || !plan) return <div className="p-8 text-center text-sm text-subtle">사용할 수 있는 모델이 없습니다. 관리자에게 문의하세요.</div>;

  const specs = paramsFor(family.id, mode);
  const aspectSpec = specs.find((p): p is Extract<ParamSpec, { type: "enum" }> => p.key === "aspect_ratio" && p.type === "enum");
  const firstImage = images[0];
  const currentAspect: [number?, number?] = (() => {
    const m = /^(\d+):(\d+)$/.exec(aspectSpec ? String(params[aspectSpec.key]) : "");
    return m ? [Number(m[1]), Number(m[2])] : [undefined, undefined];
  })();
  const priced = offer.rateUsd > 0;
  const ratePer = `${usd(format, offer.rateUsd)}/${family.rate.per.short}`;
  const estimateNote = [...plan.facts, `단가 ${ratePer}`].join(" · ");
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

  return (
    <div className="flex flex-1 flex-col lg:h-[calc(100dvh_-_3.5rem)] lg:flex-none lg:flex-row lg:overflow-hidden">
      {/* STAGE: one result owns it; the next waits one snap below. */}
      <section aria-label="결과 무대" className="order-1 flex h-[72dvh] min-h-[480px] min-w-0 shrink-0 flex-col bg-background lg:order-2 lg:h-full lg:flex-1 lg:shrink lg:flex-row">
        <div ref={feedRef} className="feed relative h-full min-h-0 flex-1 overflow-y-auto" tabIndex={-1}>
          {items.length === 0 ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center">
              {loaded ? (
                <>
                  <p className="text-xl font-semibold text-foreground sm:text-2xl">첫 영상을 만들어 보세요</p>
                  <p className="max-w-sm text-sm text-muted">
                    <span className="hidden lg:inline">왼쪽 서랍</span>
                    <span className="lg:hidden">아래</span>
                    에서 프롬프트를 적고 모델을 고른 뒤 생성하면 결과가 이 무대에 올라옵니다.
                  </p>
                  <Button variant="outline" size="sm" className="lg:hidden" onClick={() => document.querySelector('aside[aria-label="생성 설정"]')?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" })}>
                    생성 설정으로 이동
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted">최근 생성을 불러오는 중</p>
              )}
            </div>
          ) : (
            items.map((g, i) => <FeedItem key={g.id} g={g} index={i} total={items.length} active={g.id === active?.id} now={now} modelName={modelLine(g.modelId)} />)
          )}
        </div>
        <div aria-label="결과 동작" className="flex shrink-0 items-center justify-center gap-3 border-t border-border px-2 py-3 sm:gap-5 lg:w-24 lg:flex-col lg:gap-4 lg:border-t-0 lg:border-l lg:py-4">
          {items.length > 1 && (
            <div className="flex flex-col items-center gap-0.5 lg:gap-1" aria-label="결과 위치">
              <button type="button" aria-label="이전 결과" disabled={activeIndex <= 0} onClick={() => goTo(activeIndex - 1)} className="grid h-9 w-9 place-items-center rounded-full text-foreground-2 transition hover:bg-white/15 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent">
                {I.up}
              </button>
              <ol className="hidden flex-col items-center gap-1.5 py-1 lg:flex" aria-hidden>
                {items.map((g, i) => (
                  <li key={g.id} className={`h-1.5 w-1.5 rounded-full ${i === activeIndex ? "bg-foreground" : "bg-foreground/30"}`} />
                ))}
              </ol>
              <button type="button" aria-label="다음 결과" disabled={activeIndex >= items.length - 1} onClick={() => goTo(activeIndex + 1)} className="grid h-9 w-9 place-items-center rounded-full text-foreground-2 transition hover:bg-white/15 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent">
                {I.downChevron}
              </button>
            </div>
          )}
          <Glyph label="생성" counter={priced && plan.ready ? usd(format, plan.costUsd) : "—"} icon={I.play} active={canGenerate} disabled={!canGenerate} onClick={generate} />
          <Glyph label="취소" counter={canCancel ? fmtElapsed(now - activeStarted) : "—"} icon={I.x} disabled={!canCancel} onClick={() => active && cancel(active)} />
          <Glyph label="다운로드" counter={active?.video ? "MP4" : active?.image ? active.image.format.toUpperCase() : "—"} icon={I.down} disabled={!active?.video && !active?.image} href={(active?.video ?? active?.image)?.downloadUrl} download />
          <Glyph label="갤러리" counter={galleryTotal > 0 ? String(galleryTotal) : "—"} icon={I.grid} href="/gallery" />
          <Glyph label="다시" counter={active ? `×${reuseCount}` : "—"} icon={I.redo} disabled={!active} onClick={() => active && reuse(active)} />
        </div>
      </section>

      {/* DRAWER: the form that puts the next item on the stage. */}
      <aside aria-label="생성 설정" className="order-2 flex w-full flex-col border-t border-border bg-background lg:order-1 lg:h-full lg:w-[480px] lg:shrink-0 lg:border-r lg:border-t-0">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <h1 className="text-base font-semibold">플레이그라운드</h1>

          {offer.unavailable && (
            <div role="status" className="flex items-start gap-2.5 rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-foreground-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              <span>{errorText(offer.unavailable.error)}</span>
            </div>
          )}

          <section className="space-y-3">
            <h2 className="text-xs font-semibold tracking-wider text-muted">1 · 프롬프트와 레퍼런스</h2>
            <Field label="프롬프트" hint={prompt.length > 0 ? `${prompt.length}자` : undefined}>
              <Textarea id="prompt" rows={3} placeholder="장면, 카메라 움직임, 분위기를 적어 주세요…" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            </Field>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button ref={refsButtonRef} variant="outline" size="sm" onClick={() => setRefsOpen(true)} disabled={uploading} aria-haspopup="dialog" aria-expanded={refsOpen}>
                {uploading ? "업로드 중…" : "레퍼런스 추가"}
              </Button>
              <span className="text-xs tabular-nums text-muted">
                이미지 {images.length}/{imageMax}
                {videoMax > 0 && (
                  <>
                    <span className="mx-1.5 text-subtle">·</span>
                    영상 {videos.length}/{videoMax}
                  </>
                )}
                <span className="mx-1.5 text-subtle">·</span>
                <span className="text-subtle">선택</span>
              </span>
            </div>
            {refs.length > 0 && <RefThumbs refs={refs} images={images} videos={videos} onRemove={(id) => setRefs((list) => list.filter((x) => x.id !== id))} />}
            {plan.offersStartFromImage && (
              <label className="flex min-h-11 items-center gap-2 text-sm text-foreground-2 lg:min-h-10">
                <input type="checkbox" checked={startFromImage} onChange={(e) => setStartFromImage(e.target.checked)} className="h-4 w-4" />
                이 이미지로 시작
                <span className="text-xs text-subtle">1번 이미지를 첫 프레임으로</span>
              </label>
            )}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted">생성 방식</div>
              <ol aria-label="생성 방식" className="flex flex-wrap gap-1.5">
                {modesOf(family.id).map((m) => (
                  <li
                    key={m}
                    aria-current={m === mode ? "step" : undefined}
                    className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs ${m === mode ? "bg-foreground font-medium text-background" : "text-subtle"}`}
                  >
                    {MODE_LABEL[m]}
                  </li>
                ))}
              </ol>
              <p aria-live="polite" className="text-xs text-muted">{modeSentence(mode, images.length, videos.length)}</p>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-semibold tracking-wider text-muted">2 · 모델과 하이퍼파라미터</h2>
            <Field label="모델" hint={priced ? `${family.rate.basis} 기준 ${ratePer}` : "단가 미설정"}>
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
                    <optgroup key={output} label={output === "video" ? "영상" : "이미지"}>
                      {group.map((o) => {
                        const f = FAMILIES[o.family];
                        const off = o.unavailable?.status === 503;
                        return (
                          <option key={o.family} value={o.family} disabled={off}>
                            {f.name} · {f.vendor}{off ? " · 사용 불가" : o.rateUsd > 0 ? ` · ${usd(format, o.rateUsd)}/${f.rate.per.short}` : ""}
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
                  <span className="text-foreground">{FAMILIES[o.family].name}</span> 사용 불가 · {o.unavailable && errorText(o.unavailable.error)}
                </span>
              </p>
            ))}
            <p className="text-xs leading-relaxed text-muted">
              {family.blurb}
              <span className="block text-subtle">{family.note}</span>
            </p>
            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-xs font-medium text-muted">
                <span>출력 화면비</span>
                {aspectSpec ? (
                  <span className="font-normal text-subtle">{orientation(...currentAspect) ?? ""}</span>
                ) : (
                  <span className="font-normal text-subtle">첫 프레임 이미지 비율을 따름</span>
                )}
              </div>
              {aspectSpec ? (
                <div role="group" aria-label="출력 화면비" className="flex flex-wrap gap-1.5">
                  {aspectSpec.options.map((o) => {
                    const on = String(params[aspectSpec.key]) === o;
                    return (
                      <button key={o} type="button" aria-pressed={on} onClick={() => setParams((st) => ({ ...st, [aspectSpec.key]: o }))} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${on ? "border-foreground bg-foreground text-background" : "border-border text-foreground-2 hover:border-foreground/60"}`}>
                        {ASPECT_LABEL[o] ?? o}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs leading-relaxed text-foreground-2">
                  {firstImage?.w && firstImage.h ? (
                    <>
                      1번 이미지가 <span className="tabular-nums">{firstImage.w}×{firstImage.h}</span>({orientation(firstImage.w, firstImage.h)})이라 영상도 <span className="font-medium text-foreground">{orientation(firstImage.w, firstImage.h)}</span>로 나옵니다. 가로 영상이 필요하면 가로 이미지를 올리세요.
                    </>
                  ) : (
                    <>이미지→영상은 화면비를 따로 고르지 않고 첫 프레임 이미지의 비율을 따릅니다.</>
                  )}
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
                <span>예상 비용</span>
                {priced && plan.ready ? (
                  <span className="font-display text-2xl leading-none text-sand">{usd(format, plan.costUsd)}</span>
                ) : (
                  <span className="font-semibold text-foreground">{priced ? "—" : "미정"}</span>
                )}
                <span className="text-xs text-subtle">{MODE_LABEL[mode]}</span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-subtle tabular-nums">
                {priced ? estimateNote : `관리자가 단가를 넣으면 ${plan.facts.join(" · ")} 기준으로 계산`}
              </div>
            </div>
            <Button size="lg" onClick={generate} disabled={!canGenerate}>
              {submitting ? "제출 중…" : "생성하기"}
            </Button>
          </div>
        </div>
      </aside>

      {refsOpen && (
        <RefDialog
          modelName={family.name}
          refNote={family.refNote}
          imageHint={family.refImages.hint}
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
    </div>
  );
}
