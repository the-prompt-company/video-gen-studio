"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useReducer, useRef, useState, type ReactNode, type Ref } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { describeModel, FAMILIES, KIND_OF, paramsFor, planGeneration, type Draft, type Fact, type FamilyId, type Mode, type ModeKind, type ParamSpec } from "@/lib/catalog";
import {
  attachmentsOf,
  composerReducer,
  draftOf,
  fit,
  modeOfComposer,
  newComposer,
  uploading as isUploading,
  type Attachment,
  type Refusal,
  type Slot,
} from "@/lib/composer";
import { ApiError, appError, caught, parseAppError, type Reason } from "@/lib/errors";
import type { PublicGeneration, Unavailable } from "@/lib/generations";
import { refUploadName } from "@/lib/ref-name";
import { Button, ErrorText } from "@/components/ui";
import { Icon } from "@/components/icons";
import { Popover } from "@/components/Popover";
import { shapeOf, useAspectText, useSettingsSummary } from "@/components/settings-summary";
import { useErrorText, useParamLabel, type KeyTranslator } from "@/i18n/errors";
import { usd } from "@/i18n/format";

export type Offer = { family: FamilyId; rateUsd: number; unavailable: Unavailable | null };

/** A 503 means the server cannot run the model at all; a 403 (no key for this member) can still be picked and says why. */
const pickable = (o: Offer) => o.unavailable?.status !== 503;
export type ComposerHandle = { reuse: (g: PublicGeneration) => void };

const SMALL = 4 * 1024 * 1024;
const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
const SLOTS: readonly Slot[] = ["start", "end"];
const KINDS: readonly ModeKind[] = ["text", "firstFrame", "reference"];

