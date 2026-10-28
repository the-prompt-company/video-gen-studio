"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PublicGeneration, PublicVideo } from "@/lib/generations";
import { findModel } from "@/lib/catalog";
import { usd, fmtDate, fmtRelative, shortModel } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/generation-status";
import { Button, Empty } from "@/components/ui";

function expiresIn(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const ms = new Date(d).getTime() - Date.now();
  if (ms <= 0) return "만료됨";
  const days = Math.floor(ms / 86400_000);
  return days > 0 ? `${days}일 남음` : `${Math.floor(ms / 3600_000)}시간 남음`;
}

function retention(v: PublicVideo | null): string | null {
  if (!v) return null;
  return v.kind === "stored" ? "영구" : expiresIn(v.expiresAt);
}

/** "16:9" from params when the model exposes it, otherwise from the loaded video's pixels. */
function aspectLabel(g: PublicGeneration, w?: number, h?: number): string | null {
  const p = (g.params as Record<string, unknown>)?.aspect_ratio;
  if (typeof p === "string" && p !== "adaptive") return p;
  if (!w || !h) return null;
  const r = w / h;
  if (Math.abs(r - 16 / 9) < 0.05) return "16:9";
  if (Math.abs(r - 9 / 16) < 0.05) return "9:16";
  if (Math.abs(r - 1) < 0.05) return "1:1";
  if (Math.abs(r - 21 / 9) < 0.08) return "21:9";
  return `${w}×${h}`;
}

function orientationWord(label: string | null) {
  if (!label) return null;
  const [a, b] = label.split(/[:×]/).map(Number);
  if (!a || !b) return null;
  return a > b ? "가로" : a < b ? "세로" : "정사각";
}

function modelName(id: string) {
  return findModel(id)?.name ?? shortModel(id);
}

