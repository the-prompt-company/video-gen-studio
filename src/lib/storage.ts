/**
 * The only module that knows the store, the auth and the URL format of Vercel Blob.
 * Rows store an object key, never a URL, so moving to another store or vendor is an env change plus an object copy.
 */
import { randomUUID } from "node:crypto";
import { BlobNotFoundError, createMultipartUploader, del, getDownloadUrl, head, put, type Part } from "@vercel/blob";
import type { AvatarType } from "./avatar";
import type { ImageFormat } from "./catalog";
import { REF_NAME } from "./ref-name";

export type ObjectKey = string & { readonly __brand: "ObjectKey" };

const ONE_YEAR_S = 365 * 24 * 3600;
const VIDEO_PREFIX = "videos/";
/** The SDK's own multipart part size. A body that fits in one part goes up in one request. */
const PART_BYTES = 8 * 1024 * 1024;
/** Parts uploading at once. The SDK's fetch copies and tees each part's body, so one in flight costs about 24 MB. */
const PARTS_IN_FLIGHT = 4;

type Config = { token: string; publicBase: string };

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

/** Where a member's reference uploads go. deleteRefs deletes a row's references only under its owner's prefix. */
export function refPrefix(userId: number): string {
  return `refs/${userId}/`;
}

/**
 * The one pathname rule for references: a REF_NAME file name directly under the user's refPrefix. The upload route
 * checks it before issuing a token and deleteRefs before deleting, so neither ever touches videos/ or another member.
 */
export function isRefPathname(pathname: string, userId: number): boolean {
  const prefix = refPrefix(userId);
  return pathname.startsWith(prefix) && REF_NAME.test(pathname.slice(prefix.length));
}

/**
 * Upload public under the exact key, overwriting what an earlier attempt left, with a one-year cache. Keys are
 * immutable, so a repeat writes the same bytes. The token is passed, not left to the SDK's OIDC lookup, so the store
 * written is the store objectUrls points at, and an answer at another URL fails the upload instead of recording a key
 * nobody can play.
 *
 * The body is cut into 8 MB parts as it is read, and at most PARTS_IN_FLIGHT parts upload at once, so a copy holds about
 * 104 MB whatever the size: 4 parts at 24 MB in flight plus the part being filled. Overlapping part requests briefly
 * reach about 165 MB, and copies V8 has not collected yet put the measured peak at 117-256 MB for 300 MB and 600 MB
 * results (README, 완료 영상 보관). Handing the stream itself to put(), in one request
 * or with multipart: true, holds all of it: the SDK's fetch clones each request for redirects, which tees the body,
 * and the branch nobody reads keeps every chunk until the request ends. A body that fits in one part is one put().
 */
export async function putVideo(
  key: ObjectKey,
  body: ReadableStream<Uint8Array>,
  opts: { contentType: string; abortSignal?: AbortSignal },
): Promise<void> {
  const c = config();
  if (!c) throw new Error("Vercel Blob is not configured");
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  opts.abortSignal?.addEventListener("abort", onAbort);
  const options = {
    access: "public",
    token: c.token,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: ONE_YEAR_S,
    contentType: opts.contentType,
    abortSignal: stop.signal,
  } as const;
  const parts = inParts(body, PART_BYTES);
  try {
    const first = await parts.next();
    const second = first.done ? first : await parts.next();
    const url = second.done
      ? (await put(key, first.done ? Buffer.alloc(0) : first.value, options)).url
      : await uploadInParts(key, options, [first.value as Buffer, second.value], parts, stop);
    const derived = publicUrl(c, key);
    if (new URL(url).href !== new URL(derived).href) {
      throw new Error(`blob URL mismatch: the store answered ${url}, objectUrls derives ${derived}`);
    }
  } catch (e) {
    stop.abort();
    throw e;
  } finally {
    opts.abortSignal?.removeEventListener("abort", onAbort);
    await parts.return(undefined);
  }
}

/** Multipart through the SDK, in part order, never more than PARTS_IN_FLIGHT at once. A failed part stops the rest. */
async function uploadInParts(
  key: ObjectKey,
  options: Parameters<typeof createMultipartUploader>[1],
  read: Buffer[],
  rest: AsyncGenerator<Buffer>,
  stop: AbortController,
): Promise<string> {
  const upload = await createMultipartUploader(key, options);
  const sent: Part[] = [];
  const running = new Set<Promise<void>>();
  let failure: unknown = null;
  let partNumber = 0;
  const send = (body: Buffer) => {
    const task: Promise<void> = upload
      .uploadPart(++partNumber, body)
      .then(
        (part) => void sent.push(part),
        (e: unknown) => {
          failure ??= e;
          stop.abort();
        },
      )
      .finally(() => running.delete(task));
    running.add(task);
  };
  try {
    for (const body of read) send(body);
    for await (const body of rest) {
      while (running.size >= PARTS_IN_FLIGHT && failure === null) await Promise.race(running);
      if (failure !== null) break;
      send(body);
    }
  } catch (e) {
    failure ??= e;
    stop.abort();
  }
  await Promise.all(running);
  if (failure !== null) throw failure;
  return (await upload.complete(sent.sort((a, b) => a.partNumber - b.partNumber))).url;
}

/** Fixed-size parts from a byte stream, the last one shorter. Stopping early cancels the stream. */
async function* inParts(body: ReadableStream<Uint8Array>, size: number): AsyncGenerator<Buffer> {
  const reader = body.getReader();
  let part = Buffer.allocUnsafe(size);
  let filled = 0;
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let at = 0; at < value.byteLength; ) {
        const n = Math.min(size - filled, value.byteLength - at);
        part.set(value.subarray(at, at + n), filled);
        filled += n;
        at += n;
        if (filled === size) {
          yield part;
          part = Buffer.allocUnsafe(size);
          filled = 0;
        }
      }
    }
    finished = true;
    if (filled > 0) yield part.subarray(0, filled);
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
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

