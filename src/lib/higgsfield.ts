/**
 * Thin client for the Higgsfield platform API, and the only parser of its wire JSON.
 * Verified against docs.higgsfield.ai and the official python SDK (2026-10):
 *   submit  POST https://api.higgsfield.ai/{model_id}            body = model arguments
 *   status  GET  https://api.higgsfield.ai/requests/{id}/status  (also carries the result)
 *   cancel  POST https://api.higgsfield.ai/requests/{id}/cancel  (queued only)
 *   upload  POST https://api.higgsfield.ai/files/generate-upload-url  -> presigned PUT
 * Outputs are deleted 7 days after the request finishes (`expires_at`).
 */

const BASE = process.env.HIGGSFIELD_BASE_URL || "https://api.higgsfield.ai";
const SUBMIT_TIMEOUT_MS = 20_000;
const STATUS_TIMEOUT_MS = 8_000;
const DEFAULT_RETRY_AFTER_S = 30;

export type ApiKey = string & { readonly __brand: "HiggsfieldApiKey" };
export type RequestId = string & { readonly __brand: "HiggsfieldRequestId" };

/** What one submit attempt established. Retryable failures are data, because the caller decides when to resend. */
export type SubmitOutcome =
  | { kind: "accepted"; requestId: RequestId }
  | { kind: "deferred"; cause: "rate_limited" | "unavailable"; retryAfterS: number; detail: string }
  | { kind: "rejected"; error: string };

/** What Higgsfield says about one request. */
export type ProviderState =
  | { kind: "running"; status: "queued" | "in_progress" }
  | { kind: "completed"; videoUrl: string; expiresAt: Date | null }
  | { kind: "ended"; status: "failed" | "nsfw" | "canceled"; error: string | null; expiresAt: Date | null }
  | { kind: "missing" };

/** Higgsfield gave no usable answer: 429, 5xx, another non-404 error, a network error, a timeout, or an unknown body. */
export class ProviderUnavailable extends Error {
  constructor(
    message: string,
    public readonly retryAfterS?: number,
  ) {
    super(message);
  }
}

type HfSubmitResponse = { request_id?: unknown };

type HfStatusResponse = {
  status?: unknown;
  error?: unknown;
  video?: { url?: unknown };
  images?: { url?: unknown }[];
  expires_at?: unknown;
};

export type HfUploadTicket = {
  public_url: string;
  upload_url: string;
  content_type: string;
  upload_headers?: Record<string, string>;
};

export class HiggsfieldError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function headers(apiKey: ApiKey, extra?: Record<string, string>): HeadersInit {
  return { Authorization: `Key ${apiKey}`, "Content-Type": "application/json", ...extra };
}

type Reply = { status: number; body: unknown; retryAfterS: number | undefined; detail: string };

async function read(res: Response): Promise<Reply> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  const detail =
    body && typeof body === "object" && "detail" in body
      ? String((body as { detail: unknown }).detail)
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  const retryAfterS = Number(res.headers.get("retry-after") ?? "") || undefined;
  return { status: res.status, body, retryAfterS, detail: `Higgsfield ${res.status}: ${detail}` };
}

function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function submit(
  apiKey: ApiKey,
  modelId: string,
  args: Record<string, unknown>,
  opts: { idempotencyKey: string; webhookUrl: string | null },
): Promise<SubmitOutcome> {
  const url = new URL(`${BASE}/${modelId}`);
  if (opts.webhookUrl) url.searchParams.set("hf_webhook", opts.webhookUrl);
  let reply: Reply;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(apiKey, { "Idempotency-Key": opts.idempotencyKey }),
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
    reply = await read(res);
  } catch (e) {
    return { kind: "deferred", cause: "unavailable", retryAfterS: DEFAULT_RETRY_AFTER_S, detail: `Higgsfield에 연결할 수 없습니다: ${message(e)}` };
  }
  if (isTransient(reply.status)) {
    return {
      kind: "deferred",
      cause: reply.status === 429 ? "rate_limited" : "unavailable",
      retryAfterS: reply.retryAfterS ?? DEFAULT_RETRY_AFTER_S,
      detail: reply.detail,
    };
  }
  if (reply.status >= 400) return { kind: "rejected", error: reply.detail };
  const id = (reply.body as HfSubmitResponse | null)?.request_id;
  if (typeof id !== "string" || !id) return { kind: "rejected", error: "Higgsfield 응답에 request_id가 없습니다" };
  return { kind: "accepted", requestId: id as RequestId };
}

