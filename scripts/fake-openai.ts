/**
 * Fake OpenAI Images API, mounted by scripts/fake-higgsfield.ts under /openai/v1, so OPENAI_BASE_URL is
 * http://localhost:4010/openai/v1. Same wire shapes as src/lib/openai.ts reads:
 *   POST /openai/v1/images/generations   JSON body checked against the documented parameters for gpt-image-2
 *   POST /openai/v1/images/edits         the same plus images: 1-16 of { image_url } or { file_id }
 * A success answers { created, background, data: [{ b64_json }], output_format, quality, size, usage } with a real
 * image in the requested format (a small PNG drawn from the prompt, a JPEG from public/mock, a 1×1 WebP) and token
 * counts derived from the request. An unknown key, a value out of range or a missing required field is a 400 shaped
 * like OpenAI's ({ error: { message, type, param, code } }); a missing Bearer key is a 401.
 *
 * Knobs, from FAKE_OPENAI_* or POST /_config { "openai": { ... } }:
 *   delayMs           wait before answering (FAKE_OPENAI_DELAY_MS, default 1500)
 *   refuseFirstN      answer the next N requests 429 rate_limit_exceeded with Retry-After retryAfterS
 *   overloadedFirstN  answer the next N requests 503 server_is_overloaded with Retry-After retryAfterS
 *   fail              every request: "moderation" (400 moderation_blocked), "badkey" (401 echoing a key fragment),
 *                     "quota" (429 insufficient_quota), "server" (500 after the delay), "hangup" (the connection is
 *                     destroyed after the delay), or null
 *   usage             false leaves usage out of the answer
 * /_stats lists every request with its operation, parsed body and HTTP status (0 for a hang-up) under `openai`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { deflateSync } from "node:zlib";

export type ImageOp = "generations" | "edits";
export type FailMode = "moderation" | "badkey" | "quota" | "server" | "hangup";
export type OpenAiFakeConfig = {
  delayMs: number;
  refuseFirstN: number;
  overloadedFirstN: number;
  retryAfterS: number;
  fail: FailMode | null;
  usage: boolean;
};

export function openAiConfigFromEnv(env: Record<string, string | undefined>): OpenAiFakeConfig {
  return {
    delayMs: Number(env.FAKE_OPENAI_DELAY_MS ?? 1500),
    refuseFirstN: 0,
    overloadedFirstN: 0,
    retryAfterS: 1,
    fail: null,
    usage: true,
  };
}

const PROMPT_MAX = 32_000;
const SHARED_KEYS = ["model", "prompt", "background", "moderation", "n", "output_compression", "output_format", "partial_images", "quality", "size", "stream", "safety_identifier", "user"];
const KEYS: Record<ImageOp, readonly string[]> = {
  generations: SHARED_KEYS,
  edits: [...SHARED_KEYS, "images", "mask", "input_fidelity"],
};
const MODELS = ["gpt-image-2", "gpt-image-2-2026-04-21"];

function sizeError(v: unknown): string | null {
  if (v === "auto") return null;
  const m = typeof v === "string" ? /^(\d+)x(\d+)$/.exec(v) : null;
  if (!m) return "size must be auto or WIDTHxHEIGHT";
  const [w, h] = [Number(m[1]), Number(m[2])];
  if (w % 16 || h % 16) return "size: width and height must both be divisible by 16";
  if (Math.max(w, h) / Math.min(w, h) > 3) return "size: the aspect ratio must be between 1:3 and 3:1";
  if (w * h < 655_360 || w * h > 8_294_400) return "size: total pixels must be between 655,360 and 8,294,400";
  if (Math.max(w, h) > 3840) return "size: no edge may exceed 3840";
  return null;
}

const isImageUrl = (u: unknown) => typeof u === "string" && (/^https?:\/\//.test(u) || /^data:image\/(png|jpeg|webp);base64,/.test(u));

/** Why OpenAI would refuse this body for gpt-image-2 (as a 400 naming `param`), or null when it fits the documented parameters. */
export function invalidImageRequest(op: ImageOp, body: Record<string, unknown>): string | null {
  for (const key of Object.keys(body)) if (!KEYS[op].includes(key)) return `Unknown parameter: '${key}'.`;
  const { model, prompt, size, quality, output_format, output_compression, background, moderation, n, stream, safety_identifier } = body;
  if (!MODELS.includes(String(model))) return "model must be gpt-image-2";
  if (typeof prompt !== "string" || prompt.length < 1 || prompt.length > PROMPT_MAX) return `prompt must be 1 to ${PROMPT_MAX} characters`;
  if (size !== undefined) {
    const e = sizeError(size);
    if (e) return e;
  }
  if (quality !== undefined && !["low", "medium", "high", "auto"].includes(String(quality))) return "quality must be low, medium, high or auto for gpt-image-2";
  if (output_format !== undefined && !["png", "jpeg", "webp"].includes(String(output_format))) return "output_format must be png, jpeg or webp";
  if (output_compression !== undefined) {
    if (!Number.isInteger(output_compression) || (output_compression as number) < 0 || (output_compression as number) > 100) return "output_compression must be 0 to 100";
    if (!["jpeg", "webp"].includes(String(output_format))) return "output_compression is only supported with jpeg or webp";
  }
  if (background !== undefined && !["transparent", "opaque", "auto"].includes(String(background))) return "background must be transparent, opaque or auto";
  if (background === "transparent" && output_format === "jpeg") return "background transparent needs output_format png or webp";
  if (moderation !== undefined && !["low", "auto"].includes(String(moderation))) return "moderation must be low or auto";
  if (n !== undefined && !(Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 10)) return "n must be 1 to 10";
  if (stream !== undefined && stream !== false) return "this fake does not stream";
  if (safety_identifier !== undefined && !(typeof safety_identifier === "string" && safety_identifier.length <= 128)) return "safety_identifier must be at most 128 characters";
  if (op === "edits") {
    if ("input_fidelity" in body) return "input_fidelity is not supported for gpt-image-2; omit it";
    const images = body.images;
    if (!Array.isArray(images) || images.length < 1 || images.length > 16) return "images must hold 1 to 16 references";
    for (const ref of images) {
      const keys = ref && typeof ref === "object" ? Object.keys(ref) : [];
      const r = ref as { image_url?: unknown; file_id?: unknown };
      const ok = keys.length === 1 && (keys[0] === "image_url" ? isImageUrl(r.image_url) : keys[0] === "file_id" && typeof r.file_id === "string");
      if (!ok) return "each image must be exactly one of { image_url } (an http(s) or base64 image URL) or { file_id }";
    }
  }
  return null;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** An RGB PNG of w×h: a diagonal gradient tinted by `seed`, so two prompts give two images. */
export function gradientPng(w: number, h: number, seed: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const at = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      rows[at + 1 + x * 3] = (x * 255) / w;
      rows[at + 2 + x * 3] = (y * 255) / h;
      rows[at + 3 + x * 3] = seed & 0xff;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(rows)), pngChunk("IEND", Buffer.alloc(0))]);
}

