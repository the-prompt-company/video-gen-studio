"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelSpec, ParamSpec } from "@/lib/catalog";
import { defaultParams } from "@/lib/catalog";
import type { PublicGeneration } from "@/lib/generations";
import { usd, STATUS_LABEL, shortModel } from "@/lib/format";
import { Button, ErrorText, Field, Input, Select, Textarea } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";

type ModelWithPrice = ModelSpec & { pricePerSecUsd: number };
type Ref = { id: string; url: string; name: string; kind: "image" | "video"; local?: string; w?: number; h?: number };

const ASPECT_LABEL: Record<string, string> = {
  "16:9": "가로 16:9",
  "21:9": "가로 21:9",
  "4:3": "가로 4:3",
  "9:16": "세로 9:16",
  "3:4": "세로 3:4",
  "1:1": "정사각 1:1",
  adaptive: "레퍼런스 따라감",
};

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

const SMALL = 4 * 1024 * 1024;
const MAX_IMAGES = 6;
const MAX_VIDEOS = 3;
const LIVE = new Set(["queued", "in_progress"]);
const FEED_LIMIT = 12;

async function uploadFile(file: File, largeUploads: boolean): Promise<string> {
  if (file.size <= SMALL) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? (res.status === 413 ? "파일이 너무 큽니다 (4 MB 이하)" : `업로드 실패 (${res.status})`));
    return body.url;
  }
  if (!largeUploads) throw new Error("4 MB를 넘는 파일은 Blob 스토어가 연결돼야 올릴 수 있습니다");
  const { upload: blobUpload } = await import("@vercel/blob/client");
  const blob = await blobUpload(`refs/${Date.now()}-${file.name}`, file, { access: "public", handleUploadUrl: "/api/uploads/blob", multipart: true });
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
    case "int":
    case "float": {
      const isRange = spec.max - spec.min <= 100;
      return (
        <Field label={spec.label} hint={isRange ? String(value) : `${spec.min}~${spec.max}`}>
          {isRange ? (
            <input type="range" min={spec.min} max={spec.max} step={spec.type === "float" ? spec.step : 1} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
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
              <option key={o} value={o}>{o}</option>
            ))}
          </Select>
        </Field>
      );
    case "text":
      return (
        <Field label={spec.label} hint={spec.optional ? "선택" : undefined}>
          <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
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
  const live = LIVE.has(g.status);
  const started = new Date(g.createdAt).getTime();
  const took = g.completedAt ? new Date(g.completedAt).getTime() - started : now - started;
  const label = STATUS_LABEL[g.status] ?? g.status;
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

      {g.status === "completed" && g.resultUrl ? (
        <div className="min-h-0 flex-1 pt-[72px] lg:h-full lg:pt-0">
          <video src={g.resultUrl} controls={active} autoPlay={active} loop muted playsInline preload={active ? "auto" : "metadata"} className="h-full w-full object-contain" aria-label="생성된 영상" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 pt-[72px] text-center lg:h-full lg:pt-0">
          {live ? (
            <>
              <span aria-hidden className="h-14 w-14 animate-spin rounded-full border-2 border-foreground border-t-transparent [animation-duration:1.4s]" />
              <span className="font-display text-7xl leading-none text-foreground sm:text-8xl" aria-live="polite">{fmtElapsed(took)}</span>
              <span className="text-sm text-muted">{label} · 경과 시간</span>
            </>
          ) : (
            <>
              <span className="text-4xl font-semibold leading-none tracking-tight text-foreground-2 sm:text-5xl">{label}</span>
              <p className="max-w-md text-sm text-muted">{g.error ?? (g.status === "canceled" ? "취소된 생성입니다." : "결과 영상이 없습니다.")}</p>
            </>
          )}
        </div>
      )}

      {/* Caption scrim */}
      <div className={`pointer-events-none shrink-0 bg-surface px-4 pb-4 pt-3 lg:scrim lg:absolute lg:inset-x-0 lg:bottom-0 lg:z-10 lg:bg-transparent lg:px-5 lg:pt-24 ${g.status === "completed" && active ? "lg:pb-16" : "lg:pb-5"}`}>
        <div className="text-xs text-muted">
          <span className="text-foreground-2">{modelName}</span>
          <span className="font-display ml-2 text-sm text-sand">{g.durationS}S · {usd(g.costUsd)}</span>
          {typeof (g.params as Record<string, unknown>)?.aspect_ratio === "string" && (
            <span className="font-display ml-2 text-sm text-sand">{String((g.params as Record<string, unknown>).aspect_ratio).toUpperCase()}</span>
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
            {r.w && r.h && <span aria-hidden className="absolute bottom-1 right-1.5 text-[10px] tabular-nums text-foreground-2 drop-shadow">{orientation(r.w, r.h)}</span>}
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

function RefDialog({ model, refs, images, videos, imageMax, videoMax, uploading, largeUploads, error, onAdd, onRemove, onClose }: {
  model: ModelWithPrice; refs: Ref[]; images: Ref[]; videos: Ref[]; imageMax: number; videoMax: number; uploading: boolean; largeUploads: boolean; error: string | null;
  onAdd: (files: FileList | null, kind: "image" | "video") => void; onRemove: (id: string) => void; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const first = images[0];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/85 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="ref-dialog-title" className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-xl border border-border bg-surface focus:outline-none sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h2 id="ref-dialog-title" className="text-base font-semibold">레퍼런스 추가</h2>
            <p className="text-xs text-muted">{model.name} · 이미지 최대 {imageMax}장{videoMax > 0 ? ` · 영상 최대 ${videoMax}개` : " · 영상 미지원"}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="닫기">닫기</Button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <DropZone kind="image" max={imageMax} count={images.length} disabled={false} uploading={uploading} hint="jpeg · png · webp · gif · 4 MB 이하" accept="image/jpeg,image/png,image/webp,image/gif" onFiles={(f) => onAdd(f, "image")} />
            <DropZone kind="video" max={videoMax} count={videos.length} disabled={videoMax === 0} uploading={uploading} hint={videoMax === 0 ? "" : largeUploads ? "mp4 · 최대 200 MB" : "mp4 · 4 MB 이하"} accept="video/mp4" onFiles={(f) => onAdd(f, "video")} />
          </div>

          <p className="text-xs leading-relaxed text-muted">
            {model.images.field === "image_url" ? (
              <>이 모델은 1번 이미지를 첫 프레임, 2번 이미지를 마지막 프레임으로 씁니다. 화면비 옵션이 없어 영상은 1번 이미지의 비율을 따릅니다{first?.w && first.h ? <>: 지금은 <span className="font-medium text-foreground">{orientation(first.w, first.h)}</span>({first.w}×{first.h}).</> : "."}</>
            ) : (
              <>이미지와 영상은 올린 순서대로 번호가 붙고 그 순서로 모델에 전달됩니다. 출력 화면비는 서랍의 ‘출력 화면비’에서 따로 고릅니다.</>
            )}
          </p>

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

export function Playground({ models, hasApiKey, largeUploads, galleryCount }: { models: ModelWithPrice[]; hasApiKey: boolean; largeUploads: boolean; galleryCount: number }) {
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const model = useMemo(() => models.find((m) => m.id === modelId) ?? models[0], [models, modelId]);
  const [params, setParams] = useState<Record<string, unknown>>(() => (model ? defaultParams(model) : {}));
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<Ref[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [refsOpen, setRefsOpen] = useState(false);
  const refsButtonRef = useRef<HTMLButtonElement>(null);
  const [items, setItems] = useState<PublicGeneration[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const feedRef = useRef<HTMLDivElement>(null);

  const [galleryTotal, setGalleryTotal] = useState(galleryCount);

  function upsert(item: PublicGeneration) {
    setItems((list) => {
      const prev = list.find((x) => x.id === item.id);
      if (item.status === "completed" && prev && prev.status !== "completed") setGalleryTotal((n) => n + 1);
      return prev ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list].slice(0, FEED_LIMIT);
    });
  }

  useEffect(() => {
    fetch(`/api/generations?limit=${FEED_LIMIT}`)
      .then((r) => r.json())
      .then((b: { items?: PublicGeneration[] }) => {
        setItems(b.items ?? []);
        setActiveId(b.items?.[0]?.id ?? null);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const liveIds = useMemo(() => items.filter((i) => LIVE.has(i.status)).map((i) => i.id), [items]);
  const liveKey = liveIds.join(",");

  // Poll every live item with backoff (2s → ×1.5 → cap 10s), as Higgsfield recommends.
  useEffect(() => {
    if (!liveKey) return;
    const ids = liveKey.split(",");
    let delay = 2000;
    let stopped = false;
    let t = 0;
    const tick = async () => {
      if (stopped) return;
      await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/generations/${id}`, { cache: "no-store" });
            const body = (await res.json()) as { item?: PublicGeneration };
            if (body.item) upsert(body.item);
          } catch {
            /* retry on next tick */
          }
        }),
      );
      if (stopped) return;
      delay = Math.min(10000, delay * 1.5) + Math.random() * 500;
      t = window.setTimeout(tick, delay);
    };
    t = window.setTimeout(tick, delay);
    return () => {
      stopped = true;
      window.clearTimeout(t);
    };
  }, [liveKey]);

  // Elapsed-time clock while anything is live.
  useEffect(() => {
    if (!liveKey) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
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
  const imageMax = model ? Math.min(MAX_IMAGES, model.images.max) : 0;
  const videoMax = model?.videos ? Math.min(MAX_VIDEOS, model.videos.max) : 0;
  const duration = Number(params[model?.durationKey ?? "duration"] ?? 0);
  const estimate = (model?.pricePerSecUsd ?? 0) * duration;

  async function addFiles(files: FileList | null, kind: "image" | "video") {
    if (!files || !model) return;
    const room = kind === "image" ? imageMax - images.length : videoMax - videos.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (picked.length === 0) {
      setError(kind === "image" ? `이미지는 최대 ${imageMax}장` : videoMax === 0 ? "이 모델은 영상 레퍼런스를 받지 않습니다" : `영상은 최대 ${videoMax}개`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      for (const f of picked) {
        const url = await uploadFile(f, largeUploads);
        const size = kind === "image" ? await readImageSize(f) : null;
        setRefs((r) => [...r, { id: crypto.randomUUID(), url, name: f.name, kind, local: URL.createObjectURL(f), w: size?.w, h: size?.h }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function generate() {
    if (!model) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: model.id, prompt, params, imageUrls: images.map((r) => r.url), videoUrls: videos.map((r) => r.url) }),
      });
      const body = (await res.json().catch(() => ({}))) as { item?: PublicGeneration; error?: string };
      if (!res.ok || !body.item) throw new Error(body.error ?? `제출 실패 (${res.status})`);
      upsert(body.item);
      setActiveId(body.item.id);
      feedRef.current?.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
      feedRef.current?.closest("section")?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(g: PublicGeneration) {
    try {
      const res = await fetch(`/api/generations/${g.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { item?: PublicGeneration; error?: string };
      if (body.item) upsert(body.item);
      else setError(body.error ?? `취소 실패 (${res.status})`);
    } catch {
      setError("서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요");
    }
  }

  function reuse(g: PublicGeneration) {
    const m = models.find((x) => x.id === g.modelId) ?? model;
    if (!m) return;
    setModelId(m.id);
    setParams({ ...defaultParams(m), ...((g.params as Record<string, unknown>) ?? {}) });
    setPrompt(g.prompt ?? "");
    setRefs([]);
    setError(null);
    document.getElementById("prompt")?.focus();
  }

  if (!model) return <div className="p-8 text-center text-sm text-subtle">사용할 수 있는 모델이 없습니다. 관리자에게 문의하세요.</div>;

  const aspectSpec = model.params.find((p): p is Extract<ParamSpec, { type: "enum" }> => p.key === "aspect_ratio" && p.type === "enum");
  const firstImage = images[0];
  const currentAspect: [number?, number?] = (() => {
    const v = aspectSpec ? String(params[aspectSpec.key]) : "";
    const m = /^(\d+):(\d+)$/.exec(v);
    if (m) return [Number(m[1]), Number(m[2])];
    if (v === "adaptive" && firstImage?.w && firstImage.h) return [firstImage.w, firstImage.h];
    return [undefined, undefined];
  })();
  const canGenerate = hasApiKey && !submitting && !uploading;
  const canCancel = Boolean(active && active.status === "queued");
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
            items.map((g, i) => <FeedItem key={g.id} g={g} index={i} total={items.length} active={g.id === active?.id} now={now} modelName={models.find((m) => m.id === g.modelId)?.name ?? shortModel(g.modelId)} />)
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
          <Glyph label="생성" counter={model.pricePerSecUsd > 0 ? usd(estimate) : "—"} icon={I.play} active={canGenerate} disabled={!canGenerate} onClick={generate} />
          <Glyph label="취소" counter={canCancel ? fmtElapsed(now - activeStarted) : "—"} icon={I.x} disabled={!canCancel} onClick={() => active && cancel(active)} />
          <Glyph label="다운로드" counter={active?.status === "completed" && active.resultUrl ? "MP4" : "—"} icon={I.down} disabled={!active || active.status !== "completed" || !active.resultUrl} href={active?.resultUrl ?? undefined} download />
          <Glyph label="갤러리" counter={galleryTotal > 0 ? String(galleryTotal) : "—"} icon={I.grid} href="/gallery" />
          <Glyph label="다시" counter={active ? `×${reuseCount}` : "—"} icon={I.redo} disabled={!active} onClick={() => active && reuse(active)} />
        </div>
      </section>

      {/* DRAWER: the form that puts the next item on the stage. */}
      <aside aria-label="생성 설정" className="order-2 flex w-full flex-col border-t border-border bg-background lg:order-1 lg:h-full lg:w-[480px] lg:shrink-0 lg:border-r lg:border-t-0">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <h1 className="text-base font-semibold">플레이그라운드</h1>

          {!hasApiKey && (
            <div role="status" className="flex items-start gap-2.5 rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-foreground-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              <span>API 키가 아직 할당되지 않았습니다. 관리자가 어드민에서 키를 넣어야 생성할 수 있습니다.</span>
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
                <span className="mx-1.5 text-subtle">·</span>
                영상 {videoMax === 0 ? "미지원" : `${videos.length}/${videoMax}`}
              </span>
            </div>
            {refs.length > 0 && <RefThumbs refs={refs} images={images} videos={videos} onRemove={(id) => setRefs((list) => list.filter((x) => x.id !== id))} />}
          </section>

          <section className="space-y-3">
            <h2 className="text-xs font-semibold tracking-wider text-muted">2 · 모델과 하이퍼파라미터</h2>
            <Field label="모델" hint={model.pricePerSecUsd > 0 ? `${usd(model.pricePerSecUsd)}/s` : "단가 미설정"}>
              <Select
                value={model.id}
                onChange={(e) => {
                  const m = models.find((x) => x.id === e.target.value);
                  if (!m) return;
                  setModelId(m.id);
                  setParams(defaultParams(m));
                  setRefs([]);
                  setError(null);
                }}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.vendor}{m.pricePerSecUsd > 0 ? ` · ${usd(m.pricePerSecUsd)}/s` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs leading-relaxed text-muted">
              {model.blurb}
              {model.note && <span className="block text-subtle">{model.note}</span>}
            </p>
            <div className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-xs font-medium text-muted">
                <span>출력 화면비</span>
                {aspectSpec ? (
                  <span className="font-normal text-subtle">{orientation(...currentAspect) ?? ""}</span>
                ) : (
                  <span className="font-normal text-subtle">레퍼런스 이미지 비율을 따름</span>
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
                      1번 레퍼런스가 <span className="tabular-nums">{firstImage.w}×{firstImage.h}</span>({orientation(firstImage.w, firstImage.h)})이라 영상도 <span className="font-medium text-foreground">{orientation(firstImage.w, firstImage.h)}</span>로 나옵니다. 가로 영상이 필요하면 가로 이미지를 올리세요.
                    </>
                  ) : (
                    <>화면비 옵션이 없는 모델입니다. 1번 레퍼런스 이미지의 비율을 따르니 가로 영상은 가로 이미지를 올리세요.</>
                  )}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {model.params.filter((p) => p.key !== "aspect_ratio").map((p) => (
                <ParamInput key={p.key} spec={p} value={params[p.key]} onChange={(v) => setParams((s) => ({ ...s, [p.key]: v }))} />
              ))}
            </div>
            {error && <ErrorText>{error}</ErrorText>}
          </section>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border bg-background/90 px-5 py-3 backdrop-blur">
          <div className="min-w-0 text-sm text-muted">
            <div className="flex items-baseline gap-2">
              <span>예상 비용</span>
              {model.pricePerSecUsd > 0 ? (
                <span className="font-display text-2xl leading-none text-sand">{usd(estimate)}</span>
              ) : (
                <span className="font-semibold text-foreground">미정</span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-subtle tabular-nums">
              {model.pricePerSecUsd > 0 ? `${duration}s × ${usd(model.pricePerSecUsd)}/s` : `관리자가 단가를 넣으면 ${duration}s 기준으로 계산`}
            </div>
          </div>
          <Button size="lg" onClick={generate} disabled={!canGenerate}>
            {submitting ? "제출 중…" : "생성하기"}
          </Button>
        </div>
      </aside>

      {refsOpen && (
        <RefDialog
          model={model}
          refs={refs}
          images={images}
          videos={videos}
          imageMax={imageMax}
          videoMax={videoMax}
          uploading={uploading}
          largeUploads={largeUploads}
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
