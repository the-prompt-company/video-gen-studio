/**
 * Model catalog: the two models a member picks from, the Higgsfield endpoint each request goes to, the exact body it
 * sends, and what it costs. Shared by the playground (client) and the generate route (server), so the mode the member
 * sees, the endpoint the server calls and the price both show come from one function, planGeneration.
 *
 * Verified 2026-10-29 against each endpoint's page and api-reference on open.higgsfield.ai (input JSON schemas, all
 * additionalProperties: false; an unknown endpoint path is 404):
 *   bytedance/seedance-2.0/text-to-video        prompt required; duration 4-15 (5); resolution 480p|720p|1080p|4k (720p);
 *                                               aspect_ratio 16:9|4:3|1:1|3:4|9:16|21:9 (16:9); generate_audio (true)
 *   bytedance/seedance-2.0/image-to-video       image_url required, end_image_url, prompt optional; duration; resolution;
 *                                               generate_audio; no aspect_ratio (the frame follows the image)
 *   bytedance/seedance-2.0/reference-to-video   image_urls 1-9, video_urls 1-3, audio_urls 1-3, images or videos required,
 *                                               prompt optional; duration; resolution; aspect_ratio; generate_audio
 *   minimax/h3/text-to-video                    prompt required; duration 5-15 (5); resolution 2K only;
 *                                               aspect_ratio auto|adaptive|21:9|16:9|4:3|1:1|3:4|9:16 (auto); aigc_watermark (false)
 *   minimax/h3/image-to-video                   prompt and image_url required, end_image_url; the rest as text-to-video
 *   minimax/h3/reference-to-video               prompt required; image_urls 1-9, video_urls 1-3, audio_urls 0-3; as above
 * Pricing on the same pages: Seedance bills ceil((input video s + output s) × w × h × 24 / 1024) tokens at $0.014 per
 * 1,000 (4K $0.008), 0.6× with video input; its model table shows $0.0985-$1.0887/s, that formula at 30% off. H3 shows
 * $0.065/s at 2K (50% off $0.13) "for 1, 5, 10 or 15 second clips"; reference-to-video adds $0.08 per image past five.
 * Seedance output sizes per resolution and aspect: runware.ai's Seedance 2.0 docs (480p and 720p agree with fal.ai).
 * Higgsfield's invoice is the truth; these estimates are what the app records.
 */

export type Mode = "t2v" | "i2v" | "r2v";
export const MODES: readonly Mode[] = ["t2v", "i2v", "r2v"];
export const MODE_LABEL: Record<Mode, string> = { t2v: "텍스트→영상", i2v: "이미지→영상", r2v: "레퍼런스→영상" };
const SLUG: Record<Mode, string> = { t2v: "text-to-video", i2v: "image-to-video", r2v: "reference-to-video" };

export type FamilyId = "bytedance/seedance-2.0" | "minimax/h3";
export const FAMILY_IDS: readonly FamilyId[] = ["bytedance/seedance-2.0", "minimax/h3"];

export function isFamilyId(s: string): s is FamilyId {
  return (FAMILY_IDS as readonly string[]).includes(s);
}

/** The exact JSON text Higgsfield receives for one request. Stored on the row and sent verbatim on every attempt. */
export type WireBody = string & { readonly __brand: "WireBody" };

/** `modes`: the modes whose endpoint schema has this key; absent means all three. */
export type ParamSpec = (
  | { key: string; label: string; type: "int"; min: number; max: number; default: number }
  | { key: string; label: string; type: "bool"; default: boolean }
  /** `numeric` sends the chosen option as a number (e.g. duration 5 | 10 | 15). */
  | { key: string; label: string; type: "enum"; options: readonly string[]; default: string; numeric?: true }
) & { modes?: readonly Mode[] };

export type Params = Readonly<Record<string, string | number | boolean>>;

/** What one request is billed on, all known before submit. */
export type CostBasis = { family: FamilyId; mode: Mode; params: Readonly<Record<string, unknown>>; inputVideoS: number };

export type Family = {
  id: FamilyId;
  name: string;
  vendor: string;
  blurb: string;
  note: string;
  params: readonly ParamSpec[];
  promptRequiredIn: readonly Mode[];
  maxImages: number;
  maxVideos: number;
  rate: {
    /** The format whose one second the admin's base rate prices ("480p·16:9", "2K"). */
    basis: string;
    /** Higgsfield's published figures in that unit, offered as one-click fills. */
    published: readonly { label: string; usd: number }[];
    /** One request the admin page prices at the rate being typed, so the unit reads as money. */
    example: { label: string; basis: CostBasis };
    /** Billable units of a request, in seconds of the basis format. Rate-free, so any rate can be previewed. */
    units(b: CostBasis): number;
  };
};

