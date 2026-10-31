"use client";

import { useTranslations } from "next-intl";
import { FAMILIES, paramsFor, type FamilyId, type Mode } from "@/lib/catalog";
import type { KeyTranslator } from "@/i18n/errors";

export type Shape = "landscape" | "portrait" | "square";

export function shapeOf(w?: number | null, h?: number | null): Shape | null {
  if (!w || !h) return null;
  const r = w / h;
  return r > 1.05 ? "landscape" : r < 0.95 ? "portrait" : "square";
}

export function ratioOf(ratio: unknown): [number, number] | null {
  const m = /^(\d+):(\d+)$/.exec(String(ratio));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function useAspectText(): (ratio: string) => string {
  const t = useTranslations("playground");
  const tGeneration = useTranslations("generation");
  return (ratio) => {
    if (ratio === "auto") return t("aspect.auto");
    const r = ratioOf(ratio);
    const shape = r && shapeOf(r[0], r[1]);
    return shape ? t("aspect.pill", { shape: tGeneration("shape", { shape }), ratio }) : ratio;
  };
}

export function useSettingsSummary(): (family: FamilyId, mode: Mode, params: Readonly<Record<string, unknown>>) => string {
  const t = useTranslations("playground");
  const tValues = useTranslations("paramValues") as unknown as KeyTranslator;
  const aspectText = useAspectText();
  const part: Record<string, (v: unknown) => string | null> = {
    aspect_ratio: () => null,
    duration: (v) => t("summary.duration", { seconds: String(v) }),
    generate_audio: (v) => (v === true ? t("summary.audio") : null),
    aigc_watermark: (v) => (v === true ? t("summary.watermark") : null),
    quality: (v) => t("summary.quality", { value: String(v) }),
    output_format: (v) => tValues("output_format", { value: String(v) }),
    background: (v) => (v === "transparent" ? t("summary.transparent") : null),
  };
  return (family, mode, params) => {
    const specs = paramsFor(family, mode);
    const first = specs.some((p) => p.key === "aspect_ratio")
      ? aspectText(String(params.aspect_ratio))
      : FAMILIES[family].modes.firstFrame === mode
        ? t("summary.firstFrameRatio")
        : null;
    const rest = specs.map(({ key }) => (part[key] ?? String)(params[key]));
    return [first, ...rest].filter((s): s is string => s !== null).join(" · ");
  };
}
