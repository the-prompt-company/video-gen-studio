/**
 * Model catalog: the models a member picks from, the endpoint each request goes to, the exact body it sends, and what
 * it costs. Shared by the playground (client) and the generate route (server), so the mode the member sees, the
 * endpoint the server calls and the price both show come from one function, planGeneration.
 *
 * Higgsfield (video). Verified 2026-10-29 against each endpoint's page and api-reference on open.higgsfield.ai (input
 * JSON schemas, all additionalProperties: false; an unknown endpoint path is 404):
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
 *
 * OpenAI (image). Verified 2026-10-29 against the official openai npm 7.45.1 (resources/images.d.ts) and
 * developers.openai.com: models/gpt-image-2, pricing, guides/image-generation, reference images generate and edit:
 *   openai/gpt-image-2/generations   POST /v1/images/generations, JSON: model, prompt (<= 32,000 chars), size (any
 *                                    WxH with both sides divisible by 16, ratio 1:3-3:1, 655,360-8,294,400 px, edge
 *                                    <= 3840; 1024x1024, 1536x1024, 1024x1536 standard), quality low|medium|high|auto,
 *                                    output_format png|jpeg|webp, background auto|opaque|transparent (transparent is a
 *                                    preview for gpt-image-2 and needs png or webp), moderation, n 1-10, safety_identifier
 *   openai/gpt-image-2/edits         POST /v1/images/edits, the same plus images: 1-16 of { image_url } (a URL OpenAI
 *                                    fetches); input_fidelity must be omitted for gpt-image-2 (inputs are always read
 *                                    at high fidelity)
 * The answer is base64 in data[0].b64_json, with usage { input_tokens_details { text_tokens, image_tokens },
 * output_tokens } that the reference labels "gpt-image-1 only", so a missing usage falls back to the estimate.
 * Prices per 1M tokens (Standard): text input $5, image input $8, image output $30. Per image for GPT Image 2 (guide,
 * Calculating costs): low $0.006 / $0.005 / $0.005, medium $0.053 / $0.041 / $0.041, high $0.211 / $0.165 / $0.165 at
 * 1024x1024 / 1024x1536 / 1536x1024. gpt-image-2's input-image tokenization is not published.
 */

export type Mode = "t2v" | "i2v" | "r2v" | "t2i" | "r2i";
export const MODES: readonly Mode[] = ["t2v", "i2v", "r2v", "t2i", "r2i"];
export const MODE_LABEL: Record<Mode, string> = {
  t2v: "텍스트→영상",
  i2v: "이미지→영상",
  r2v: "레퍼런스→영상",
  t2i: "텍스트→이미지",
  r2i: "레퍼런스→이미지",
};
/** The endpoint id's last segment. An OpenAI id ends in the Images API operation it posts to. */
const SLUG: Record<Mode, string> = {
  t2v: "text-to-video",
  i2v: "image-to-video",
  r2v: "reference-to-video",
  t2i: "generations",
  r2i: "edits",
};

export type FamilyId = "bytedance/seedance-2.0" | "minimax/h3" | "openai/gpt-image-2";
export const FAMILY_IDS: readonly FamilyId[] = ["bytedance/seedance-2.0", "minimax/h3", "openai/gpt-image-2"];

/** Who runs the request. higgsfield: a queued job with a request id and an Idempotency-Key. openai: one synchronous call. */
export type Provider = "higgsfield" | "openai";
/** What the request makes: the element the browser shows and the key storage writes. */
export type Output = "video" | "image";

/**
 * A model's modes and which attachments pick each. Nothing attached picks `text`. Exactly one image, no video, and
 * "이 이미지로 시작" pick `firstFrame` where the model has one. Anything else picks `reference`.
 */
export type ModeSet =
  | { output: "video"; text: "t2v"; firstFrame: "i2v"; reference: "r2v" }
  | { output: "image"; text: "t2i"; firstFrame: null; reference: "r2i" };

