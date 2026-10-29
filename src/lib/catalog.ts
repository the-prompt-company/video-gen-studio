/**
 * Model catalog: how each Higgsfield model takes references and which
 * hyperparameters it exposes. Shared by the playground form (client) and
 * the generate route (server), so the request body is built in one place.
 *
 * Verified against docs.higgsfield.ai model pages (2026-10-27):
 *   bytedance/seedance-2.0/reference-to-video   image_urls 1–9, video_urls 1–3, duration 4–15,
 *                                               resolution 480p|720p|1080p|4k, aspect_ratio, generate_audio
 *   minimax/hailuo-2.3/standard/image-to-video  prompt + image_url required, duration 6|10,
 *                                               prompt_optimizer, output fixed at 768p
 * Higgsfield's API has no "Seedance 2.0 Mini" endpoint; Seedance 2.0 is the closest model.
 */

/** The exact JSON text Higgsfield receives for one request. Stored on the row and sent verbatim on every attempt. */
export type WireBody = string & { readonly __brand: "WireBody" };

export type ParamSpec =
  | { key: string; label: string; type: "int"; min: number; max: number; default: number }
  | { key: string; label: string; type: "float"; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: "bool"; default: boolean }
  /** `numeric` sends the chosen option as a number (e.g. duration 6 | 10). */
  | { key: string; label: string; type: "enum"; options: string[]; default: string; numeric?: true }
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
  /** The endpoint rejects a request without a prompt. */
  promptRequired?: true;
  /** The endpoint rejects a request without at least one reference. */
  refsRequired?: true;
  /** Short note shown under the model picker (e.g. fixed output resolution). */
  note?: string;
};

export const CATALOG: ModelSpec[] = [
  {
    id: "bytedance/seedance-2.0/reference-to-video",
    name: "Seedance 2.0",
    vendor: "ByteDance",
    blurb: "이미지 최대 6장·영상 최대 3개 레퍼런스에서 영상. 480p~4K, 화면비 선택, 오디오 생성.",
    images: { field: "image_urls", max: 6 },
    videos: { field: "video_urls", max: 3 },
    durationKey: "duration",
    refsRequired: true,
    params: [
      { key: "duration", label: "길이(초)", type: "int", min: 4, max: 15, default: 5 },
      { key: "resolution", label: "해상도", type: "enum", options: ["480p", "720p", "1080p", "4k"], default: "480p" },
      { key: "aspect_ratio", label: "화면비", type: "enum", options: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"], default: "16:9" },
      { key: "generate_audio", label: "오디오 생성", type: "bool", default: false },
    ],
    note: "비용은 해상도·길이에 비례합니다. 연습은 480p, 납품은 720p 이상을 권합니다.",
  },
  {
    id: "minimax/hailuo-2.3/standard/image-to-video",
    name: "Hailuo 2.3 Standard",
    vendor: "MiniMax",
    blurb: "연습용. 이미지 1장 + 프롬프트로 6초 또는 10초 영상. 출력 768p 고정, 가장 저렴.",
    images: { field: "image_url", max: 1 },
    videos: null,
    durationKey: "duration",
    promptRequired: true,
    refsRequired: true,
    params: [
      { key: "duration", label: "길이(초)", type: "enum", options: ["6", "10"], default: "6", numeric: true },
      { key: "prompt_optimizer", label: "프롬프트 자동 보정", type: "bool", default: true },
    ],
    note: "화면비 옵션이 없고 입력 이미지의 비율을 따릅니다. 출력은 768p로 고정입니다.",
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
        out[p.key] = p.numeric ? Number(s) : s;
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

/** Build the Higgsfield request body from validated params and uploaded reference URLs. */
export function buildArguments(
  spec: ModelSpec,
  prompt: string,
  params: Record<string, unknown>,
  imageUrls: string[],
  videoUrls: string[],
): Record<string, unknown> {
  const args: Record<string, unknown> = { ...params };
  if (prompt.trim()) args.prompt = prompt.trim();

  if (imageUrls.length > spec.images.max) throw new Error(`이미지는 최대 ${spec.images.max}장`);
  if (spec.images.field === "image_url") {
    if (imageUrls[0]) args.image_url = imageUrls[0];
    if (imageUrls[1]) args.last_image_url = imageUrls[1];
  } else if (imageUrls.length > 0) {
    args.image_urls = imageUrls;
  }

  if (videoUrls.length > 0) {
    if (!spec.videos) throw new Error("이 모델은 영상 레퍼런스를 받지 않습니다");
    if (videoUrls.length > spec.videos.max) throw new Error(`영상은 최대 ${spec.videos.max}개`);
    args[spec.videos.field] = videoUrls;
  }

  if (spec.promptRequired && !args.prompt) throw new Error(`${spec.name}은(는) 프롬프트가 필수입니다`);
  if (spec.refsRequired && imageUrls.length + videoUrls.length === 0)
    throw new Error(`${spec.name}은(는) 이미지 또는 영상 레퍼런스가 최소 1개 필요합니다`);
  return args;
}