const JPEG = readFileSync(new URL("../public/mock/ref-square.jpg", import.meta.url));
const WEBP_1PX = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
/** Output tokens per image at the published per-image price and $30 per 1M, by quality, for the three standard sizes. */
const OUTPUT_TOKENS: Record<string, Record<string, number>> = {
  low: { "1024x1024": 200, "1024x1536": 167, "1536x1024": 167 },
  medium: { "1024x1024": 1767, "1024x1536": 1367, "1536x1024": 1367 },
  high: { "1024x1024": 7033, "1024x1536": 5500, "1536x1024": 5500 },
};
/** A reference image's input tokens here: gpt-image-1's high-fidelity count for a square image. */
const REF_TOKENS = 4354;

function imageFor(body: Record<string, unknown>, w: number, h: number): Buffer {
  if (body.output_format === "jpeg") return JPEG;
  if (body.output_format === "webp") return WEBP_1PX;
  const scale = 96 / Math.max(w, h);
  const seed = createHash("sha256").update(String(body.prompt)).digest()[0];
  return gradientPng(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), seed);
}

function usageFor(body: Record<string, unknown>, w: number, h: number) {
  const quality = String(body.quality ?? "medium") in OUTPUT_TOKENS ? String(body.quality ?? "medium") : "medium";
  const standard = w === h ? "1024x1024" : w > h ? "1536x1024" : "1024x1536";
  const [sw, sh] = standard.split("x").map(Number);
  const output = Math.round((OUTPUT_TOKENS[quality][standard] * w * h) / (sw * sh));
  const text = String(body.prompt).length;
  const image = Array.isArray(body.images) ? body.images.length * REF_TOKENS : 0;
  return { input_tokens: text + image, input_tokens_details: { image_tokens: image, text_tokens: text }, output_tokens: output, total_tokens: text + image + output };
}

function newStats() {
  return {
    /** Every request to a known operation, in arrival order. status 0 means the fake hung up instead of answering. */
    requests: [] as { op: ImageOp; body: Record<string, unknown>; status: number; usage?: ReturnType<typeof usageFor> }[],
    /** Answers that carried an image, which OpenAI would bill. */
    answered: 0,
  };
}