function readImageSize(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
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

/** A null `blobPrefix` uploads through /api/uploads to Higgsfield storage with the member's key; otherwise straight to Blob. */
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

function typeList(types: readonly string[]) {
  return types.map((t) => t.replace(/^image\//, "")).join(" · ");
}

const CHIP =
  "inline-flex h-11 min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-border px-3.5 text-[13px] text-foreground-2 transition hover:border-foreground/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface aria-expanded:border-foreground aria-expanded:bg-white/5 aria-expanded:text-foreground disabled:cursor-not-allowed disabled:opacity-45 sm:h-9 sm:px-3";
const OPTION =
  "flex min-h-11 w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-foreground-2 transition hover:bg-white/8 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:bg-white/12 aria-pressed:text-foreground disabled:cursor-not-allowed disabled:opacity-45";
const PILL =
  "inline-flex min-h-11 items-center rounded-full border border-border px-3.5 text-[13px] text-foreground-2 transition hover:border-foreground/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:font-medium aria-pressed:text-background sm:min-h-8 sm:px-3 sm:text-xs";
const REMOVE =
  "absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-background/80 text-foreground transition hover:bg-foreground hover:text-background focus:outline-none focus-visible:ring-2 focus-visible:ring-accent after:absolute after:-inset-2 after:content-['']";

function Option({ pressed, disabled, onClick, title, hint, children }: { pressed: boolean; disabled?: boolean; onClick: () => void; title: string; hint: string; children?: ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed} disabled={disabled} onClick={onClick} className={OPTION}>
      {children}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-subtle">{hint}</span>
      </span>
      <span className={pressed ? "text-foreground" : "invisible"}>
        <Icon name="check" className="h-5 w-5" />
      </span>
    </button>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold tracking-wider text-muted">{children}</h3>;
}

function ParamControl({ spec, value, onChange }: { spec: ParamSpec; value: unknown; onChange: (v: unknown) => void }) {
  const t = useTranslations("playground");
  const label = useParamLabel()(spec.key);
  const tValues = useTranslations("paramValues") as unknown as KeyTranslator;
  switch (spec.type) {
    case "int":
      return (
        <label className="grid gap-1">
          <span className="flex justify-between text-xs font-medium text-muted">
            <span>{label}</span>
            <span className="font-normal tabular-nums text-subtle">
              {t("summary.duration", { seconds: String(value) })} · {spec.min}~{spec.max}
            </span>
          </span>
          <input type="range" min={spec.min} max={spec.max} step={1} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
        </label>
      );
    case "bool":
      return (
        <button type="button" role="switch" aria-checked={Boolean(value)} onClick={() => onChange(!value)} className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-md text-sm text-foreground-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-9">
          <span>{label}</span>
          <span aria-hidden className="relative h-6 w-10 shrink-0 rounded-full border border-border bg-surface-2 transition group-aria-checked:border-foreground group-aria-checked:bg-foreground">
            <span className="absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-muted transition-[left] group-aria-checked:left-[19px] group-aria-checked:bg-background" />
          </span>
        </button>
      );
    case "enum":
      return (
        <div className="grid gap-1.5">
          <span className="text-xs font-medium text-muted">{label}</span>
          <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
            {spec.options.map((o) => (
              <button key={o} type="button" aria-pressed={String(value) === o} onClick={() => onChange(spec.numeric ? Number(o) : o)} className={PILL}>
                {spec.key === "duration" ? t("summary.duration", { seconds: o }) : tValues.has(spec.key) ? tValues(spec.key, { value: o }) : o}
              </button>
            ))}
          </div>
        </div>
      );
  }
}

function Thumb({ a, tag, caption, removeLabel, onRemove, className }: { a: Attachment; tag?: string; caption: string; removeLabel: string; onRemove: () => void; className: string }) {
  const t = useTranslations("playground");
  return (
    <div className={`relative shrink-0 ${className}`}>
      <div className="absolute inset-0 overflow-hidden rounded-md bg-surface-2">
        {a.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.preview} alt={a.name} className="h-full w-full object-cover" />
        ) : (
          <video src={a.preview} muted playsInline preload="metadata" aria-label={a.name} className="h-full w-full object-cover" />
        )}
        {tag && <span aria-hidden className="font-display absolute left-1.5 top-1 text-sm text-foreground drop-shadow">{tag}</span>}
        <span aria-hidden className="absolute bottom-1 left-1.5 text-[11px] text-foreground drop-shadow">{caption}</span>
        {a.url === null && (
          <span className="absolute inset-0 grid place-items-center bg-background/60">
            <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            <span className="sr-only">{t("uploading")}</span>
          </span>
        )}
      </div>
      <button type="button" aria-label={removeLabel} onClick={onRemove} className={REMOVE}>
        <Icon name="x" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function Composer({
  ref,
  offers,
  largeUploadPrefix,
  threadKey,
  onSubmit,
}: {
  ref?: Ref<ComposerHandle>;
  offers: Offer[];
  largeUploadPrefix: string | null;
  /** Another thread on the stream clears the last send's error. */
  threadKey: string;
  onSubmit: (draft: Draft) => Promise<Reason | null>;
}) {
  const t = useTranslations("playground");
  const tMode = useTranslations("mode");
  const tFamilies = useTranslations("families");
  const tPrices = useTranslations("prices");
  const tGeneration = useTranslations("generation");
  const format = useFormatter();
  const errorText = useErrorText();
  const summary = useSettingsSummary();
  const aspectText = useAspectText();

  const [state, dispatch] = useReducer(composerReducer, offers, (list) => newComposer((list.find((o) => !o.unavailable) ?? list.find(pickable) ?? list[0]).family));
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<Reason | null>(null);
  const [errorThread, setErrorThread] = useState(threadKey);
  if (threadKey !== errorThread) {
    setErrorThread(threadKey);
    setError(null);
  }
  const [open, setOpen] = useState<"model" | "settings" | "add" | null>(null);
  const [dragging, setDragging] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const modelChip = useRef<HTMLButtonElement>(null);
  const settingsChip = useRef<HTMLButtonElement>(null);
  const addChip = useRef<HTMLButtonElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const pickSlot = useRef<Slot | undefined>(undefined);

  const family = FAMILIES[state.family];
  const offer = offers.find((o) => o.family === state.family) ?? offers[0];
  const mode = modeOfComposer(state);
  const kind = state.attach.kind;
  const all = attachmentsOf(state.attach);
  const images = all.filter((a) => a.kind === "image").length;
  const videos = all.filter((a) => a.kind === "video").length;
  const draft = draftOf(state, prompt);
  const plan = planGeneration(draft, offer.rateUsd);
  const upload = isUploading(state);
  const canGenerate = !offer.unavailable && plan.ready && !submitting && !upload;
  const blockers = [offer.unavailable?.error, plan.ready ? null : plan.blocker].filter((b) => b != null);
  const priced = offer.rateUsd > 0;
  const rate = (o: Offer) => tPrices("rate", { usd: usd(format, o.rateUsd), unit: FAMILIES[o.family].rate.unit });
  const facts = plan.facts.map((f: Fact) => {
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
  });
  const settingsLine = summary(family.id, mode, plan.params);

  useLayoutEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt]);

  // A file dropped beside the composer would make the browser open it and leave the page.
  useEffect(() => {
    const keep = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", keep);
    window.addEventListener("drop", keep);
    return () => {
      window.removeEventListener("dragover", keep);
      window.removeEventListener("drop", keep);
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      reuse(g) {
        const m = describeModel(g.modelId);
        const next = m.family && offers.some((o) => o.family === m.family) ? m.family : latest.current.family;
        dispatch({ type: "reuse", family: next, kind: m.mode ? KIND_OF[m.mode] : "text", params: m.family === next ? (g.params as Record<string, unknown>) : {} });
        setPrompt(g.prompt ?? "");
        setError(null);
        setOpen(null);
        promptRef.current?.focus();
      },
    }),
    [offers],
  );

  function refusalText(r: Refusal): string {
    switch (r.reason) {
      case "full":
        return t("upload.tooMany", { kind: r.kind, max: r.max });
      case "noVideos":
        return errorText(appError("noVideoRefs", { model: family.name }));
      case "framesTakeImages":
        return t("upload.framesTakeImages");
      case "framesFull":
        return t("upload.framesFull");
    }
  }

  async function attach(files: File[], slot?: Slot) {
    const current = FAMILIES[latest.current.family];
    setError(null);
    const problems: string[] = [];
    const items: { a: Attachment; file: File; viaBlob: boolean }[] = [];
    for (const file of files) {
      const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
      const isVideo = type.startsWith("video/");
      if (isVideo ? type !== "video/mp4" : !current.refImages.types.includes(type)) {
        problems.push(t("upload.badType", { file: file.name, model: current.name, types: isVideo ? "mp4" : typeList(current.refImages.types) }));
        continue;
      }
      if (!isVideo && current.refImages.maxBytes !== null && file.size > current.refImages.maxBytes) {
        problems.push(t("upload.tooBig", { file: file.name, mb: String(Math.round(current.refImages.maxBytes / 1024 / 1024)) }));
        continue;
      }
      const viaBlob = current.provider === "openai" || file.size > SMALL;
      if (viaBlob && largeUploadPrefix === null) {
        problems.push(current.provider === "openai" ? t("upload.blobForImages") : t("upload.blobForLarge", { mb: String(SMALL / 1024 / 1024) }));
        continue;
      }
      const base = { id: crypto.randomUUID(), name: file.name, preview: URL.createObjectURL(file), url: null, blob: viaBlob };
      if (isVideo) {
        const seconds = await readVideoSeconds(file);
        if (seconds === null) {
          problems.push(t("upload.noLength", { file: file.name }));
          continue;
        }
        items.push({ a: { ...base, kind: "video", seconds }, file, viaBlob });
      } else {
        const size = await readImageSize(file);
        items.push({ a: { ...base, kind: "image", w: size?.w ?? null, h: size?.h ?? null }, file, viaBlob });
      }
    }
    const fitted = fit(latest.current, items.map((x) => x.a), slot);
    const { placed, refused } = fitted;
    // A second attach may start before React renders this one; it must see these files already placed.
    latest.current = fitted.composer;
    problems.push(...refused.map(refusalText));
    if (problems.length > 0) setError({ text: [...new Set(problems)].join(" · ") });
    if (placed.length === 0) return;
    dispatch({ type: "add", items: placed, slot });
    await Promise.all(
      items
        .filter((x) => placed.includes(x.a))
        .map(async ({ a, file, viaBlob }) => {
          try {
            dispatch({ type: "uploaded", id: a.id, url: await uploadFile(file, viaBlob ? largeUploadPrefix : null) });
          } catch (e) {
            dispatch({ type: "failed", id: a.id });
            setError(caught(e));
          }
        }),
    );
  }

  async function generate() {
    if (!canGenerate) return;
    setSubmitting(true);
    setError(null);
    const reason = await onSubmit(draft);
    setSubmitting(false);
    if (reason) setError(reason);
    else dispatch({ type: "sent" });
  }

  function pickFamily(next: FamilyId) {
    dispatch({ type: "family", family: next });
    setError(null);
  }

  function pickFiles(input: HTMLInputElement | null, slot?: Slot) {
    pickSlot.current = slot;
    input?.click();
  }

  const outputs = (["video", "image"] as const).filter((o) => offers.some((x) => FAMILIES[x.family].modes.output === o));
  const kindHint = (k: ModeKind) =>
    k === "text" ? t("kindHint.text") : k === "firstFrame" ? t("kindHint.firstFrame", { end: family.modes.endFrame ? "yes" : "no" }) : t("kindHint.reference", { images: family.maxImages, videos: family.maxVideos });
  const offerHint = (o: Offer) => (o.unavailable ? `${t("unavailable")} · ${errorText(o.unavailable.error)}` : o.rateUsd > 0 ? t("rateHint", { basis: tPrices(`basis.${FAMILIES[o.family].key}`), rate: rate(o) }) : t("rateUnset"));
  const firstShape = state.attach.kind === "firstFrame" && state.attach.start?.kind === "image" ? state.attach.start : null;
  const shape = firstShape && shapeOf(firstShape.w, firstShape.h);
  const modeLabel = `${family.name} · ${tMode(mode)}`;

  return (
    <section aria-label={t("composer")} className="shrink-0 px-2 pb-2 pt-1 sm:px-4 sm:pb-4">
      <div
        onDragEnter={(e) => {
          if (e.dataTransfer.types.includes("Files")) setDragging(true);
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(false);
          void attach([...e.dataTransfer.files]);
        }}
        className={`relative mx-auto grid w-full max-w-[820px] grid-cols-[minmax(0,1fr)] gap-2 rounded-xl border bg-surface p-3 pb-2.5 transition-colors ${dragging ? "border-foreground" : "border-border"}`}
      >
        {kind === "firstFrame" && (
          <div role="group" aria-label={t("frames.label")} className="flex flex-wrap items-center gap-2.5">
            {SLOTS.filter((s) => s === "start" || family.modes.endFrame).map((s, i) => {
              const a = state.attach.kind === "firstFrame" ? state.attach[s] : null;
              const label = t("frames.slot", { slot: s });
              return (
                <div key={s} className="flex items-center gap-2.5">
                  {i > 0 && <Icon name="arrow" className="h-4 w-4 text-subtle" />}
                  {a ? (
                    <Thumb a={a} caption={label} removeLabel={t("frames.remove", { slot: s, name: a.name })} onRemove={() => dispatch({ type: "remove", id: a.id })} className="h-[58px] w-[104px] sm:h-[68px] sm:w-[120px]" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => pickFiles(imageInput.current, s)}
                      className="grid h-[58px] w-[104px] place-content-center gap-0.5 rounded-md border border-dashed border-border text-center text-xs text-subtle transition hover:border-foreground/60 hover:text-foreground-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-[68px] sm:w-[120px]"
                    >
                      <span className="font-medium text-foreground-2">+ {label}</span>
                      <span>{s === "start" ? t("frames.required") : t("frames.optional")}</span>
                      <span className="sr-only">{t("frames.add", { slot: s })}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {kind === "reference" &&
          (all.length === 0 ? (
            <div className="flex min-h-11 items-center gap-2.5 rounded-md border border-dashed border-border px-3 py-2 text-xs text-subtle">
              <Icon name="image" />
              <span className="min-w-0 flex-1">{t("refs.dropHint", { videos: family.maxVideos > 0 ? "yes" : "no" })}</span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <ul aria-label={t("refs.attached")} className="flex min-w-0 gap-2 overflow-x-auto p-0.5 [scrollbar-width:thin]">
                {all.map((a) => {
                  const n = all.filter((x) => x.kind === a.kind).indexOf(a) + 1;
                  const tag = a.kind === "image" ? String(n) : `V${n}`;
                  const imageShape = a.kind === "image" ? shapeOf(a.w, a.h) : null;
                  return (
                    <li key={a.id}>
                      <Thumb
                        a={a}
                        tag={tag}
                        caption={a.kind === "video" ? t("refs.seconds", { seconds: format.number(a.seconds, ONE_DECIMAL) }) : imageShape ? tGeneration("shape", { shape: imageShape }) : ""}
                        removeLabel={t("refs.removeLabel", { kind: a.kind, tag, name: a.name })}
                        onRemove={() => dispatch({ type: "remove", id: a.id })}
                        className="h-[54px] w-[96px]"
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        {kind === "reference" && (
          <p className="text-xs tabular-nums text-muted">
            {t("refs.imageCount", { count: String(images), max: String(family.maxImages) })}
            {family.maxVideos > 0 && (
              <>
                <span className="mx-1.5 text-subtle">·</span>
                {t("refs.videoCount", { count: String(videos), max: String(family.maxVideos) })}
              </>
            )}
          </p>
        )}

        <label htmlFor="prompt" className="sr-only">{t("prompt")}</label>
        <textarea
          id="prompt"
          ref={promptRef}
          rows={2}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          value={prompt}
          placeholder={t("promptPlaceholder")}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void generate();
            }
          }}
          className="max-h-[7.5rem] min-h-11 w-full resize-none bg-transparent px-1 py-0.5 text-[15px] leading-relaxed text-foreground placeholder:text-subtle focus:outline-none sm:max-h-40 sm:min-h-[52px]"
        />

        {state.note && (
          <p className="flex flex-wrap items-center gap-x-2 px-1 text-xs text-muted">
            <span>
              {state.note.kind === "switched"
                ? t("note.switched", { mode: state.note.mode })
                : state.note.kind === "removed"
                  ? t("note.removed", { to: kind, count: state.note.count })
                  : state.note.kind === "spent"
                    ? t("note.spent", { count: state.note.count })
                    : t("note.reused", { refs: state.note.needsAttachments ? "yes" : "no" })}
            </span>
            {state.note.kind === "removed" && (
              <button type="button" onClick={() => dispatch({ type: "undo" })} className="min-h-11 text-foreground underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-7">
                {t("note.undo")}
              </button>
            )}
          </p>
        )}
        {error && <ErrorText>{errorText(error)}</ErrorText>}
        <div role="status" className="grid gap-2 empty:hidden">
          {blockers.map((b) => (
            <p key={b.code} className="flex items-start gap-2 px-1 text-xs leading-relaxed text-foreground-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              {errorText(b)}
            </p>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {kind !== "firstFrame" && (
              <button ref={addChip} type="button" aria-label={t("refs.add")} aria-haspopup="dialog" aria-expanded={open === "add"} onClick={() => setOpen(open === "add" ? null : "add")} className={`${CHIP} w-11 justify-center px-0 sm:w-9 sm:px-0`}>
                <Icon name="plus" className="h-5 w-5" />
              </button>
            )}
            <button ref={modelChip} type="button" aria-label={`${t("modelMenu")} · ${modeLabel}`} aria-haspopup="dialog" aria-expanded={open === "model"} onClick={() => setOpen(open === "model" ? null : "model")} className={`${CHIP} text-foreground max-sm:shrink`}>
              <Icon name={family.modes.output === "video" ? "film" : "image"} />
              <span className="truncate">{modeLabel}</span>
              <Icon name="chevron" />
            </button>
            <button ref={settingsChip} type="button" aria-label={t("settings.open", { summary: settingsLine })} aria-haspopup="dialog" aria-expanded={open === "settings"} onClick={() => setOpen(open === "settings" ? null : "settings")} className={`${CHIP} max-sm:w-11 max-sm:justify-center max-sm:px-0 sm:min-w-32 sm:shrink`}>
              <Icon name="sliders" />
              <span className="truncate max-sm:hidden">{settingsLine}</span>
            </button>
          </div>
          <div className="flex items-center justify-between gap-3.5 sm:justify-end">
            <div className="min-w-0 sm:text-right">
              <div className="flex items-baseline gap-1.5 text-xs text-muted sm:justify-end">
                <span>{t("cost.label")}</span>
                {priced && plan.ready ? (
                  <span className="font-display text-2xl leading-none text-sand">{usd(format, plan.costUsd)}</span>
                ) : (
                  <span className="text-sm font-semibold text-foreground">{priced ? "—" : t("cost.unset")}</span>
                )}
              </div>
              <div className="max-w-[16rem] truncate text-[11px] tabular-nums text-subtle sm:max-w-[13rem]">
                {priced ? [...facts, t("cost.rate", { rate: rate(offer) })].join(" · ") : t("cost.unpriced", { facts: facts.join(" · ") })}
              </div>
            </div>
            <Button onClick={generate} disabled={!canGenerate} title={t("shortcut")} className="h-11 shrink-0 sm:h-10">
              {submitting ? t("submitting") : upload ? t("uploading") : t("generate")}
            </Button>
          </div>
        </div>

        {dragging && (
          <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-background/85 text-sm text-foreground">
            {t("dropHere", { kind: kind === "firstFrame" ? "firstFrame" : "reference" })}
          </div>
        )}
        <input
          ref={imageInput}
          type="file"
          hidden
          multiple={kind !== "firstFrame"}
          accept={family.refImages.types.join(",")}
          aria-label={t("refs.uploadImages")}
          onChange={(e) => {
            void attach([...(e.target.files ?? [])], pickSlot.current);
            pickSlot.current = undefined;
            e.target.value = "";
          }}
        />
        <input
          ref={videoInput}
          type="file"
          hidden
          accept="video/mp4"
          aria-label={t("refs.uploadVideos")}
          onChange={(e) => {
            void attach([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      {open === "model" && (
        <Popover anchor={modelChip} title={t("modelMenu")} width={600} onClose={() => setOpen(null)}>
          {outputs.length > 1 && (
            <div role="group" aria-label={t("outputs")} className="inline-flex justify-self-start rounded-full border border-border p-[3px]">
              {outputs.map((o) => {
                const on = family.modes.output === o;
                const first = offers.find((x) => FAMILIES[x.family].modes.output === o && pickable(x));
                return (
                  <button key={o} type="button" aria-pressed={on} disabled={!on && !first} onClick={() => !on && first && pickFamily(first.family)} className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[13px] text-muted transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-pressed:bg-foreground aria-pressed:font-medium aria-pressed:text-background disabled:opacity-45 sm:h-8">
                    <Icon name={o === "video" ? "film" : "image"} />
                    {t("output", { output: o })}
                  </button>
                );
              })}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
            <div className="grid content-start gap-1">
              <Heading>{t("modes")}</Heading>
              {KINDS.filter((k) => family.modes[k] !== null).map((k) => {
                const m = family.modes[k] as Mode;
                return (
                  <Option
                    key={k}
                    pressed={kind === k}
                    title={`${t(`kind.${k}`)} · ${tMode(m)}`}
                    hint={kindHint(k)}
                    onClick={() => {
                      dispatch({ type: "mode", kind: k });
                      setOpen(null);
                    }}
                  />
                );
              })}
            </div>
            <div className="grid content-start gap-1">
              <Heading>{t("model")}</Heading>
              {offers
                .filter((o) => FAMILIES[o.family].modes.output === family.modes.output)
                .map((o) => (
                  <Option
                    key={o.family}
                    pressed={o.family === family.id}
                    disabled={!pickable(o)}
                    title={`${FAMILIES[o.family].name} · ${FAMILIES[o.family].vendor}`}
                    hint={offerHint(o)}
                    onClick={() => {
                      pickFamily(o.family);
                      setOpen(null);
                    }}
                  />
                ))}
            </div>
          </div>
          <p className="text-xs leading-relaxed text-subtle">{tFamilies(`${family.key}.note`)}</p>
        </Popover>
      )}

      {open === "settings" && (
        <Popover anchor={settingsChip} title={t("settings.title")} width={380} onClose={() => setOpen(null)}>
          <Heading>{modeLabel}</Heading>
          {paramsFor(family.id, mode).some((p) => p.key === "aspect_ratio") ? null : (
            <div className="grid gap-1">
              <span className="text-xs font-medium text-muted">{t("aspect.label")}</span>
              <p className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs leading-relaxed text-foreground-2">
                {firstShape && shape
                  ? t.rich("aspect.firstFrameNote", {
                      size: `${firstShape.w}×${firstShape.h}`,
                      shape,
                      num: (chunks) => <span className="tabular-nums">{chunks}</span>,
                      em: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                    })
                  : t("aspect.firstFrameRule")}
              </p>
            </div>
          )}
          {paramsFor(family.id, mode).map((p) =>
            p.key === "aspect_ratio" && p.type === "enum" ? (
              <div key={p.key} className="grid gap-1.5">
                <span className="text-xs font-medium text-muted">{t("aspect.label")}</span>
                <div role="group" aria-label={t("aspect.label")} className="flex flex-wrap gap-1.5">
                  {p.options.map((o) => (
                    <button key={o} type="button" aria-pressed={String(state.params.aspect_ratio) === o} onClick={() => dispatch({ type: "param", key: p.key, value: o })} className={PILL}>
                      {aspectText(o)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ParamControl key={p.key} spec={p} value={state.params[p.key]} onChange={(value) => dispatch({ type: "param", key: p.key, value })} />
            ),
          )}
          <p className="text-xs leading-relaxed text-subtle">{tFamilies(`${family.key}.note`)}</p>
        </Popover>
      )}

      {open === "add" && (
        <Popover anchor={addChip} title={t("refs.add")} width={340} onClose={() => setOpen(null)}>
          <Heading>{t("refs.add")}</Heading>
          <div className="grid gap-1">
            <AddRow icon="image" title={t("refs.uploadImages")} count={images} max={family.maxImages} hint={t("refs.fileHint", { types: typeList(family.refImages.types), mb: String((family.refImages.maxBytes ?? SMALL) / 1024 / 1024) })} full={t("refs.full", { kind: "image", max: family.maxImages })} onClick={() => pickFiles(imageInput.current)} />
            {family.maxVideos > 0 && (
              <AddRow icon="film" title={t("refs.uploadVideos")} count={videos} max={family.maxVideos} hint={t("refs.fileHint", { types: "mp4", mb: largeUploadPrefix !== null ? "200" : "4" })} full={t("refs.full", { kind: "video", max: family.maxVideos })} onClick={() => pickFiles(videoInput.current)} />
            )}
          </div>
          <p className="text-xs leading-relaxed text-subtle">{t("refs.menuNote")}</p>
        </Popover>
      )}
    </section>
  );
}

function AddRow({ icon, title, count, max, hint, full, onClick }: { icon: "image" | "film"; title: string; count: number; max: number; hint: string; full: string; onClick: () => void }) {
  const isFull = count >= max;
  return (
    <button type="button" disabled={isFull} onClick={onClick} className={OPTION}>
      <Icon name={icon} className="h-5 w-5 text-muted" />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-subtle">{isFull ? full : hint}</span>
      </span>
      <span className="text-xs tabular-nums text-subtle">
        {count}/{max}
      </span>
    </button>
  );
}
