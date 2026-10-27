import { and, desc, eq, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, schema } from "@/db";
import { requireUser, errorResponse, HttpError } from "@/lib/auth";
import { findModel, coerceParams, buildArguments } from "@/lib/catalog";
import * as hf from "@/lib/higgsfield";
import { apiKeyFor, priceFor, publicGeneration } from "@/lib/generations";

const MAX_IMAGES = 6;
const MAX_VIDEOS = 3;

/** GET /api/generations?before=<iso>&limit=24&status=completed — the caller's own rows. */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit") ?? 24)));
    const before = url.searchParams.get("before");
    const status = url.searchParams.get("status");

    const db = getDb();
    const where = [eq(schema.generations.userId, user.id)];
    if (before) where.push(lt(schema.generations.createdAt, new Date(before)));
    if (status) where.push(eq(schema.generations.status, status as schema.Generation["status"]));

    const rows = await db
      .select()
      .from(schema.generations)
      .where(and(...where))
      .orderBy(desc(schema.generations.createdAt))
      .limit(limit);

    return Response.json({ items: rows.map((g) => publicGeneration(g)) });
  } catch (e) {
    return errorResponse(e);
  }
}

type Body = {
  modelId?: string;
  prompt?: string;
  params?: Record<string, unknown>;
  imageUrls?: string[];
  videoUrls?: string[];
};

function urlList(v: unknown, max: number, label: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new HttpError(400, `${label}: 배열이어야 합니다`);
  const out = v.map(String).filter((s) => s.trim() !== "");
  if (out.length > max) throw new HttpError(400, `${label}: 최대 ${max}개`);
  for (const u of out) {
    if (!/^https?:\/\//.test(u)) throw new HttpError(400, `${label}: 공개 URL만 허용됩니다`);
  }
  return out;
}

/** POST /api/generations — submit one generation. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as Body;

    const spec = findModel(String(body.modelId ?? ""));
    if (!spec) throw new HttpError(400, "알 수 없는 모델입니다");

    const db = getDb();
    const [m] = await db.select().from(schema.models).where(eq(schema.models.modelId, spec.id)).limit(1);
    if (m && !m.enabled) throw new HttpError(400, "관리자가 비활성화한 모델입니다");

    const prompt = String(body.prompt ?? "");
    const imageUrls = urlList(body.imageUrls, Math.min(MAX_IMAGES, spec.images.max), "이미지");
    const videoUrls = urlList(body.videoUrls, spec.videos ? Math.min(MAX_VIDEOS, spec.videos.max) : 0, "영상");

    let params: Record<string, unknown>;
    let args: Record<string, unknown>;
    try {
      params = coerceParams(spec, body.params ?? {});
      args = buildArguments(spec, prompt, params, imageUrls, videoUrls);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }

    const apiKey = apiKeyFor(user);
    const durationS = Number(params[spec.durationKey] ?? 0);
    const idem = randomUUID();

    let submitted: hf.HfSubmitResponse;
    try {
      submitted = await hf.submit(apiKey, spec.id, args, idem);
    } catch (e) {
      if (e instanceof hf.HiggsfieldError) {
        const hint = e.status === 429 ? ` (큐가 가득 참, ${e.retryAfterS ?? 30}초 후 재시도)` : "";
        throw new HttpError(502, e.message + hint);
      }
      throw e;
    }

    const [row] = await db
      .insert(schema.generations)
      .values({
        userId: user.id,
        modelId: spec.id,
        prompt,
        params,
        imageRefs: imageUrls,
        videoRefs: videoUrls,
        status: "queued",
        requestId: submitted.request_id,
        durationS,
        costUsd: "0",
      })
      .returning();

    const price = await priceFor(spec.id);
    return Response.json({ item: publicGeneration(row), estimatedCostUsd: price * durationS }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