const IMAGE_PREFIX = "images/";
const IMAGE_EXT: Record<ImageFormat, string> = { png: "png", jpeg: "jpg", webp: "webp" };

/** images/<generation id>.<ext>, from the row alone, so a finalizer can look for what a dead runner stored. */
export function imageKey(generationId: string, format: ImageFormat): ObjectKey {
  return `${IMAGE_PREFIX}${generationId}.${IMAGE_EXT[format]}` as ObjectKey;
}

/** The format an image key was written as, or null for any other key. */
export function imageFormatOf(key: ObjectKey): ImageFormat | null {
  if (!key.startsWith(IMAGE_PREFIX)) return null;
  const ext = key.slice(key.lastIndexOf(".") + 1);
  return (Object.keys(IMAGE_EXT) as ImageFormat[]).find((f) => IMAGE_EXT[f] === ext) ?? null;
}

/**
 * One public put under the exact key, overwriting an earlier attempt's (identical) bytes, with a one-year cache. As
 * with putVideo, an answer at another URL than objectUrls derives fails instead of recording a key nobody can show.
 */
export async function putImage(key: ObjectKey, bytes: Uint8Array, format: ImageFormat, opts: { abortSignal: AbortSignal }): Promise<void> {
  const c = config();
  if (!c) throw new Error("Vercel Blob is not configured");
  const { url } = await put(key, Buffer.from(bytes), {
    access: "public",
    token: c.token,
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: ONE_YEAR_S,
    contentType: `image/${format}`,
    abortSignal: opts.abortSignal,
  });
  const derived = publicUrl(c, key);
  if (new URL(url).href !== new URL(derived).href) {
    throw new Error(`blob URL mismatch: the store answered ${url}, objectUrls derives ${derived}`);
  }
}

/** The size of what is stored at `key`, or null when nothing is (or storage is off). Throws when the store does not answer. */
export async function storedSize(key: ObjectKey): Promise<number | null> {
  const c = config();
  if (!c) return null;
  try {
    return (await head(publicUrl(c, key), { token: c.token })).size;
  } catch (e) {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  }
}

/**
 * Public URL, plus Blob's ?download=1 one, which the CDN serves as an attachment named after the key's last segment
 * (<generation id>.mp4 or .png). Both come from the key alone, with no network call. Null while storage is off.
 */
export function objectUrls(key: ObjectKey): { url: string; downloadUrl: string } | null {
  const c = config();
  if (!c) return null;
  const url = publicUrl(c, key);
  return { url, downloadUrl: getDownloadUrl(url) };
}

/**
 * Delete the row owner's reference uploads, and return the URLs it deleted. imageRefs and videoRefs hold whatever URLs
 * the browser sent, so only the pathname a URL parses to in this store counts, it must pass isRefPathname for the
 * owner, and del() gets the public URL rebuilt from that pathname, never the URL as sent.
 */
export async function deleteRefs(urls: string[], ownerId: number): Promise<string[]> {
  const c = config();
  if (!c) return [];
  const keys = urls.map((u) => keyIn(c, u)).filter((k): k is string => k !== null && isRefPathname(k, ownerId));
  const doomed = [...new Set(keys)].map((k) => publicUrl(c, k));
  if (doomed.length > 0) await del(doomed, { token: c.token });
  return doomed;
}

/** A random file name newAvatarKey generates. Nothing else under avatars/<id>/ is ever deleted. */
const AVATAR_NAME = /^[0-9a-f]{32}\.(?:webp|jpg|png)$/;

function avatarPrefix(userId: number): string {
  return `avatars/${userId}/`;
}

/** A new key for every upload, so a photo URL never changes content and caches for a year. */
export function newAvatarKey(userId: number, ext: AvatarType["ext"]): ObjectKey {
  return `${avatarPrefix(userId)}${randomUUID().replaceAll("-", "")}.${ext}` as ObjectKey;
}

export async function putAvatar(key: ObjectKey, bytes: Uint8Array, contentType: AvatarType["contentType"]): Promise<void> {
  const c = config();
  if (!c) throw new Error("Vercel Blob is not configured");
  const { url } = await put(key, Buffer.from(bytes), {
    access: "public",
    token: c.token,
    addRandomSuffix: false,
    cacheControlMaxAge: ONE_YEAR_S,
    contentType,
  });
  const derived = publicUrl(c, key);
  if (new URL(url).href !== new URL(derived).href) {
    throw new Error(`blob URL mismatch: the store answered ${url}, avatarUrl derives ${derived}`);
  }
}

/** Null while storage is off. */
export function avatarUrl(key: ObjectKey): string | null {
  const c = config();
  return c ? publicUrl(c, key) : null;
}

/**
 * Delete one of the member's own photos and say whether del() was called. Only a key that is an AVATAR_NAME directly
 * under the member's avatars/<id>/ gets through, and del() gets the public URL built from it, so no spelling of a key
 * (another member, videos/, refs/, dot segments, percent escapes, a URL) reaches anything else in the store.
 */
export async function deleteAvatar(key: string, userId: number): Promise<boolean> {
  const c = config();
  const prefix = avatarPrefix(userId);
  if (!c || !key.startsWith(prefix) || !AVATAR_NAME.test(key.slice(prefix.length))) return false;
  await del(publicUrl(c, key), { token: c.token });
  return true;
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
