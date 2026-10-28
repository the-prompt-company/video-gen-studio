/**
 * The only module that knows the bucket, the auth and the URL format of Supabase Storage.
 * Rows store an object key, never a URL, so moving the bucket is an env change plus an object copy.
 */
import { StorageClient } from "@supabase/storage-js";

export type ObjectKey = string & { readonly __brand: "ObjectKey" };

const ONE_YEAR_S = 365 * 24 * 3600;

type Config = { url: string; key: string; bucket: string };

function config(): Config | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key, bucket: process.env.SUPABASE_VIDEO_BUCKET || "videos" };
}

function bucket(c: Config) {
  return new StorageClient(`${c.url}/storage/v1`, { apikey: c.key, Authorization: `Bearer ${c.key}` }).from(c.bucket);
}

/** False without SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (local dev). Videos then keep playing from Higgsfield. */
export function storageEnabled(): boolean {
  return config() !== null;
}

export function videoKey(generationId: string): ObjectKey {
  return `${generationId}.mp4` as ObjectKey;
}

/** Upsert with a one-year Cache-Control. Keys are immutable, so a repeat writes the same bytes to the same object. */
export async function putVideo(key: ObjectKey, bytes: Uint8Array, contentType: string): Promise<void> {
  const c = config();
  if (!c) throw new Error("Supabase Storage is not configured");
  const { error } = await bucket(c).upload(key, bytes, { upsert: true, contentType, cacheControl: String(ONE_YEAR_S) });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
}

/** Public URL, plus one with ?download=<name> so the browser saves instead of navigating. Null while storage is off. */
export function videoUrls(key: ObjectKey, downloadName: string): { url: string; downloadUrl: string } | null {
  const c = config();
  if (!c) return null;
  const b = bucket(c);
  return {
    url: b.getPublicUrl(key).data.publicUrl,
    downloadUrl: b.getPublicUrl(key, { download: downloadName }).data.publicUrl,
  };
}