function paramLabel(modelId: string, key: string) {
  return findModel(modelId)?.params.find((p) => p.key === key)?.label ?? key;
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

function Tile({ g, onOpen }: { g: PublicGeneration; onOpen: () => void }) {
  const { ref, size, read } = useVideoSize();
  const { ref: tileRef, near } = useNearViewport<HTMLLIElement>("0px 0px 80px 0px");
  const label = aspectLabel(g, size?.w, size?.h);
  const keep = retention(g.video);
  return (
    <li ref={tileRef} className="group overflow-hidden rounded-xl border border-border bg-surface">
      <button type="button" onClick={onOpen} className="relative block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent" aria-label={`${g.prompt || "프롬프트 없음"} 자세히 보기`}>
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
        {label && (
          <span className="font-display absolute left-2 top-2 rounded-sm bg-background/80 px-1.5 pt-0.5 text-[14px] leading-none text-sand">
            {label}
          </span>
        )}
        <span className="font-display absolute right-2 top-2 rounded-sm bg-background/80 px-1.5 pt-0.5 text-[14px] leading-none text-foreground-2">{g.durationS}S</span>
      </button>
      <div className="space-y-1.5 p-3">
        <p className="line-clamp-2 text-sm text-foreground-2">{g.prompt || "(프롬프트 없음)"}</p>
        <div className="flex items-center justify-between gap-2 text-[11px] text-subtle">
          <span className="truncate">
            {modelName(g.modelId)} · <span className="tabular-nums">{usd(g.costUsd)}</span>
          </span>
          <span className="shrink-0">{g.username ? `${g.username} · ` : ""}{fmtRelative(g.createdAt)}</span>
        </div>
        {keep && <div className={`text-[11px] ${keep === "만료됨" ? "text-rose-300" : "text-subtle"}`}>보관 {keep}</div>}
      </div>
    </li>
  );
}

function Detail({ g, onClose }: { g: PublicGeneration; onClose: () => void }) {
  const { ref, size, read } = useVideoSize();
  const label = aspectLabel(g, size?.w, size?.h);
  const params = Object.entries((g.params as Record<string, unknown>) ?? {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="생성 상세" className="flex max-h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-[58dvh] min-h-[240px] shrink-0 items-center justify-center overflow-hidden bg-background">
          <video
            ref={ref}
            src={g.video?.url}
            controls
            autoPlay
            loop
            playsInline
            className="h-full w-full object-contain"
            onLoadedMetadata={read}
            aria-label="생성된 영상"
          />
        </div>
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-[minmax(0,1fr)_200px]">
          <div className="min-w-0 space-y-4">
            <div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
                <span className="text-foreground-2">{modelName(g.modelId)}</span>
                {label && (
                  <span className="font-display text-[15px] text-sand">
                    {label}
                    {orientationWord(label) && <span className="ml-1 font-sans text-xs text-muted">{orientationWord(label)}</span>}
                  </span>
                )}
                {size && <span className="tabular-nums">{size.w}×{size.h}</span>}
                <span className="font-display text-[15px] text-sand">{g.durationS}S · {usd(g.costUsd)}</span>
                <span>{STATUS_LABEL[g.status]}</span>
              </div>
              <p className="mt-2 break-words text-sm leading-relaxed text-foreground">{g.prompt || "(프롬프트 없음)"}</p>
            </div>

            {(g.imageRefs.length > 0 || g.videoRefs.length > 0) && (
              <div>
                <h3 className="mb-2 text-xs font-medium text-muted">
                  레퍼런스 · 이미지 {g.imageRefs.length} · 영상 {g.videoRefs.length}
                </h3>
                <ul className="flex flex-wrap gap-2">
                  {g.imageRefs.map((u, i) => (
                    <li key={u} className="relative h-20 overflow-hidden rounded-md border border-border bg-background">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`이미지 레퍼런스 ${i + 1}`} className="h-full w-auto object-contain" />
                      <span aria-hidden className="font-display absolute left-1 top-0.5 text-[13px] text-foreground drop-shadow">{i + 1}</span>
                    </li>
                  ))}
                  {g.videoRefs.map((u, i) => (
                    <li key={u} className="relative h-20 overflow-hidden rounded-md border border-border bg-background">
                      <video src={u} muted playsInline preload="metadata" className="h-full w-auto object-contain" aria-label={`영상 레퍼런스 ${i + 1}`} onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
                      <span aria-hidden className="font-display absolute left-1 top-0.5 text-[13px] text-foreground drop-shadow">V{i + 1}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
              {params.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{paramLabel(g.modelId, k)}</dt>
                  <dd className="break-words tabular-nums text-foreground-2">{typeof v === "boolean" ? (v ? "켬" : "끔") : String(v)}</dd>
                </div>
              ))}
              <dt className="text-muted">생성</dt>
              <dd className="tabular-nums text-foreground-2">{fmtDate(g.createdAt)}</dd>
              {g.completedAt && (
                <>
                  <dt className="text-muted">완료</dt>
                  <dd className="tabular-nums text-foreground-2">{fmtDate(g.completedAt)}</dd>
                </>
              )}
              {g.video?.kind === "stored" && (
                <>
                  <dt className="text-muted">보관</dt>
                  <dd className="text-foreground-2">영구</dd>
                </>
              )}
              {g.video?.kind === "provider" && g.video.expiresAt && (
                <>
                  <dt className="text-muted">보관</dt>
                  <dd className="tabular-nums text-foreground-2">{fmtDate(g.video.expiresAt)}까지 · {expiresIn(g.video.expiresAt)}</dd>
                </>
              )}
              {g.username && (
                <>
                  <dt className="text-muted">사용자</dt>
                  <dd className="text-foreground-2">{g.username}</dd>
                </>
              )}
            </dl>
          </div>
          <div className="flex gap-2 md:flex-col">
            {g.video && (
              <a href={g.video.downloadUrl} download target="_blank" rel="noreferrer" className="inline-flex h-10 flex-1 items-center justify-center rounded-full bg-accent px-5 text-sm font-medium text-background transition hover:bg-accent-hover md:flex-none">
                다운로드
              </a>
            )}
            <Button variant="outline" onClick={onClose} className="flex-1 md:flex-none">
              닫기
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Gallery({ items, isAdmin, showAll }: { items: PublicGeneration[]; isAdmin: boolean; showAll: boolean }) {
  const [open, setOpen] = useState<PublicGeneration | null>(null);
  const expiring = items.some((g) => g.video?.kind === "provider");

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">갤러리</h1>
          <p className="mt-1 text-sm text-muted">
            완료된 영상 {items.length}건.{expiring ? " 영구 보관이 아닌 결과는 Higgsfield에 7일간만 남으니 필요한 건 다운로드하세요." : ""}
          </p>
        </div>
        {isAdmin && (
          <div className="flex rounded-full border border-border p-0.5 text-sm">
            <Link href="/gallery" className={`rounded-full px-3 py-1 ${!showAll ? "bg-white/12 text-foreground" : "text-muted"}`}>
              내 것
            </Link>
            <Link href="/gallery?all=1" className={`rounded-full px-3 py-1 ${showAll ? "bg-white/12 text-foreground" : "text-muted"}`}>
              전체
            </Link>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <Empty>
          완료된 영상이 없습니다. <Link href="/playground" className="text-accent-soft underline-offset-4 hover:underline">플레이그라운드</Link>에서 첫 영상을 만들어 보세요.
        </Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((g) => (
            <Tile key={g.id} g={g} onOpen={() => setOpen(g)} />
          ))}
        </ul>
      )}

      {open && <Detail g={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