type Size = readonly [w: number, h: number];
const SEEDANCE_FRAME: Record<string, Record<string, Size>> = {
  "480p": { "16:9": [864, 496], "4:3": [752, 560], "1:1": [640, 640], "3:4": [560, 752], "9:16": [496, 864], "21:9": [992, 432] },
  "720p": { "16:9": [1280, 720], "4:3": [1112, 834], "1:1": [960, 960], "3:4": [834, 1112], "9:16": [720, 1280], "21:9": [1470, 630] },
  "1080p": { "16:9": [1920, 1080], "4:3": [1664, 1248], "1:1": [1440, 1440], "3:4": [1248, 1664], "9:16": [1080, 1920], "21:9": [2206, 946] },
  "4k": { "16:9": [3840, 2160], "4:3": [3326, 2494], "1:1": [2880, 2880], "3:4": [2496, 3328], "9:16": [2160, 3840], "21:9": [4398, 1886] },
};
const tokensPerSecond = ([w, h]: Size) => (w * h * 24) / 1024;
/** The rate's unit: one second at 480p 16:9, 10,044 tokens. */
const SEEDANCE_UNIT_TOKENS = tokensPerSecond(SEEDANCE_FRAME["480p"]["16:9"]);

function seedanceUnits(b: CostBasis): number {
  const frames = SEEDANCE_FRAME[String(b.params.resolution)] ?? SEEDANCE_FRAME["480p"];
  // Image-to-video takes no aspect: the frame follows the image, so the largest frame at the resolution is billed.
  const size = b.mode === "i2v" ? Object.values(frames).reduce((a, s) => (s[0] * s[1] > a[0] * a[1] ? s : a)) : (frames[String(b.params.aspect_ratio)] ?? frames["16:9"]);
  const tokens = Math.ceil((Number(b.params.duration) + b.inputVideoS) * tokensPerSecond(size));
  const weight = (b.params.resolution === "4k" ? 0.008 / 0.014 : 1) * (b.inputVideoS > 0 ? 0.6 : 1);
  return (tokens * weight) / SEEDANCE_UNIT_TOKENS;
}

const DURATION_SEEDANCE: ParamSpec = { key: "duration", label: "길이(초)", type: "int", min: 4, max: 15, default: 5 };

export const FAMILIES: Record<FamilyId, Family> = {
  "bytedance/seedance-2.0": {
    id: "bytedance/seedance-2.0",
    name: "Seedance 2.0",
    vendor: "ByteDance",
    blurb: "텍스트만으로, 이미지 한 장을 첫 프레임으로, 또는 이미지 최대 6장·영상 최대 3개를 레퍼런스로. 480p~4K, 화면비 선택, 오디오 생성.",
    note: "비용은 해상도·길이에 비례합니다. 연습은 480p, 납품은 720p 이상을 권합니다.",
    params: [
      DURATION_SEEDANCE,
      { key: "resolution", label: "해상도", type: "enum", options: ["480p", "720p", "1080p", "4k"], default: "480p" },
      { key: "aspect_ratio", label: "화면비", type: "enum", options: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"], default: "16:9", modes: ["t2v", "r2v"] },
      { key: "generate_audio", label: "오디오 생성", type: "bool", default: false },
    ],
    promptRequiredIn: ["t2v"],
    maxImages: 6,
    maxVideos: 3,
    rate: {
      basis: "480p·16:9",
      published: [
        { label: "Higgsfield 표 · 30% 할인", usd: 0.0985 },
        { label: "정가", usd: 0.1406 },
      ],
      example: {
        label: "720p 16:9 5초",
        basis: { family: "bytedance/seedance-2.0", mode: "t2v", params: { duration: 5, resolution: "720p", aspect_ratio: "16:9" }, inputVideoS: 0 },
      },
      units: seedanceUnits,
    },
  },
  "minimax/h3": {
    id: "minimax/h3",
    name: "MiniMax H3",
    vendor: "MiniMax",
    blurb: "텍스트만으로, 이미지 한 장을 첫 프레임으로, 또는 이미지 최대 5장·영상 최대 3개를 레퍼런스로. 2K, 5·10·15초.",
    note: "출력은 2K로 고정입니다. 어떤 방식이든 프롬프트가 필요합니다.",
    params: [
      { key: "duration", label: "길이(초)", type: "enum", options: ["5", "10", "15"], default: "5", numeric: true },
      { key: "aspect_ratio", label: "화면비", type: "enum", options: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], default: "auto" },
      { key: "aigc_watermark", label: "AI 생성 워터마크", type: "bool", default: false },
    ],
    promptRequiredIn: ["t2v", "i2v", "r2v"],
    // Five, because reference-to-video bills $0.08 for every image past five.
    maxImages: 5,
    maxVideos: 3,
    rate: {
      basis: "2K",
      published: [
        { label: "Higgsfield 표 · 50% 할인", usd: 0.065 },
        { label: "정가", usd: 0.13 },
      ],
      example: { label: "10초", basis: { family: "minimax/h3", mode: "t2v", params: { duration: 10 }, inputVideoS: 0 } },
      units: (b) => Number(b.params.duration),
    },
  },
};

