import { after } from "next/server";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { User } from "@/db/schema";
import { requireUser, errorResponse, HttpError } from "@/lib/auth";
import { findModel, coerceParams } from "@/lib/catalog";
import { isGenerationId, priceFor, publicGeneration, settle, submitGeneration } from "@/lib/generations";

/** The copy a settle schedules with `after` runs inside this budget. MIRROR_LEASE_S in generations.ts outlasts it. */
export const maxDuration = 300;

const MAX_IMAGES = 6;
const MAX_VIDEOS = 3;
const MAX_IDS = 24;

/** Settle the listed rows the caller may see. The client poll sends every live id in one request per tick. */
async function pollRows(user: User, raw: string) {
  const ids = raw.split(",").filter((s) => s !== "");
  if (ids.length > MAX_IDS) throw new HttpError(400, `ids는 최대 ${MAX_IDS}개입니다`);
  const valid = ids.filter(isGenerationId);
  if (valid.length === 0) return [];
  const g = schema.generations;
  const rows = await getDb()
    .select()
    .from(g)
    .where(user.role === "admin" ? inArray(g.id, valid) : and(inArray(g.id, valid), eq(g.userId, user.id)));
  return Promise.all(rows.map((row) => settle(row, after)));
}

/**
 * GET /api/generations?ids=<id>,<id> — settle and return those rows (max 24).
 * GET /api/generations?before=<iso>&limit=24&status=completed — the caller's own rows.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const ids = url.searchParams.get("ids");
    if (ids !== null) return Response.json({ items: (await pollRows(user, ids)).map((g) => publicGeneration(g)) });
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

/**
 * POST /api/generations — submit one generation. 201 when Higgsfield accepted it, 202 when it waits as 제출 대기 and
 * submits itself again, 502 when Higgsfield refused it. Every answer carries the row as `item`.
 */
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
    try {
      params = coerceParams(spec, body.params ?? {});
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : String(e));
    }

    const row = await submitGeneration(user, { spec, prompt, params, imageUrls, videoUrls }, after);
    const price = await priceFor(spec.id);
    const failed = row.status === "failed";
    return Response.json(
      { item: publicGeneration(row), error: failed ? row.error : undefined, estimatedCostUsd: price * row.durationS },
      { status: failed ? 502 : row.status === "pending" ? 202 : 201 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
