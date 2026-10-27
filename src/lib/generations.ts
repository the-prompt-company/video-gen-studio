import { eq } from "drizzle-orm";
import { del } from "@vercel/blob";
import { getDb, schema } from "@/db";
import type { Generation, User } from "@/db/schema";
import { decrypt } from "@/lib/crypto";
import * as hf from "@/lib/higgsfield";
import { HttpError } from "@/lib/auth";

export const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"]);

export function apiKeyFor(user: User): string {
  if (!user.apiKeyEnc) throw new HttpError(403, "API 키가 아직 할당되지 않았습니다. 관리자에게 문의하세요");
  return decrypt(user.apiKeyEnc);
}

export async function priceFor(modelId: string): Promise<number> {
  const db = getDb();
  const [m] = await db.select().from(schema.models).where(eq(schema.models.modelId, modelId)).limit(1);
  return m ? Number(m.pricePerSecUsd) : 0;
}

function isBlobUrl(u: string): boolean {
  return /\.blob\.vercel-storage\.com\//.test(u);
}

/** Delete temporary reference uploads from Vercel Blob once the request is finished. */
async function cleanupRefs(gen: Generation) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  const urls = [...gen.imageRefs, ...gen.videoRefs].filter(isBlobUrl);
  if (urls.length === 0) return;
  try {
    await del(urls);
  } catch (e) {
    console.warn("blob cleanup failed", e);
  }
}

/**
 * Poll Higgsfield once for a non-terminal generation and persist what changed.
 * Called from the client's polling loop (no server-side cron on the Hobby plan).
 */
export async function syncStatus(gen: Generation, apiKey: string): Promise<Generation> {
  if (TERMINAL.has(gen.status) || !gen.requestId) return gen;
  const db = getDb();

  let s: hf.HfStatusResponse;
  try {
    s = await hf.status(apiKey, gen.requestId);
  } catch (e) {
    if (e instanceof hf.HiggsfieldError && e.status === 404) {
      const [row] = await db
        .update(schema.generations)
        .set({ status: "failed", error: "request not found", completedAt: new Date() })
        .where(eq(schema.generations.id, gen.id))
        .returning();
      return row;
    }
    throw e;
  }

  if (s.status === gen.status) return gen;

  const patch: Partial<Generation> = { status: s.status };
  if (TERMINAL.has(s.status)) {
    patch.completedAt = new Date();
    patch.error = s.error ?? null;
    if (s.expires_at) patch.expiresAt = new Date(s.expires_at);
    if (s.status === "completed") {
      patch.resultUrl = s.video?.url ?? s.images?.[0]?.url ?? null;
      // Failed / NSFW / canceled requests are not charged.
      const price = await priceFor(gen.modelId);
      patch.costUsd = (price * gen.durationS).toFixed(4);
    } else {
      patch.costUsd = "0";
    }
  }

  const [row] = await db
    .update(schema.generations)
    .set(patch)
    .where(eq(schema.generations.id, gen.id))
    .returning();

  if (TERMINAL.has(row.status)) await cleanupRefs(row);
  return row;
}

/** Shape sent to the browser (never the request id or anything secret). */
export function publicGeneration(g: Generation, username?: string) {
  return {
    id: g.id,
    username,
    modelId: g.modelId,
    prompt: g.prompt,
    params: g.params,
    imageRefs: g.imageRefs,
    videoRefs: g.videoRefs,
    status: g.status,
    resultUrl: g.blobUrl ?? g.resultUrl,
    expiresAt: g.expiresAt,
    durationS: g.durationS,
    costUsd: Number(g.costUsd),
    error: g.error,
    createdAt: g.createdAt,
    completedAt: g.completedAt,
  };
}

export type PublicGeneration = ReturnType<typeof publicGeneration>;