/** Endpoints no model offers any more. Their rows keep a name and labels; their pending rows resend via legacyBody. */
const RETIRED: Record<string, { name: string; mode: Mode; labels: Record<string, string> }> = {
  "minimax/hailuo-2.3/standard/image-to-video": { name: "Hailuo 2.3 Standard", mode: "i2v", labels: { duration: "길이(초)", prompt_optimizer: "프롬프트 자동 보정" } },
};

export function endpointOf(family: FamilyId, mode: Mode): string {
  return `${family}/${SLUG[mode]}`;
}

export function endpointsOf(family: FamilyId): string[] {
  return MODES.map((m) => endpointOf(family, m));
}

export function paramsFor(family: FamilyId, mode: Mode): readonly ParamSpec[] {
  return FAMILIES[family].params.filter((p) => !p.modes || p.modes.includes(mode));
}

function coerce(p: ParamSpec, v: unknown): string | number | boolean | null {
  switch (p.type) {
    case "int": {
      const n = v === undefined || v === "" ? p.default : Number(v);
      return Number.isInteger(n) && n >= p.min && n <= p.max ? n : null;
    }
    case "bool":
      return v === undefined ? p.default : v === true || v === "true";
    case "enum": {
      const s = v === undefined ? p.default : String(v);
      if (!p.options.includes(s)) return null;
      return p.numeric ? Number(s) : s;
    }
  }
}

/** Every param of the model at its default, coerced, whichever mode takes it. */
export function defaultParams(family: FamilyId): Params {
  return Object.fromEntries(FAMILIES[family].params.map((p) => [p.key, coerce(p, undefined) as string | number | boolean]));
}

/** Nothing attached: text. Exactly one image, no video, and the member starts from it: image. Anything else: reference. */
export function routeMode(images: number, videos: number, startFromImage: boolean): Mode {
  if (images + videos === 0) return "t2v";
  return images === 1 && videos === 0 && startFromImage ? "i2v" : "r2v";
}

export function estimateCostUsd(b: CostBasis, baseRateUsd: number): number {
  return Math.round(baseRateUsd * FAMILIES[b.family].rate.units(b) * 1e4) / 1e4;
}

/** What the member composed. `mode` is the mode the screen showed; images and videos are uploaded URLs. */
export type Draft = {
  family: FamilyId;
  mode: Mode;
  prompt: string;
  params: Readonly<Record<string, unknown>>;
  images: readonly string[];
  /** `seconds` is read from the file's metadata in the browser when it was attached. */
  videos: readonly { url: string; seconds: number }[];
  /** "이 이미지로 시작". Counts only while exactly one image and no video is attached. */
  startFromImage: boolean;
};

type PlanBase = {
  family: FamilyId;
  mode: Mode;
  endpoint: string;
  offersStartFromImage: boolean;
  prompt: string;
  params: Params;
  imageUrls: readonly string[];
  videoUrls: readonly string[];
  durationS: number;
  /** Rounded to 4 decimals, the scale of cost_usd. */
  costUsd: number;
};
export type Plan = PlanBase & ({ ready: true; body: WireBody } | { ready: false; blocker: string });
export type ReadyPlan = Extract<Plan, { ready: true }>;

/**
 * Routing, param checks, the prompt rule, the request body and the cost, in one pure call: the drawer runs it on every
 * change, the route runs it on the POST, and only a ready plan is inserted. Body key order: params, prompt (trimmed,
 * when there is one), then the mode's media fields.
 */
