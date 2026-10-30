/**
 * Thin client for OpenAI's Images API, and the only parser of its wire JSON. Verified 2026-10-29 (sources in
 * src/lib/catalog.ts):
 *   generate  POST {base}/images/generations   JSON body as stored in request_body
 *   edit      POST {base}/images/edits         the same plus images: [{ image_url }]
 *   answer    { created, data: [{ b64_json }], output_format?, quality?, size?, usage? }
 *   error     { error: { message, type, param, code } }; moderation is 400 code moderation_blocked
 * There is no request id, status, cancel, webhook or documented idempotency key, so one answer is all a caller learns,
 * and a request sent twice may be billed twice. Plain fetch on purpose: the official SDK resends 408/409/429/5xx by
 * itself. ESLint lets only src/lib/generations.ts import this module, behind the claim that allows one call per row.
 */
import type { ImageFormat, TokenUsage, WireBody } from "@/lib/catalog";
import { appError, type Reason } from "@/lib/errors";

const REAL_BASE = "https://api.openai.com/v1";
const DEFAULT_RETRY_AFTER_S = 5;

export type OpenAiKey = string & { readonly __brand: "OpenAiKey" };
export type ImageOp = "generations" | "edits";

/**
 * What one HTTP request established, as billing knowledge.
 *   image     an image in the requested format. Billed. `usage` null when OpenAI reported none.
 *   refused   a rate-limit 429 or an overloaded 503 with OpenAI's error body: turned away before any work, not billed.
 *             The only outcome that may be sent again.
 *   rejected  quota, moderation, key, region or a bad request. Not billed, and sending it again would fail the same way.
 *             `reason` is what the member reads, an error code or OpenAI's own words for a bad request.
 *   unknown   a timeout, a dropped connection, 408, 409, 500, 502, 504, an HTML 503, or a 2xx without a usable image.
 *             OpenAI may have generated and billed it. Never sent again.
 */
export type ImageOutcome =
  | { kind: "image"; bytes: Uint8Array; usage: TokenUsage | null }
  | { kind: "refused"; retryAfterS: number; detail: string }
  | { kind: "rejected"; cause: "moderation" | "key" | "quota" | "request"; reason: Reason }
  | { kind: "unknown"; why: Unanswered; usage: TokenUsage | null };

/** Why an answer was unusable. `detail` is OpenAI's or the network's own words. */
export type Unanswered =
  | { cause: "timeout"; seconds: number }
  | { cause: "disconnected"; detail: string }
  | { cause: "noImage" }
  | { cause: "wrongFormat"; format: ImageFormat }
  | { cause: "reply"; detail: string };

function base(): string {
  return (process.env.OPENAI_BASE_URL || REAL_BASE).replace(/\/+$/, "");
}

/** OPENAI_API_KEY, trimmed, or null. Never logged, never stored, never in a response. */
export function serverKey(): OpenAiKey | null {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key ? (key as OpenAiKey) : null;
}

/** True when OPENAI_BASE_URL is unset or names the real API. */
export function talksToRealOpenAi(): boolean {
  return new URL(base()).origin === new URL(REAL_BASE).origin;
}

/** Send `body` once and parse the answer. Never throws for an HTTP or network failure. */
export async function createImage(key: OpenAiKey, op: ImageOp, body: WireBody, opts: { timeoutMs: number; format: ImageFormat }): Promise<ImageOutcome> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${base()}/images/${op}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    text = await res.text();
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    const why: Unanswered = timedOut
      ? { cause: "timeout", seconds: Math.round(opts.timeoutMs / 1000) }
      : { cause: "disconnected", detail: redact(e instanceof Error ? e.message : String(e)) };
    return { kind: "unknown", why, usage: null };
  }
  return outcomeOf(res.status, res.headers, text, opts.format);
}

type ErrorBody = { error?: { message?: unknown; type?: unknown; code?: unknown } };

/** One reply as billing knowledge. Pure. */
export function outcomeOf(status: number, headers: Headers, text: string, format: ImageFormat): ImageOutcome {
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const err = (json as ErrorBody | null)?.error;
  const code = typeof err?.code === "string" ? err.code : null;
  const type = typeof err?.type === "string" ? err.type : null;
  const message = redact(typeof err?.message === "string" ? err.message : text.slice(0, 200));
  const detail = `OpenAI ${status}: ${message}`;
  if (status >= 200 && status < 300) return imageOf(json, format);
  if (status === 429) {
    if (code === "insufficient_quota" || type === "insufficient_quota") return { kind: "rejected", cause: "quota", reason: appError("openaiQuota") };
    return { kind: "refused", retryAfterS: retryAfter(headers), detail };
  }
  if (status === 503 && err) return { kind: "refused", retryAfterS: retryAfter(headers), detail };
  if (status === 400 && code === "moderation_blocked") {
    return { kind: "rejected", cause: "moderation", reason: appError("openaiModeration") };
  }
  if (status === 401 || status === 403) {
    // Only OpenAI's words tell whether the key, an IP, an organization, a missing scope or the region was refused.
    const fields = [code && `code: ${code}`, type && `type: ${type}`].filter(Boolean).join(", ");
    return { kind: "rejected", cause: "key", reason: appError("openaiKeyRejected", { status, detail: fields ? `${message} [${fields}]` : message }) };
  }
  if (status >= 400 && status < 500 && status !== 408 && status !== 409) return { kind: "rejected", cause: "request", reason: { text: detail } };
  return { kind: "unknown", why: { cause: "reply", detail }, usage: null };
}

const MAGIC: Record<ImageFormat, (b: Buffer) => boolean> = {
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};

function imageOf(json: unknown, format: ImageFormat): ImageOutcome {
  const usage = usageOf((json as { usage?: unknown } | null)?.usage);
  const b64 = (json as { data?: { b64_json?: unknown }[] } | null)?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64) return { kind: "unknown", why: { cause: "noImage" }, usage };
  const bytes = Buffer.from(b64, "base64");
  if (!MAGIC[format](bytes)) return { kind: "unknown", why: { cause: "wrongFormat", format }, usage };
  return { kind: "image", bytes, usage };
}

/** Input not split into text and image is priced at the dearer image rate. Any count that is not a whole number >= 0 makes it null. */
function usageOf(u: unknown): TokenUsage | null {
  const o = u as { input_tokens?: unknown; output_tokens?: unknown; input_tokens_details?: { image_tokens?: unknown; text_tokens?: unknown } } | null;
  const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null);
  const input = count(o?.input_tokens);
  const output = count(o?.output_tokens);
  if (input === null || output === null) return null;
  const details = o?.input_tokens_details;
  if (!details) return { inputTextTokens: 0, inputImageTokens: input, outputTokens: output };
  const image = count(details.image_tokens);
  const text = count(details.text_tokens);
  if (image === null || text === null) return null;
  return { inputTextTokens: text, inputImageTokens: image, outputTokens: output };
}

function retryAfter(headers: Headers): number {
  return Number(headers.get("retry-after") ?? "") || DEFAULT_RETRY_AFTER_S;
}

/** OpenAI's 401 and some 400s echo part of the key. */
function redact(s: string): string {
  return s.replace(/sk-[\w*.-]+/g, "sk-…");
}