export function isFamilyId(s: string): s is FamilyId {
  return (FAMILY_IDS as readonly string[]).includes(s);
}

/** The exact JSON text the provider receives for one request. Stored on the row and sent verbatim on every attempt. */
export type WireBody = string & { readonly __brand: "WireBody" };

/** `modes`: the modes whose endpoint schema has this key; absent means every mode of the model. */
export type ParamSpec = (
  | { key: string; label: string; type: "int"; min: number; max: number; default: number }
  | { key: string; label: string; type: "bool"; default: boolean }
  /** `numeric` sends the chosen option as a number (e.g. duration 5 | 10 | 15). `labels` names options for the member. */
  | { key: string; label: string; type: "enum"; options: readonly string[]; default: string; numeric?: true; labels?: Readonly<Record<string, string>> }
) & { modes?: readonly Mode[] };

export type Params = Readonly<Record<string, string | number | boolean>>;

/** The image model's output_format, which also names the stored file's extension. */
export type ImageFormat = "png" | "jpeg" | "webp";

/** Token counts the provider reported for one request, parsed at its boundary. */
export type TokenUsage = { inputTextTokens: number; inputImageTokens: number; outputTokens: number };

/**
 * What one request is billed on. Video models read the first four fields. The image model also reads the prompt and
 * reference counts for its estimate, and `usage`, when the provider reported it, instead of the estimate.
 */
export type CostBasis = {
  family: FamilyId;
  mode: Mode;
  params: Readonly<Record<string, unknown>>;
  inputVideoS: number;
  promptChars?: number;
  inputImages?: number;
  usage?: TokenUsage | null;
};

type BodyInput = { mode: Mode; params: Params; prompt: string; images: readonly string[]; videos: readonly string[] };

