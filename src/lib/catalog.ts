/**
 * Model catalog: how each Higgsfield model takes references and which
 * hyperparameters it exposes. Shared by the playground form (client) and
 * the generate route (server), so the request body is built in one place.
 */

export type ParamSpec =
  | { key: string; label: string; type: "int"; min: number; max: number; default: number }
  | { key: string; label: string; type: "float"; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: "bool"; default: boolean }
  | { key: string; label: string; type: "enum"; options: string[]; default: string }
  | { key: string; label: string; type: "text"; default: string; optional?: true };

export type ModelSpec = {
  id: string;
  name: string;
  vendor: string;
  blurb: string;
  /** How reference images are passed: one `image_url` (+ `last_image_url`) or an `image_urls` list. */
  images: { field: "image_url" | "image_urls"; max: number };
  /** Reference videos: `video_urls` list, or none. */
  videos: { field: "video_urls"; max: number } | null;
  params: ParamSpec[];
  /** Key of the parameter that is the clip length in seconds (for cost = price × seconds). */
  durationKey: string;
};

export const CATALOG: ModelSpec[] = [
  {
    id: "kling-video/v3.0/std/image-to-video",
    name: "Kling 3.0 Standard",
    vendor: "Kling",
    blurb: "이미지 1장(+마지막 프레임 1장)에서 영상. 사운드, 멀티샷 지원.",
    images: { field: "image_url", max: 2 },
    videos: null,
    durationKey: "duration",
    params: [
      { key: "duration", label: "길이(초)", type: "int", min: 3, max: 15, default: 5 },
      { key: "sound", label: "사운드", type: "enum", options: ["off", "on"], default: "off" },
      { key: "cfg_scale", label: "CFG scale", type: "float", min: 0, max: 1, step: 0.05, default: 0.5 },
      { key: "negative_prompt", label: "네거티브 프롬프트", type: "text", default: "", optional: true },
    ],
  },
  {
    id: "bytedance/seedance-2.5/reference-to-video",
    name: "Seedance 2.5",
    vendor: "ByteDance",
    blurb: "이미지·영상·오디오 레퍼런스에서 영상. 해상도·비율·오디오 생성 선택.",
    images: { field: "image_urls", max: 6 },
    videos: { field: "video_urls", max: 3 },
    durationKey: "duration",
    params: [
      { key: "duration", label: "길이(초)", type: "int", min: 4, max: 30, default: 5 },
      { key: "resolution", label: "해상도", type: "enum", options: ["480p", "720p", "1080p"], default: "720p" },
      { key: "aspect_ratio", label: "화면비", type: "enum", options: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"], default: "16:9" },
      { key: "bitrate_mode", label: "비트레이트", type: "enum", options: ["standard", "high"], default: "high" },
      { key: "generate_audio", label: "오디오 생성", type: "bool", default: true },
    ],
  },
  {
    id: "alibaba/wan-3.0/reference-to-video",
    name: "Wan 3.0",
    vendor: "Alibaba",
    blurb: "프롬프트 필수. 이미지·영상 레퍼런스, 시드 고정, 사고 모드.",
    images: { field: "image_urls", max: 6 },
    videos: { field: "video_urls", max: 3 },
    durationKey: "duration",
    params: [
      { key: "duration", label: "길이(초)", type: "int", min: 2, max: 30, default: 5 },
      { key: "resolution", label: "해상도", type: "enum", options: ["720p", "1080p"], default: "1080p" },
      { key: "aspect_ratio", label: "화면비", type: "enum", options: ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4"], default: "adaptive" },
      { key: "seed", label: "시드(-1=랜덤)", type: "int", min: -1, max: 2147483647, default: -1 },
      { key: "enable_thinking", label: "사고 모드", type: "bool", default: false },
    ],
  },
];

export function findModel(id: string): ModelSpec | undefined {
  return CATALOG.find((m) => m.id === id);
}

export function defaultParams(spec: ModelSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of spec.params) out[p.key] = p.default;
  return out;
}

/** Validate and coerce client params against the spec. Throws on bad input. */
export function coerceParams(spec: ModelSpec, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of spec.params) {
    const v = raw[p.key];
    switch (p.type) {
      case "int": {
        const n = v === undefined || v === "" ? p.default : Math.trunc(Number(v));
        if (!Number.isFinite(n) || n < p.min || n > p.max) throw new Error(`${p.label}: ${p.min}~${p.max}`);
        if (p.key === "seed" && n === -1) break; // omit → random
        out[p.key] = n;
        break;
      }
      case "float": {
        const n = v === undefined || v === "" ? p.default : Number(v);
        if (!Number.isFinite(n) || n < p.min || n > p.max) throw new Error(`${p.label}: ${p.min}~${p.max}`);
        out[p.key] = n;
        break;
      }
      case "bool":
        out[p.key] = v === undefined ? p.default : v === true || v === "true";
        break;
      case "enum": {
        const s = v === undefined ? p.default : String(v);
        if (!p.options.includes(s)) throw new Error(`${p.label}: ${p.options.join(" | ")}`);
        out[p.key] = s;
        break;
      }
      case "text": {
        const s = v === undefined ? p.default : String(v);
        if (s.trim() !== "") out[p.key] = s;
        break;
      }
    }
  }
  return out;
}

/** The JSON body Higgsfield expects for this model. */
export function buildArguments(
  spec: ModelSpec,
  prompt: string,
  params: Record<string, unknown>,
  imageUrls: string[],
  videoUrls: string[],
): Record<string, unknown> {
  const args: Record<string, unknown> = { ...params };
  if (prompt.trim()) args.prompt = prompt.trim();

  if (spec.images.field === "image_url") {
    if (imageUrls.length === 0) throw new Error("이 모델은 이미지가 최소 1장 필요합니다");
    args.image_url = imageUrls[0];
    if (imageUrls[1]) args.last_image_url = imageUrls[1];
  } else if (imageUrls.length > 0) {
    args.image_urls = imageUrls;
  }

  if (videoUrls.length > 0) {
    if (!spec.videos) throw new Error("이 모델은 영상 레퍼런스를 받지 않습니다");
    args[spec.videos.field] = videoUrls;
  }

  if (spec.id.startsWith("alibaba/") && !args.prompt) throw new Error("Wan 3.0은 프롬프트가 필수입니다");
  if (spec.id.startsWith("bytedance/") && imageUrls.length + videoUrls.length === 0)
    throw new Error("Seedance는 이미지 또는 영상 레퍼런스가 최소 1개 필요합니다");
  return args;
}
