"use client";

import Link from "next/link";
import { useState } from "react";
import type { PublicGeneration } from "@/lib/generations";
import { usd, fmtDate, fmtRelative, shortModel } from "@/lib/format";
import { Empty } from "@/components/ui";

function expiresIn(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const ms = new Date(d).getTime() - Date.now();
  if (ms <= 0) return "만료됨";
  const days = Math.floor(ms / 86400_000);
  return days > 0 ? `${days}일 남음` : `${Math.floor(ms / 3600_000)}시간 남음`;
}

export function Gallery({ items, isAdmin, showAll }: { items: PublicGeneration[]; isAdmin: boolean; showAll: boolean }) {
  const [open, setOpen] = useState<PublicGeneration | null>(null);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">갤러리</h1>
          <p className="mt-1 text-sm text-zinc-400">완료된 영상 {items.length}건. 결과는 Higgsfield에 7일간만 보관되니 필요한 건 다운로드하세요.</p>
        </div>
        {isAdmin && (
          <div className="flex rounded-lg border border-border p-0.5 text-sm">
            <Link href="/gallery" className={`rounded-md px-3 py-1 ${!showAll ? "bg-white/10" : "text-zinc-400"}`}>
              내 것
            </Link>
            <Link href="/gallery?all=1" className={`rounded-md px-3 py-1 ${showAll ? "bg-white/10" : "text-zinc-400"}`}>
              전체
            </Link>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <Empty>
          완료된 영상이 없습니다. <Link href="/playground" className="text-accent-2 hover:underline">플레이그라운드</Link>에서 첫 영상을 만들어 보세요.
        </Empty>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((g) => {
            const exp = expiresIn(g.expiresAt);
            return (
              <li key={g.id} className="group overflow-hidden rounded-2xl border border-border bg-surface">
                <button type="button" onClick={() => setOpen(g)} className="block w-full">
                  <video src={g.resultUrl ?? undefined} muted loop playsInline preload="metadata" className="aspect-video w-full bg-black object-cover" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
                </button>
                <div className="space-y-1.5 p-3">
                  <p className="line-clamp-2 text-sm text-zinc-200">{g.prompt || "(프롬프트 없음)"}</p>
                  <div className="flex items-center justify-between text-[11px] text-zinc-500">
                    <span>
                      {shortModel(g.modelId)} · {g.durationS}s · {usd(g.costUsd)}
                    </span>
                    <span>{g.username ? `${g.username} · ` : ""}{fmtRelative(g.createdAt)}</span>
                  </div>
                  {exp && <div className={`text-[11px] ${exp === "만료됨" ? "text-rose-400" : "text-amber-400/80"}`}>보관 {exp}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(null)}>
          <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-surface" onClick={(e) => e.stopPropagation()}>
            <video src={open.resultUrl ?? undefined} controls autoPlay loop className="w-full bg-black" />
            <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto]">
              <div className="space-y-2">
                <p className="text-sm text-zinc-100">{open.prompt || "(프롬프트 없음)"}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-zinc-400">
                  <dt>모델</dt>
                  <dd className="font-mono text-zinc-300">{open.modelId}</dd>
                  <dt>파라미터</dt>
                  <dd className="font-mono text-zinc-300">{JSON.stringify(open.params)}</dd>
                  <dt>레퍼런스</dt>
                  <dd>이미지 {open.imageRefs.length} · 영상 {open.videoRefs.length}</dd>
                  <dt>생성</dt>
                  <dd>{fmtDate(open.createdAt)} · {usd(open.costUsd)}</dd>
                </dl>
              </div>
              <div className="flex flex-col gap-2">
                {open.resultUrl && (
                  <a href={open.resultUrl} download target="_blank" rel="noreferrer" className="rounded-lg bg-accent px-4 py-2 text-center text-sm font-medium text-white hover:bg-violet-500">
                    다운로드
                  </a>
                )}
                <button type="button" onClick={() => setOpen(null)} className="rounded-lg border border-border px-4 py-2 text-sm text-zinc-300 hover:bg-white/5">
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