export type Family = {
  id: FamilyId;
  provider: Provider;
  modes: ModeSet;
  name: string;
  vendor: string;
  blurb: string;
  note: string;
  /** What the reference dialog says references do for this model. */
  refNote: string;
  /** What the image picker accepts. `maxBytes` null keeps the 4 MB server upload / larger Blob upload split. */
  refImages: { types: readonly string[]; hint: string; maxBytes: number | null };
  params: readonly ParamSpec[];
  promptRequiredIn: readonly Mode[];
  maxImages: number;
  maxVideos: number;
  /** The provider's JSON body for a checked request. Its key order is part of the bytes stored in request_body. */
  body(r: BodyInput): Record<string, unknown>;
  /** Why this model refuses a request whose params, caps and prompt passed, or null. */
  check(r: BodyInput): string | null;
  /** Short facts for the estimate line: ["5s", "720p"] or ["1024×1024", "medium", "레퍼런스 2장"]. */
  facts(b: CostBasis): string[];
  rate: {
    /** What the admin's one number prices ("480p·16:9", "2K", "이미지 출력"). */
    basis: string;
    /** The rate's denominator after a price ("s", "1M 토큰") and in the admin label ("초당", "100만 토큰당"). */
    per: { short: string; long: string };
    /** The rate while no admin has saved one. */
    defaultUsd: number;
    /** The provider's published figures in that unit, offered as one-click fills. */
    published: readonly { label: string; usd: number }[];
    /** One request the admin page prices at the rate being typed, so the unit reads as money. */
    example: { label: string; basis: CostBasis };
    /** Billable units of a request, rate-free so any rate can be previewed: the provider's usage when given, else the estimate. */
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
const SEEDANCE_UNIT_TOKENS = tokensPerSecond(SEEDANCE_FRAME["480p"]["16:9"]);

const largestFrame = (frames: Record<string, Size>): Size => Object.values(frames).reduce((a, s) => (s[0] * s[1] > a[0] * a[1] ? s : a));

function seedanceUnits(b: CostBasis): number {
  const frames = SEEDANCE_FRAME[String(b.params.resolution)] ?? SEEDANCE_FRAME["480p"];
  const size = b.mode === "i2v" ? largestFrame(frames) : (frames[String(b.params.aspect_ratio)] ?? frames["16:9"]);
  const tokens = Math.ceil((Number(b.params.duration) + b.inputVideoS) * tokensPerSecond(size));
  const weight = (b.params.resolution === "4k" ? 0.008 / 0.014 : 1) * (b.inputVideoS > 0 ? 0.6 : 1);
  return (tokens * weight) / SEEDANCE_UNIT_TOKENS;
}

/** H3 reference-to-video bills $0.08 for each image past this many, so the app takes no more. */
const H3_IMAGES_WITHOUT_SURCHARGE = 5;

const DURATION_SEEDANCE: ParamSpec = { key: "duration", label: "길이(초)", type: "int", min: 4, max: 15, default: 5 };

const VIDEO_MODES: ModeSet = { output: "video", text: "t2v", firstFrame: "i2v", reference: "r2v" };
const HIGGSFIELD_REF_NOTE =
  "레퍼런스는 선택입니다. 없으면 프롬프트만으로 만들고, 이미지 한 장만 올리면 그 이미지로 시작할지 서랍에서 고릅니다. 이미지와 영상은 올린 순서대로 번호가 붙고 그 순서로 모델에 전달됩니다. 영상 레퍼런스는 길이만큼 비용에 더해질 수 있습니다.";
const HIGGSFIELD_REF_IMAGES = { types: ["image/jpeg", "image/png", "image/webp", "image/gif"], hint: "jpeg · png · webp · gif · 4 MB 이하", maxBytes: null };

/** Params, the trimmed prompt when there is one, then the mode's media fields. */
function higgsfieldBody({ mode, params, prompt, images, videos }: BodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = { ...params };
  if (prompt) body.prompt = prompt;
  if (mode === "i2v") body.image_url = images[0];
  if (mode === "r2v" && images.length > 0) body.image_urls = images;
  if (mode === "r2v" && videos.length > 0) body.video_urls = videos;
  return body;
}

function videoFacts(b: CostBasis): string[] {
  const facts = [`${Number(b.params.duration ?? 0)}s`];
  if (typeof b.params.resolution === "string") facts.push(b.params.resolution);
  if (b.inputVideoS > 0 && b.family === "bytedance/seedance-2.0") facts.push(`입력 영상 ${b.inputVideoS.toFixed(1)}s`);
  return facts;
}

const GPT_IMAGE_2 = "gpt-image-2";
const OPENAI_PROMPT_MAX = 32_000;
type ImageQuality = "low" | "medium" | "high";
type PricedSize = "1024x1024" | "1024x1536" | "1536x1024";
/** USD per 1M tokens, Standard. The admin's rate stands for `out`; the inputs keep these ratios to it. */
const GPT_IMAGE_2_USD_PER_M = { textIn: 5, imageIn: 8, out: 30 } as const;
const GPT_IMAGE_2_IMAGE_USD: Record<ImageQuality, Record<PricedSize, number>> = {
  low: { "1024x1024": 0.006, "1024x1536": 0.005, "1536x1024": 0.005 },
  medium: { "1024x1024": 0.053, "1024x1536": 0.041, "1536x1024": 0.041 },
  high: { "1024x1024": 0.211, "1024x1536": 0.165, "1536x1024": 0.165 },
};
/**
 * The drawer's aspect choices and the size each sends. 16:9 and 9:16 have no published price; they have fewer pixels
 * than the same orientation's standard size and are estimated at its price, which usage then replaces.
 */
const GPT_IMAGE_2_SHAPES: Record<string, { size: string; label: string; priced: PricedSize }> = {
  "1:1": { size: "1024x1024", label: "1024×1024", priced: "1024x1024" },
  "3:2": { size: "1536x1024", label: "1536×1024", priced: "1536x1024" },
  "2:3": { size: "1024x1536", label: "1024×1536", priced: "1024x1536" },
  "16:9": { size: "1536x864", label: "1536×864", priced: "1536x1024" },
  "9:16": { size: "864x1536", label: "864×1536", priced: "1024x1536" },
};
/**
 * Input tokens the estimate counts per reference image. gpt-image-2's are unpublished and it reads every input at high
 * fidelity, so this is gpt-image-1's published high-fidelity count for a 3:2 or 16:9 input: shortest side to 512 px,
 * 65 + 129 per 512 tile (2 tiles) + 6,240. A square input is 4,354 there.
 */
const GPT_IMAGE_2_REF_TOKENS = 6_563;

function gptImage2Units(b: CostBasis): number {
  const quality = (String(b.params.quality) in GPT_IMAGE_2_IMAGE_USD ? b.params.quality : "medium") as ImageQuality;
  const shape = GPT_IMAGE_2_SHAPES[String(b.params.aspect_ratio)] ?? GPT_IMAGE_2_SHAPES["1:1"];
  const t: TokenUsage = b.usage ?? {
    outputTokens: (GPT_IMAGE_2_IMAGE_USD[quality][shape.priced] / GPT_IMAGE_2_USD_PER_M.out) * 1e6,
    inputTextTokens: b.promptChars ?? 0,
    inputImageTokens: (b.inputImages ?? 0) * GPT_IMAGE_2_REF_TOKENS,
  };
  const { textIn, imageIn, out } = GPT_IMAGE_2_USD_PER_M;
  return (t.outputTokens + (t.inputTextTokens * textIn) / out + (t.inputImageTokens * imageIn) / out) / 1e6;
}

/** No input_fidelity ("omit for gpt-image-2") and no n: a row holds one result. */
function gptImage2Body({ mode, params, prompt, images }: BodyInput): Record<string, unknown> {
  return {
    model: GPT_IMAGE_2,
    prompt,
    size: GPT_IMAGE_2_SHAPES[String(params.aspect_ratio)].size,
    quality: params.quality,
    output_format: params.output_format,
    background: params.background,
    ...(mode === "r2i" && { images: images.map((image_url) => ({ image_url })) }),
  };
}

export const FAMILIES: Record<FamilyId, Family> = {
  "bytedance/seedance-2.0": {
    id: "bytedance/seedance-2.0",
    provider: "higgsfield",
    modes: VIDEO_MODES,
    name: "Seedance 2.0",
    vendor: "ByteDance",
    blurb: "텍스트만으로, 이미지 한 장을 첫 프레임으로, 또는 이미지 최대 6장·영상 최대 3개를 레퍼런스로. 480p~4K, 화면비 선택, 오디오 생성.",
    note: "비용은 해상도·길이에 비례합니다. 연습은 480p, 납품은 720p 이상을 권합니다.",
    refNote: HIGGSFIELD_REF_NOTE,
    refImages: HIGGSFIELD_REF_IMAGES,
    params: [
      DURATION_SEEDANCE,
      { key: "resolution", label: "해상도", type: "enum", options: ["480p", "720p", "1080p", "4k"], default: "480p" },
      { key: "aspect_ratio", label: "화면비", type: "enum", options: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"], default: "16:9", modes: ["t2v", "r2v"] },
      { key: "generate_audio", label: "오디오 생성", type: "bool", default: false },
    ],
    promptRequiredIn: ["t2v"],
    maxImages: 6,
    maxVideos: 3,
    body: higgsfieldBody,
    check: () => null,
    facts: videoFacts,
    rate: {
      basis: "480p·16:9",
      per: { short: "s", long: "초당" },
      defaultUsd: 0,
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
    provider: "higgsfield",
    modes: VIDEO_MODES,
    name: "MiniMax H3",
    vendor: "MiniMax",
    blurb: "텍스트만으로, 이미지 한 장을 첫 프레임으로, 또는 이미지 최대 5장·영상 최대 3개를 레퍼런스로. 2K, 5·10·15초.",
    note: "출력은 2K로 고정입니다. 어떤 방식이든 프롬프트가 필요합니다.",
    refNote: HIGGSFIELD_REF_NOTE,
    refImages: HIGGSFIELD_REF_IMAGES,
    params: [
      { key: "duration", label: "길이(초)", type: "enum", options: ["5", "10", "15"], default: "5", numeric: true },
      { key: "aspect_ratio", label: "화면비", type: "enum", options: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"], default: "auto" },
      { key: "aigc_watermark", label: "AI 생성 워터마크", type: "bool", default: false },
    ],
    promptRequiredIn: ["t2v", "i2v", "r2v"],
    maxImages: H3_IMAGES_WITHOUT_SURCHARGE,
    maxVideos: 3,
    body: higgsfieldBody,
    check: () => null,
    facts: videoFacts,
    rate: {
      basis: "2K",
      per: { short: "s", long: "초당" },
      defaultUsd: 0,
      published: [
        { label: "Higgsfield 표 · 50% 할인", usd: 0.065 },
        { label: "정가", usd: 0.13 },
      ],
      example: { label: "10초", basis: { family: "minimax/h3", mode: "t2v", params: { duration: 10 }, inputVideoS: 0 } },
      units: (b) => Number(b.params.duration),
    },
  },
  "openai/gpt-image-2": {
    id: "openai/gpt-image-2",
    provider: "openai",
    modes: { output: "image", text: "t2i", firstFrame: null, reference: "r2i" },
    name: "GPT Image 2",
    vendor: "OpenAI",
    blurb: "프롬프트만으로, 또는 이미지 최대 16장을 레퍼런스로 넣어 이미지를 만듭니다. 화면비 5가지, 품질 3단계, PNG·JPEG·WebP.",
    note: "레퍼런스가 있으면 OpenAI 편집으로 갑니다. 보통 수십 초에서 2분 걸리고, 비용은 OpenAI가 알려 준 토큰 사용량으로 확정됩니다.",
    refNote:
      "레퍼런스는 선택입니다. 없으면 프롬프트만으로 만들고, 이미지를 올리면 OpenAI 편집으로 그 이미지들을 바탕으로 만듭니다. 이미지는 올린 순서대로 번호가 붙고 그 순서로 전달되며, 장마다 입력 비용이 더해집니다.",
    refImages: { types: ["image/png", "image/jpeg", "image/webp"], hint: "png · jpeg · webp · 50 MB 이하", maxBytes: 50 * 1024 * 1024 },
    params: [
      { key: "aspect_ratio", label: "화면비", type: "enum", options: Object.keys(GPT_IMAGE_2_SHAPES), default: "1:1" },
      { key: "quality", label: "품질", type: "enum", options: Object.keys(GPT_IMAGE_2_IMAGE_USD), default: "medium", labels: { low: "낮음 · low", medium: "중간 · medium", high: "높음 · high" } },
      { key: "output_format", label: "파일 형식", type: "enum", options: ["png", "jpeg", "webp"], default: "png", labels: { png: "PNG", jpeg: "JPEG", webp: "WebP" } },
      { key: "background", label: "배경", type: "enum", options: ["auto", "opaque", "transparent"], default: "auto", labels: { auto: "자동", opaque: "불투명", transparent: "투명 (PNG·WebP)" } },
    ],
    promptRequiredIn: ["t2i", "r2i"],
    maxImages: 16,
    maxVideos: 0,
    body: gptImage2Body,
    check: ({ prompt, params }) => {
      if (prompt.length > OPENAI_PROMPT_MAX) return `프롬프트는 ${OPENAI_PROMPT_MAX.toLocaleString("en-US")}자까지입니다`;
      if (params.background === "transparent" && params.output_format === "jpeg") return "투명 배경은 PNG나 WebP로만 저장됩니다. 파일 형식을 바꾸세요";
      return null;
    },
    facts: (b) => {
      const facts = [(GPT_IMAGE_2_SHAPES[String(b.params.aspect_ratio)] ?? GPT_IMAGE_2_SHAPES["1:1"]).label, String(b.params.quality)];
      if (b.inputImages) facts.push(`레퍼런스 ${b.inputImages}장`);
      return facts;
    },
    rate: {
      basis: "이미지 출력",
      per: { short: "1M 토큰", long: "100만 토큰당" },
      defaultUsd: GPT_IMAGE_2_USD_PER_M.out,
      published: [{ label: "OpenAI 정가", usd: GPT_IMAGE_2_USD_PER_M.out }],
      example: {
        label: "1024×1024 중간 품질 1장",
        basis: { family: "openai/gpt-image-2", mode: "t2i", params: { aspect_ratio: "1:1", quality: "medium" }, inputVideoS: 0 },
      },
      units: gptImage2Units,
    },
  },
};

const RETIRED: Record<string, { name: string; mode: Mode; labels: Record<string, string> }> = {
  "minimax/hailuo-2.3/standard/image-to-video": { name: "Hailuo 2.3 Standard", mode: "i2v", labels: { duration: "길이(초)", prompt_optimizer: "프롬프트 자동 보정" } },
};

/** The model's modes in the order the drawer lists them. */
export function modesOf(family: FamilyId): Mode[] {
  const m = FAMILIES[family].modes;
  return m.firstFrame ? [m.text, m.firstFrame, m.reference] : [m.text, m.reference];
}

export function endpointOf(family: FamilyId, mode: Mode): string {
  return `${family}/${SLUG[mode]}`;
}

export function endpointsOf(family: FamilyId): string[] {
  return modesOf(family).map((m) => endpointOf(family, m));
}

/** Every stored endpoint id a provider serves. */
export function endpointsOfProvider(provider: Provider): string[] {
  return FAMILY_IDS.filter((f) => FAMILIES[f].provider === provider).flatMap(endpointsOf);
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

/** The one routing rule, over the model's modes. */
export function routeMode(family: FamilyId, images: number, videos: number, startFromImage: boolean): Mode {
  const m = FAMILIES[family].modes;
  if (images + videos === 0) return m.text;
  if (m.firstFrame && images === 1 && videos === 0 && startFromImage) return m.firstFrame;
  return m.reference;
}

/** Rounded to 4 decimals, the scale of cost_usd. Prices the estimate before submit and the provider's usage after. */
export function costUsd(b: CostBasis, rateUsd: number): number {
  return Math.round(rateUsd * FAMILIES[b.family].rate.units(b) * 1e4) / 1e4;
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
  /** "이 이미지로 시작". Counts only while exactly one image and no video is attached, for a model with a first frame. */
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
  /** The rate the estimate used. The image runner prices OpenAI's usage at the same rate the member saw. */
  rateUsd: number;
  /** What the estimate priced. */
  costBasis: CostBasis;
  /** Rounded to 4 decimals, the scale of cost_usd. */
  costUsd: number;
  facts: readonly string[];
};
export type Plan = PlanBase & ({ ready: true; body: WireBody } | { ready: false; blocker: string });
export type ReadyPlan = Extract<Plan, { ready: true }>;

/**
 * Routing, param checks, the prompt rule, the request body and the cost, in one pure call: the drawer runs it on every
 * change, the route runs it on the POST, and only a ready plan is inserted. The body is the model's own (body()).
 */
export function planGeneration(draft: Draft, baseRateUsd: number): Plan {
  const family = FAMILIES[draft.family];
  const images = draft.images.length;
  const videos = draft.videos.length;
  const mode = routeMode(family.id, images, videos, draft.startFromImage);
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
  const costBasis: CostBasis = { family: family.id, mode, params, inputVideoS, promptChars: prompt.length, inputImages: images };
  const base: PlanBase = {
    family: family.id,
    mode,
    endpoint: endpointOf(family.id, mode),
    offersStartFromImage: family.modes.firstFrame !== null && images === 1 && videos === 0,
    prompt,
    params,
    imageUrls: draft.images,
    videoUrls: draft.videos.map((v) => v.url),
    durationS: Number(params.duration ?? 0),
    rateUsd: baseRateUsd,
    costBasis,
    costUsd: blocker ? 0 : costUsd(costBasis, baseRateUsd),
    facts: family.facts(costBasis),
  };
  const input: BodyInput = { mode, params, prompt, images: draft.images, videos: base.videoUrls };
  if (images > family.maxImages) blocker = `${family.name}에는 이미지를 최대 ${family.maxImages}장까지 넣을 수 있습니다`;
  else if (videos > 0 && family.maxVideos === 0) blocker = `${family.name}은(는) 영상 레퍼런스를 받지 않습니다. 영상을 빼 주세요`;
  else if (videos > family.maxVideos) blocker = `${family.name}에는 영상을 최대 ${family.maxVideos}개까지 넣을 수 있습니다`;
  else if (draft.videos.some((v) => !(Number.isFinite(v.seconds) && v.seconds > 0 && v.seconds <= 600))) blocker = "영상 길이를 읽지 못한 레퍼런스가 있습니다. 그 영상을 빼고 다시 올려 주세요";
  else if (draft.mode !== mode) blocker = `화면의 생성 방식(${MODE_LABEL[draft.mode]})이 첨부와 맞지 않습니다. 페이지를 새로고침하세요`;
  else if (!blocker && family.promptRequiredIn.includes(mode) && !prompt) blocker = `${family.name} ${MODE_LABEL[mode]}에는 프롬프트가 필요합니다`;
  else if (!blocker) blocker = family.check(input);
  if (blocker) return { ...base, ready: false, blocker };
  return { ...base, ready: true, body: JSON.stringify(family.body(input)) as WireBody };
}

/** How any stored generations.model_id reads. `group` is the model it counts under in usage. */
export type ModelLabel = {
  group: string;
  name: string;
  family: FamilyId | null;
  mode: Mode | null;
  /** A retired or unknown id reads as a Higgsfield video, which is all the app ever sent before OpenAI. */
  provider: Provider;
  output: Output;
  paramLabel(key: string): string;
};

export function describeModel(modelId: string): ModelLabel {
  for (const family of FAMILY_IDS) {
    const mode = modesOf(family).find((m) => endpointOf(family, m) === modelId);
    if (!mode) continue;
    const f = FAMILIES[family];
    return { group: family, name: f.name, family, mode, provider: f.provider, output: f.modes.output, paramLabel: (key) => f.params.find((p) => p.key === key)?.label ?? key };
  }
  const old = { provider: "higgsfield", output: "video" } as const;
  const retired = RETIRED[modelId];
  if (retired) return { group: modelId, name: retired.name, family: null, mode: retired.mode, ...old, paramLabel: (key) => retired.labels[key] ?? key };
  return { group: modelId, name: modelId.split("/").slice(0, 2).join("/"), family: null, mode: null, ...old, paramLabel: (key) => key };
}

/** "Seedance 2.0 · 텍스트→영상": a stored row's model and how it was asked, for lists and captions. */
export function modelLine(modelId: string): string {
  const m = describeModel(modelId);
  return m.mode ? `${m.name} · ${MODE_LABEL[m.mode]}` : m.name;
}

type StoredRequest = { modelId: string; requestBody: WireBody | null; prompt: string; params: Record<string, unknown>; imageRefs: string[]; videoRefs: string[] };

/**
 * What every send of a stored Higgsfield row posts: its model_id and the bytes written at insert. It never routes or
 * plans, so a deploy that changes either cannot change a request Higgsfield may already hold. Null for an id no code
 * ever served.
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