export function createOpenAiFake(config: OpenAiFakeConfig) {
  let stats = newStats();
  let refusals = config.refuseFirstN;
  let overloads = config.overloadedFirstN;

  function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  }

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  /** Answers a request under /openai/; false for any other path. */
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith("/openai/")) return false;
    const op = /^\/openai\/v1\/images\/(generations|edits)$/.exec(url.pathname)?.[1] as ImageOp | undefined;
    if (!op || req.method !== "POST") {
      req.resume();
      json(res, 404, { error: { message: `Invalid URL (${req.method} ${url.pathname})`, type: "invalid_request_error", param: null, code: null } });
      return true;
    }
    if (!/^Bearer \S+$/.test(req.headers.authorization ?? "")) {
      req.resume();
      json(res, 401, { error: { message: "You didn't provide an API key.", type: "invalid_request_error", param: null, code: null } });
      return true;
    }
    if (!/^application\/json/.test(req.headers["content-type"] ?? "")) {
      req.resume();
      json(res, 400, { error: { message: "this fake takes JSON bodies only", type: "invalid_request_error", param: null, code: null } });
      return true;
    }
    const body = await readJson(req);
    const entry: ReturnType<typeof newStats>["requests"][number] = { op, body: body ?? {}, status: 0 };
    stats.requests.push(entry);
    const answer = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      entry.status = status;
      json(res, status, payload, headers);
      return true;
    };
    const invalid = body ? invalidImageRequest(op, body) : "We could not parse the JSON body of your request.";
    if (invalid) return answer(400, { error: { message: invalid, type: "invalid_request_error", param: null, code: null } });
    const retryAfter = { "Retry-After": String(config.retryAfterS) };
    if (refusals > 0) {
      refusals--;
      return answer(429, { error: { message: "Rate limit reached for gpt-image-2 in organization org-fake on images per min (IPM): Limit 20.", type: "requests", param: null, code: "rate_limit_exceeded" } }, retryAfter);
    }
    if (overloads > 0) {
      overloads--;
      return answer(503, { error: { message: "The server is overloaded. Please try again later.", type: "service_unavailable_error", param: null, code: "server_is_overloaded" } }, retryAfter);
    }
    if (config.fail === "badkey") return answer(401, { error: { message: "Incorrect API key provided: sk-proj-***********************wxyz. You can find your API key at https://platform.openai.com/account/api-keys.", type: "invalid_request_error", param: null, code: "invalid_api_key" } });
    if (config.fail === "quota") return answer(429, { error: { message: "You exceeded your current quota, please check your plan and billing details.", type: "insufficient_quota", param: null, code: "insufficient_quota" } });
    if (config.fail === "moderation") {
      return answer(400, {
        error: { message: "Your request was rejected by the safety system.", type: "image_generation_user_error", param: null, code: "moderation_blocked", moderation_details: { moderation_stage: "input", categories: ["violence"] } },
      });
    }
    await new Promise((r) => setTimeout(r, config.delayMs));
    if (config.fail === "hangup") {
      res.destroy();
      return true;
    }
    if (config.fail === "server") return answer(500, { error: { message: "The server had an error while processing your request. Sorry about that!", type: "server_error", param: null, code: null } });
    const [w, h] = String(body!.size ?? "auto") === "auto" ? [1024, 1024] : String(body!.size).split("x").map(Number);
    stats.answered++;
    if (config.usage) entry.usage = usageFor(body!, w, h);
    return answer(200, {
      created: Math.floor(Date.now() / 1000),
      background: body!.background === "transparent" ? "transparent" : "opaque",
      data: [{ b64_json: imageFor(body!, w, h).toString("base64") }],
      output_format: body!.output_format ?? "png",
      quality: body!.quality ?? "medium",
      size: `${w}x${h}`,
      ...(entry.usage && { usage: entry.usage }),
    });
  }

  return {
    handle,
    stats: () => stats,
    reset() {
      stats = newStats();
      refusals = config.refuseFirstN;
      overloads = config.overloadedFirstN;
    },
    /** Applies a /_config patch and answers with every knob. */
    configure(patch: Partial<OpenAiFakeConfig>): OpenAiFakeConfig {
      if (typeof patch.delayMs === "number") config.delayMs = patch.delayMs;
      if (typeof patch.retryAfterS === "number") config.retryAfterS = patch.retryAfterS;
      if (typeof patch.refuseFirstN === "number") refusals = config.refuseFirstN = patch.refuseFirstN;
      if (typeof patch.overloadedFirstN === "number") overloads = config.overloadedFirstN = patch.overloadedFirstN;
      if (patch.fail !== undefined) config.fail = patch.fail;
      if (typeof patch.usage === "boolean") config.usage = patch.usage;
      return { ...config };
    },
  };
}