function parseState(body: HfStatusResponse | null): ProviderState {
  const status = body?.status;
  const expiresAt = typeof body?.expires_at === "string" ? new Date(body.expires_at) : null;
  const error = typeof body?.error === "string" ? body.error : null;
  switch (status) {
    case "queued":
    case "in_progress":
      return { kind: "running", status };
    case "completed": {
      const url = body?.video?.url ?? body?.images?.[0]?.url;
      if (typeof url === "string" && url) return { kind: "completed", videoUrl: url, expiresAt };
      return { kind: "ended", status: "failed", error: "완료됐지만 결과 URL이 없습니다", expiresAt };
    }
    case "failed":
    case "nsfw":
    case "canceled":
      return { kind: "ended", status, error, expiresAt };
    default:
      throw new ProviderUnavailable(`Higgsfield가 알 수 없는 상태를 돌려줬습니다: ${String(status)}`);
  }
}

export async function status(apiKey: ApiKey, requestId: RequestId): Promise<ProviderState> {
  let reply: Reply;
  try {
    const res = await fetch(`${BASE}/requests/${requestId}/status`, {
      headers: headers(apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    reply = await read(res);
  } catch (e) {
    throw new ProviderUnavailable(`Higgsfield 상태 조회 실패: ${message(e)}`);
  }
  if (reply.status === 404) return { kind: "missing" };
  if (reply.status >= 400) throw new ProviderUnavailable(reply.detail, reply.retryAfterS);
  return parseState(reply.body as HfStatusResponse | null);
}

/** "not_cancelable" means Higgsfield refused because the request has moved past queued (or does not exist). */
export async function cancel(apiKey: ApiKey, requestId: RequestId): Promise<"canceled" | "not_cancelable"> {
  let reply: Reply;
  try {
    const res = await fetch(`${BASE}/requests/${requestId}/cancel`, {
      method: "POST",
      headers: headers(apiKey),
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    reply = await read(res);
  } catch (e) {
    throw new ProviderUnavailable(`Higgsfield 취소 요청 실패: ${message(e)}`);
  }
  if (isTransient(reply.status)) throw new ProviderUnavailable(reply.detail, reply.retryAfterS);
  return reply.status >= 400 ? "not_cancelable" : "canceled";
}

export async function generateUploadUrl(apiKey: ApiKey, contentType: string): Promise<HfUploadTicket> {
  const res = await fetch(`${BASE}/files/generate-upload-url`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ content_type: contentType }),
  });
  const reply = await read(res);
  if (reply.status >= 400) throw new HiggsfieldError(reply.status, reply.detail);
  return reply.body as HfUploadTicket;
}

/** Server-side upload of a small file (under the 4.5 MB function body limit). */
export async function uploadBytes(apiKey: ApiKey, bytes: ArrayBuffer, contentType: string): Promise<string> {
  const ticket = await generateUploadUrl(apiKey, contentType);
  const put = await fetch(ticket.upload_url, {
    method: "PUT",
    headers: ticket.upload_headers ?? { "Content-Type": contentType },
    body: bytes,
  });
  if (!put.ok) throw new HiggsfieldError(put.status, `upload failed: ${put.status}`);
  return ticket.public_url;
}

export const UPLOAD_CONTENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "audio/wav",
  "audio/x-wav",
] as const;
