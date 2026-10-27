"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { upload as blobUpload } from "@vercel/blob/client";
import type { ModelSpec, ParamSpec } from "@/lib/catalog";
import { defaultParams } from "@/lib/catalog";
import type { PublicGeneration } from "@/lib/generations";
import { usd, STATUS_LABEL } from "@/lib/format";
import { Button, Card, Field, Input, Select, Textarea, Empty } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";

type ModelWithPrice = ModelSpec & { pricePerSecUsd: number };
type Ref = { url: string; name: string; kind: "image" | "video"; local?: string };

const SMALL = 4 * 1024 * 1024;
const MAX_IMAGES = 6;
const MAX_VIDEOS = 3;

async function uploadFile(file: File, largeUploads: boolean): Promise<string> {
  if (file.size <= SMALL) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/uploads", { method: "POST", body: fd });
    const body = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !body.url) throw new Error(body.error ?? "업로드 실패");
    return body.url;
  }
  if (!largeUploads) throw new Error("4 MB를 넘는 파일은 Blob 스토어가 연결돼야 올릴 수 있습니다");
  const blob = await blobUpload(`refs/${Date.now()}-${file.name}`, file, {
    access: "public",
    handleUploadUrl: "/api/uploads/blob",
    multipart: true,
  });
  return blob.url;
}

