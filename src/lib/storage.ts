/**
 * The only module that knows the store, the auth and the URL format of Vercel Blob.
 * Rows store an object key, never a URL, so moving to another store or vendor is an env change plus an object copy.
 */
import { del, getDownloadUrl, put } from "@vercel/blob";

export type ObjectKey = string & { readonly __brand: "ObjectKey" };

const ONE_YEAR_S = 365 * 24 * 3600;
const VIDEO_PREFIX = "videos/";
/** Vercel recommends multipart above 100 MB: 8 MB parts, uploaded in parallel, each retried on its own. */
const MULTIPART_FROM_BYTES = 100 * 1024 * 1024;

type Config = { token: string; publicBase: string };
type PutBody = Parameters<typeof put>[1];

/**
 * BLOB_READ_WRITE_TOKEN reads vercel_blob_rw_<store id>_<secret>, and a public blob lives at
 * https://<store id>.public.blob.vercel-storage.com/<pathname>. @vercel/blob derives blob URLs the same way in get().
 * BLOB_PUBLIC_BASE_URL replaces that base, for a fake such as scripts/fake-higgsfield.ts.
 */
function config(): Config | null {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) return null;
  const override = process.env.BLOB_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  if (override) return { token, publicBase: override };
  const storeId = token.split("_")[3];
  if (!storeId) return null;
  return { token, publicBase: `https://${storeId.toLowerCase()}.public.blob.vercel-storage.com` };
}

function publicUrl(c: Config, key: string): string {
  return `${c.publicBase}/${key}`;
}

/** False without BLOB_READ_WRITE_TOKEN (local dev). Videos then keep playing from Higgsfield. */
export function storageEnabled(): boolean {
  return config() !== null;
}

export function videoKey(generationId: string): ObjectKey {
  return `${VIDEO_PREFIX}${generationId}.mp4` as ObjectKey;
}

/**
 * Upload public under the exact key, overwriting what an earlier attempt left, with a one-year cache. Keys are
 * immutable, so a repeat writes the same bytes. A body over 100 MB, or of unknown `size`, goes up in parts. The token
 * is passed, not left to the SDK's OIDC lookup, so the store written is the store videoUrls points at, and an answer
 * at another URL fails the upload instead of recording a key nobody can play.
 */
export async function putVideo(
  key: ObjectKey,
  body: PutBody,
  opts: { contentType: string; size: number | null; abortSignal?: AbortSignal },
): Promise<void> {
  const c = config();
  if (!c) throw new Error("Vercel Blob is not configured");
  const blob = await put(key, body, {
    access: "public",
    token: c.token,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: ONE_YEAR_S,
    contentType: opts.contentType,
    multipart: opts.size === null || opts.size > MULTIPART_FROM_BYTES,
    abortSignal: opts.abortSignal,
  });
  const derived = publicUrl(c, key);
  if (new URL(blob.url).href !== new URL(derived).href) {
    throw new Error(`blob URL mismatch: the store answered ${blob.url}, videoUrls derives ${derived}`);
  }
}

export type CopyLimits = { maxBytes: number; timeoutMs: number };

/**
 * Stream the body at `sourceUrl` into `key` and return its size, without ever holding the whole body in memory. It
 * refuses more than `maxBytes`, by Content-Length before anything is uploaded or by a running count that aborts the
 * upload, and gives up `timeoutMs` after the fetch starts, upload included. A failure throws its cause, not the SDK's
 * echo of it.
 */
export async function copyVideo(sourceUrl: string, key: ObjectKey, limits: CopyLimits): Promise<number> {
  const timeout = AbortSignal.timeout(limits.timeoutMs);
  const res = await fetch(sourceUrl, { signal: timeout });
  if (!res.ok || !res.body) {
    await res.body?.cancel();
    throw new Error(`result fetch failed: HTTP ${res.status}`);
  }
  const declared = Number(res.headers.get("content-length")) || null;
  if (declared !== null && declared > limits.maxBytes) {
    await res.body.cancel();
    throw new Error(`result too large: ${declared} bytes`);
  }
  // The SDK retries an upload that throws anything but an AbortError, so every stop goes through a plain abort.
  const stop = new AbortController();
  const limit = byteLimit(limits.maxBytes, () => stop.abort());
  const onTimeout = () => stop.abort();
  timeout.addEventListener("abort", onTimeout);
  try {
    await putVideo(key, res.body.pipeThrough(limit.stream), {
      contentType: res.headers.get("content-type") ?? "video/mp4",
      size: declared,
      abortSignal: stop.signal,
    });
    return limit.bytes();
  } catch (e) {
    throw limit.error() ?? (timeout.aborted ? timeout.reason : e);
  } finally {
    timeout.removeEventListener("abort", onTimeout);
  }
}

/** A pass-through that counts bytes, and errors the stream and calls `onOver` once more than `max` went by. */
export function byteLimit(max: number, onOver: () => void = () => {}) {
  let bytes = 0;
  let over: Error | null = null;
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes <= max) return controller.enqueue(chunk);
      over = new Error(`result too large: over ${max} bytes`);
      controller.error(over);
      onOver();
    },
  });
  return { stream, bytes: () => bytes, error: () => over };
}

/**
 * Public URL, plus Blob's ?download=1 one, which the CDN serves as an attachment named after the key's last segment
 * (<generation id>.mp4). Both come from the key alone, with no network call. Null while storage is off.
 */
export function videoUrls(key: ObjectKey): { url: string; downloadUrl: string } | null {
  const c = config();
  if (!c) return null;
  const url = publicUrl(c, key);
  return { url, downloadUrl: getDownloadUrl(url) };
}

/**
 * Delete temporary reference uploads, and return the URLs it deleted. imageRefs and videoRefs hold whatever URLs the
 * browser sent, so only URLs in this store are deleted, and never one whose pathname could name a stored video.
 */
export async function deleteRefs(urls: string[]): Promise<string[]> {
  const c = config();
  if (!c) return [];
  const doomed = urls.filter((u) => {
    const key = keyIn(c, u);
    return key !== null && !mayNameVideo(key);
  });
  if (doomed.length > 0) await del(doomed, { token: c.token });
  return doomed;
}

/** The pathname a URL names in this store, or null for a URL anywhere else. */
function keyIn(c: Config, url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const base = new URL(`${c.publicBase}/`);
  if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) return null;
  return u.pathname.slice(base.pathname.length);
}

/**
 * True when the key, or any percent-decoding of it, contains videos/ (in any case, with either slash) or a .. segment,
 * or does not decode. A reference this refuses is left in the store, which costs a few MB, never a video.
 */
function mayNameVideo(key: string): boolean {
  let k = key;
  for (let i = 0; i < 4; i++) {
    const plain = k.toLowerCase().replace(/\\/g, "/");
    if (plain.includes(VIDEO_PREFIX) || /(^|\/)\.\.(\/|$)/.test(plain)) return true;
    let next: string;
    try {
      next = decodeURIComponent(k);
    } catch {
      return true;
    }
    if (next === k) return false;
    k = next;
  }
  return true;
}
