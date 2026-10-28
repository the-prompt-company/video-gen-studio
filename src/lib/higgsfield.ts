/**
 * Thin client for the Higgsfield platform API.
 * Verified against docs.higgsfield.ai and the official python SDK (2026-10):
 *   submit  POST https://api.higgsfield.ai/{model_id}            body = model arguments
 *   status  GET  https://api.higgsfield.ai/requests/{id}/status  (also carries the result)
 *   cancel  POST https://api.higgsfield.ai/requests/{id}/cancel  (queued only)
 *   upload  POST https://api.higgsfield.ai/files/generate-upload-url  -> presigned PUT
 * Outputs are deleted 7 days after the request finishes (`expires_at`).
 */

const BASE = process.env.HIGGSFIELD_BASE_URL || "https://api.higgsfield.ai"; // "" (a copied .env.example) means unset

export type HfStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

export type HfSubmitResponse = {
  status: string;
  request_id: string;
  status_url?: string;
  cancel_url?: string;
  expires_after?: number;
};

export type HfStatusResponse = {
  status: HfStatus;
  request_id: string;
  error?: string | null;
  video?: { url: string };
  images?: { url: string }[];
  audio?: { url: string };
  expires_at?: string;
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
    public retryAfterS?: number,
  ) {
    super(message);
  }
}

function headers(apiKey: string, extra?: Record<string, string>): HeadersInit {
  return { Authorization: `Key ${apiKey}`, "Content-Type": "application/json", ...extra };
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail =
      body && typeof body === "object" && "detail" in body
        ? String((body as { detail: unknown }).detail)
        : typeof body === "string"
          ? body
          : JSON.stringify(body);
    const retry = Number(res.headers.get("retry-after") ?? "") || undefined;
    throw new HiggsfieldError(res.status, `Higgsfield ${res.status}: ${detail}`, retry);
  }
  return body as T;
}

export async function submit(
  apiKey: string,
  modelId: string,
  args: Record<string, unknown>,
  idempotencyKey: string,
): Promise<HfSubmitResponse> {
  const res = await fetch(`${BASE}/${modelId}`, {
    method: "POST",
    headers: headers(apiKey, { "Idempotency-Key": idempotencyKey }),
    body: JSON.stringify(args),
  });
  return parse<HfSubmitResponse>(res);
}

export async function status(apiKey: string, requestId: string): Promise<HfStatusResponse> {
  const res = await fetch(`${BASE}/requests/${requestId}/status`, {
    headers: headers(apiKey),
    cache: "no-store",
  });
  return parse<HfStatusResponse>(res);
}

export async function cancel(apiKey: string, requestId: string): Promise<void> {
  const res = await fetch(`${BASE}/requests/${requestId}/cancel`, {
    method: "POST",
    headers: headers(apiKey),
  });
  if (!res.ok) await parse(res);
}

export async function generateUploadUrl(
  apiKey: string,
  contentType: string,
): Promise<HfUploadTicket> {
  const res = await fetch(`${BASE}/files/generate-upload-url`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ content_type: contentType }),
  });
  return parse<HfUploadTicket>(res);
}

/** Server-side upload of a small file (under the 4.5 MB function body limit). */
export async function uploadBytes(
  apiKey: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<string> {
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