function ParamInput({ spec, value, onChange }: { spec: ParamSpec; value: unknown; onChange: (v: unknown) => void }) {
  switch (spec.type) {
    case "int":
    case "float": {
      const isRange = spec.max - spec.min <= 100;
      return (
        <Field label={spec.label} hint={isRange ? String(value) : `${spec.min}~${spec.max}`}>
          {isRange ? (
            <input
              type="range"
              min={spec.min}
              max={spec.max}
              step={spec.type === "float" ? spec.step : 1}
              value={Number(value)}
              onChange={(e) => onChange(Number(e.target.value))}
              className="w-full"
            />
          ) : (
            <Input type="number" min={spec.min} max={spec.max} value={String(value)} onChange={(e) => onChange(e.target.value)} />
          )}
        </Field>
      );
    }
    case "bool":
      return (
        <label className="flex h-10 items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-violet-600" />
          {spec.label}
        </label>
      );
    case "enum":
      return (
        <Field label={spec.label}>
          <Select value={String(value)} onChange={(e) => onChange(e.target.value)}>
            {spec.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
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

export function Playground({ models, hasApiKey, largeUploads }: { models: ModelWithPrice[]; hasApiKey: boolean; largeUploads: boolean }) {
  const [modelId, setModelId] = useState(models[0]?.id ?? "");
  const model = useMemo(() => models.find((m) => m.id === modelId) ?? models[0], [models, modelId]);
  const [params, setParams] = useState<Record<string, unknown>>(() => (model ? defaultParams(model) : {}));
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<Ref[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<PublicGeneration | null>(null);
  const [recent, setRecent] = useState<PublicGeneration[]>([]);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/generations?limit=8")
      .then((r) => r.json())
      .then((b: { items?: PublicGeneration[] }) => setRecent(b.items ?? []))
      .catch(() => {});
  }, []);

  // Poll the current generation with backoff (2s → ×1.5 → cap 10s), as Higgsfield recommends.
  useEffect(() => {
    if (!current || !["queued", "in_progress"].includes(current.status)) return;
    let delay = 2000;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/generations/${current.id}`, { cache: "no-store" });
        const body = (await res.json()) as { item?: PublicGeneration; error?: string };
        if (body.item) {
          setCurrent(body.item);
          setRecent((list) => [body.item!, ...list.filter((x) => x.id !== body.item!.id)].slice(0, 8));
          if (!["queued", "in_progress"].includes(body.item.status)) return;
        }
      } catch {
        /* retry */
      }
      delay = Math.min(10000, delay * 1.5) + Math.random() * 500;
      pollRef.current = window.setTimeout(tick, delay);
    };
    pollRef.current = window.setTimeout(tick, delay);
    return () => {
      stopped = true;
      if (pollRef.current) window.clearTimeout(pollRef.current);
    };
  }, [current?.id, current?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const images = refs.filter((r) => r.kind === "image");
  const videos = refs.filter((r) => r.kind === "video");
  const imageMax = model ? Math.min(MAX_IMAGES, model.images.max) : 0;
  const videoMax = model?.videos ? Math.min(MAX_VIDEOS, model.videos.max) : 0;
  const duration = Number(params[model?.durationKey ?? "duration"] ?? 0);
  const estimate = (model?.pricePerSecUsd ?? 0) * duration;

  async function addFiles(files: FileList | null, kind: "image" | "video") {
    if (!files || !model) return;
    const room = (kind === "image" ? imageMax - images.length : videoMax - videos.length);
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
        setRefs((r) => [...r, { url, name: f.name, kind, local: URL.createObjectURL(f) }]);
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
        body: JSON.stringify({
          modelId: model.id,
          prompt,
          params,
          imageUrls: images.map((r) => r.url),
          videoUrls: videos.map((r) => r.url),
        }),
      });
      const body = (await res.json()) as { item?: PublicGeneration; error?: string };
      if (!res.ok || !body.item) throw new Error(body.error ?? "제출 실패");
      setCurrent(body.item);
      setRecent((list) => [body.item!, ...list].slice(0, 8));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelCurrent() {
    if (!current) return;
    const res = await fetch(`/api/generations/${current.id}`, { method: "DELETE" });
    const body = (await res.json()) as { item?: PublicGeneration; error?: string };
    if (body.item) setCurrent(body.item);
    else if (body.error) setError(body.error);
  }

  if (!model) return <Empty>사용할 수 있는 모델이 없습니다. 관리자에게 문의하세요.</Empty>;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        {!hasApiKey && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            API 키가 아직 할당되지 않았습니다. 관리자가 어드민에서 키를 넣어야 생성할 수 있습니다.
          </div>
        )}

        <Card title="1 · 프롬프트와 레퍼런스">
          <Textarea rows={4} placeholder="장면, 카메라 움직임, 분위기를 적어 주세요…" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 flex items-baseline justify-between text-xs text-zinc-400">
                <span>이미지 레퍼런스</span>
                <span>
                  {images.length}/{imageMax}
                  {model.images.field === "image_url" && " · 1번=첫 프레임, 2번=마지막 프레임"}
                </span>
              </div>
              <label className="flex h-24 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border text-sm text-zinc-500 hover:border-accent hover:text-zinc-300">
                {uploading ? "업로드 중…" : "클릭해서 이미지 추가 (jpeg/png/webp/gif)"}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden disabled={uploading || images.length >= imageMax} onChange={(e) => addFiles(e.target.files, "image")} />
              </label>
            </div>
            <div>
              <div className="mb-2 flex items-baseline justify-between text-xs text-zinc-400">
                <span>영상 레퍼런스 (video-to-video)</span>
                <span>{videoMax === 0 ? "이 모델은 미지원" : `${videos.length}/${videoMax}`}</span>
              </div>
              <label className={`flex h-24 items-center justify-center rounded-xl border border-dashed border-border text-sm text-zinc-500 ${videoMax === 0 ? "opacity-40" : "cursor-pointer hover:border-accent hover:text-zinc-300"}`}>
                {uploading ? "업로드 중…" : largeUploads ? "클릭해서 mp4 추가 (최대 200 MB)" : "클릭해서 mp4 추가 (최대 4 MB)"}
                <input type="file" accept="video/mp4" hidden disabled={uploading || videoMax === 0 || videos.length >= videoMax} onChange={(e) => addFiles(e.target.files, "video")} />
              </label>
            </div>
          </div>
          {refs.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {refs.map((r, i) => (
                <li key={r.url} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-border bg-surface-2">
                  {r.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.local ?? r.url} alt={r.name} className="h-full w-full object-cover" />
                  ) : (
                    <video src={r.local ?? r.url} className="h-full w-full object-cover" muted />
                  )}
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1 font-mono text-[10px]">{i + 1}</span>
                  <button
                    type="button"
                    onClick={() => setRefs((list) => list.filter((x) => x.url !== r.url))}
                    className="absolute inset-x-0 bottom-0 bg-black/70 py-0.5 text-[11px] text-rose-300 opacity-0 transition group-hover:opacity-100"
                  >
                    제거
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="2 · 모델과 하이퍼파라미터">
          <div className="grid gap-3 sm:grid-cols-3">
            {models.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setModelId(m.id);
                  setParams(defaultParams(m));
                  setRefs([]);
                }}
                className={`rounded-xl border p-3 text-left transition ${m.id === model.id ? "border-accent bg-accent/10" : "border-border bg-surface-2 hover:border-zinc-600"}`}
              >
                <div className="text-sm font-medium">{m.name}</div>
                <div className="mt-0.5 text-[11px] text-zinc-500">{m.vendor} · {m.pricePerSecUsd > 0 ? `${usd(m.pricePerSecUsd)}/s` : "단가 미설정"}</div>
                <div className="mt-1.5 text-xs text-zinc-400">{m.blurb}</div>
              </button>
            ))}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {model.params.map((p) => (
              <ParamInput key={p.key} spec={p} value={params[p.key]} onChange={(v) => setParams((s) => ({ ...s, [p.key]: v }))} />
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="text-sm text-zinc-400">
              예상 비용 <span className="font-semibold text-zinc-100">{usd(estimate)}</span>
              <span className="text-zinc-500"> · {duration}s × {usd(model.pricePerSecUsd)}/s</span>
            </div>
            <Button size="lg" onClick={generate} disabled={submitting || uploading || !hasApiKey}>
              {submitting ? "제출 중…" : "생성하기"}
            </Button>
          </div>
          {error && <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
        </Card>
      </div>

      <div className="space-y-6">
        <Card title="진행 상황" action={current && current.status === "queued" ? <Button size="sm" variant="ghost" onClick={cancelCurrent}>취소</Button> : null}>
          {!current ? (
            <Empty>아직 제출한 생성이 없습니다.</Empty>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <StatusBadge status={current.status} />
                <span className="text-xs text-zinc-500">{current.modelId.split("/").slice(0, 2).join("/")}</span>
              </div>
              {current.status === "completed" && current.resultUrl ? (
                <>
                  <video src={current.resultUrl} controls autoPlay loop className="w-full rounded-lg bg-black" />
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>비용 {usd(current.costUsd)}</span>
                    <a href={current.resultUrl} download target="_blank" rel="noreferrer" className="text-accent-2 hover:underline">
                      다운로드 ↓
                    </a>
                  </div>
                </>
              ) : ["queued", "in_progress"].includes(current.status) ? (
                <div className="shimmer aspect-video w-full rounded-lg" />
              ) : (
                <p className="text-sm text-rose-300">{current.error ?? STATUS_LABEL[current.status]}</p>
              )}
              <p className="line-clamp-3 text-xs text-zinc-500">{current.prompt || "(프롬프트 없음)"}</p>
            </div>
          )}
        </Card>

        <Card title="최근 생성">
          {recent.length === 0 ? (
            <Empty>기록이 없습니다.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((g) => (
                <li key={g.id} className="flex cursor-pointer items-center gap-3 py-2 text-sm hover:bg-white/5" onClick={() => setCurrent(g)}>
                  <StatusBadge status={g.status} />
                  <span className="min-w-0 flex-1 truncate text-zinc-300">{g.prompt || g.modelId}</span>
                  <span className="text-xs text-zinc-500">{usd(g.costUsd)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