export function planGeneration(draft: Draft, baseRateUsd: number): Plan {
  const family = FAMILIES[draft.family];
  const images = draft.images.length;
  const videos = draft.videos.length;
  const mode = routeMode(images, videos, draft.startFromImage);
  const prompt = draft.prompt.trim();
  const params: Record<string, string | number | boolean> = {};
  let blocker: string | null = null;
  for (const p of paramsFor(family.id, mode)) {
    const v = coerce(p, draft.params[p.key]);
    if (v === null) {
      blocker ??= `${p.label}: ${p.type === "int" ? `${p.min}~${p.max}` : p.type === "enum" ? p.options.join(" | ") : "켬 또는 끔"}`;
      continue;
    }
    params[p.key] = v;
  }
  const inputVideoS = draft.videos.reduce((s, v) => s + v.seconds, 0);
  const base: PlanBase = {
    family: family.id,
    mode,
    endpoint: endpointOf(family.id, mode),
    offersStartFromImage: images === 1 && videos === 0,
    prompt,
    params,
    imageUrls: draft.images,
    videoUrls: draft.videos.map((v) => v.url),
    durationS: Number(params.duration ?? 0),
    costUsd: blocker ? 0 : estimateCostUsd({ family: family.id, mode, params, inputVideoS }, baseRateUsd),
  };
  if (images > family.maxImages) blocker = `${family.name}은(는) 이미지를 최대 ${family.maxImages}장 받습니다`;
  else if (videos > family.maxVideos) blocker = `${family.name}은(는) 영상을 최대 ${family.maxVideos}개 받습니다`;
  else if (draft.videos.some((v) => !(Number.isFinite(v.seconds) && v.seconds > 0 && v.seconds <= 600))) blocker = "영상 길이를 읽지 못한 레퍼런스가 있습니다. 그 영상을 빼고 다시 올려 주세요";
  else if (draft.mode !== mode) blocker = `화면의 생성 방식(${MODE_LABEL[draft.mode]})이 첨부와 맞지 않습니다. 페이지를 새로고침하세요`;
  else if (!blocker && family.promptRequiredIn.includes(mode) && !prompt) blocker = `${family.name} ${MODE_LABEL[mode]}은(는) 프롬프트가 필요합니다`;
  if (blocker) return { ...base, ready: false, blocker };

  const body: Record<string, unknown> = { ...params };
  if (prompt) body.prompt = prompt;
  if (mode === "i2v") body.image_url = draft.images[0];
  if (mode === "r2v" && images > 0) body.image_urls = draft.images;
  if (mode === "r2v" && videos > 0) body.video_urls = base.videoUrls;
  return { ...base, ready: true, body: JSON.stringify(body) as WireBody };
}

/** How any stored generations.model_id reads. `group` is the model it counts under in usage. */
export type ModelLabel = { group: string; name: string; family: FamilyId | null; mode: Mode | null; paramLabel(key: string): string };

export function describeModel(modelId: string): ModelLabel {
  for (const family of FAMILY_IDS) {
    const mode = MODES.find((m) => endpointOf(family, m) === modelId);
    if (!mode) continue;
    const f = FAMILIES[family];
    return { group: family, name: f.name, family, mode, paramLabel: (key) => f.params.find((p) => p.key === key)?.label ?? key };
  }
  const retired = RETIRED[modelId];
  if (retired) return { group: modelId, name: retired.name, family: null, mode: retired.mode, paramLabel: (key) => retired.labels[key] ?? key };
  return { group: modelId, name: modelId.split("/").slice(0, 2).join("/"), family: null, mode: null, paramLabel: (key) => key };
}

/** "Seedance 2.0 · 텍스트→영상": a stored row's model and how it was asked, for lists and captions. */
export function modelLine(modelId: string): string {
  const m = describeModel(modelId);
  return m.mode ? `${m.name} · ${MODE_LABEL[m.mode]}` : m.name;
}

type StoredRequest = { modelId: string; requestBody: WireBody | null; prompt: string; params: Record<string, unknown>; imageRefs: string[]; videoRefs: string[] };

/**
 * What every send of a stored row posts: its model_id and the bytes written at insert. It never routes or plans, so a
 * deploy that changes either cannot change a request Higgsfield may already hold. Null for an id no code ever served.
 */
export function resendRequest(row: StoredRequest): { endpoint: string; body: WireBody } | null {
  const body = row.requestBody ?? legacyBody(row);
  return body ? { endpoint: row.modelId, body } : null;
}

/**
 * The body the code before request_body built for a row it inserted: stored params, the trimmed prompt, then image_urls
 * and video_urls (Seedance) or image_url (Hailuo). Only those two endpoints were offered then. Delete this, and its
 * use in generations.ts, once `select count(*) from generations where request_body is null and status = 'pending'` is 0.
 */
export function legacyBody(row: { modelId: string; prompt: string; params: Record<string, unknown>; imageRefs: string[]; videoRefs: string[] }): WireBody | null {
  const body: Record<string, unknown> = { ...row.params };
  if (row.prompt.trim()) body.prompt = row.prompt.trim();
  if (row.modelId === "bytedance/seedance-2.0/reference-to-video") {
    if (row.imageRefs.length > 0) body.image_urls = row.imageRefs;
    if (row.videoRefs.length > 0) body.video_urls = row.videoRefs;
  } else if (row.modelId === "minimax/hailuo-2.3/standard/image-to-video") {
    if (row.imageRefs[0]) body.image_url = row.imageRefs[0];
  } else {
    return null;
  }
  return JSON.stringify(body) as WireBody;
}
