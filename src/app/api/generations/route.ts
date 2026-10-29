import { after } from "next/server";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { User } from "@/db/schema";
import { requireUser, errorResponse, HttpError } from "@/lib/auth";
import { FAMILIES, isFamilyId, MODES, planGeneration, type Draft, type Mode } from "@/lib/catalog";
import { isGenerationId, publicGeneration, settle, submitGeneration } from "@/lib/generations";
import { loadModelSetting } from "@/lib/model-settings";

/** The copy a settle schedules with `after` runs inside this budget. MIRROR_LEASE_S in generations.ts outlasts it. */
export const maxDuration = 300;

const MAX_IDS = 24;
const MAX_REFS = 9;

/**
 * The database's clock in epoch ms. It wrote created_at, so the playground times live rows by it, not by the member's
 * computer clock.
 */
const dbNowMs = sql<number>`extract(epoch from now()) * 1000`.mapWith(Number);

/** Settle the listed rows the caller may see. The client poll sends every live id in one request per tick. */
async function pollRows(user: User, raw: string) {
  const ids = raw.split(",").filter((s) => s !== "");
  if (ids.length > MAX_IDS) throw new HttpError(400, `ids는 최대 ${MAX_IDS}개입니다`);
  const valid = ids.filter(isGenerationId);
  if (valid.length === 0) return { rows: [] };
  const g = schema.generations;
  const found = await getDb()
    .select({ row: g, now: dbNowMs })
    .from(g)
    .where(user.role === "admin" ? inArray(g.id, valid) : and(inArray(g.id, valid), eq(g.userId, user.id)));
  return { rows: await Promise.all(found.map(({ row }) => settle(row, after))), now: found[0]?.now };
}

/**
 * GET /api/generations?ids=<id>,<id> — settle and return those rows (max 24).
 * GET /api/generations?before=<iso>&limit=24&status=completed — the caller's own rows.
 * Both answer { items, now }: `now` is the database's clock when the rows were read, absent when none matched.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const url = new URL(req.url);
    const ids = url.searchParams.get("ids");
    if (ids !== null) {
      const { rows, now } = await pollRows(user, ids);
      return Response.json({ items: rows.map((g) => publicGeneration(g)), now });
    }
    const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit") ?? 24)));
    const before = url.searchParams.get("before");
    const status = url.searchParams.get("status");

    const db = getDb();
    const where = [eq(schema.generations.userId, user.id)];
    if (before) where.push(lt(schema.generations.createdAt, new Date(before)));
    if (status) where.push(eq(schema.generations.status, status as schema.Generation["status"]));

    const rows = await db
      .select({ row: schema.generations, now: dbNowMs })
      .from(schema.generations)
      .where(and(...where))
      .orderBy(desc(schema.generations.createdAt))
      .limit(limit);

    return Response.json({ items: rows.map(({ row }) => publicGeneration(row)), now: rows[0]?.now });
  } catch (e) {
    return errorResponse(e);
  }
}

function publicUrl(v: unknown, label: string): string {
  const u = String(v ?? "");
  if (!/^https?:\/\//.test(u)) throw new HttpError(400, `${label}: 공개 URL만 허용됩니다`);
  return u;
}

function list(v: unknown, label: string): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new HttpError(400, `${label}: 배열이어야 합니다`);
  if (v.length > MAX_REFS) throw new HttpError(400, `${label}: 최대 ${MAX_REFS}개`);
  return v;
}

function parseDraft(raw: unknown): Draft {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const family = String(b.family ?? "");
  if (!isFamilyId(family)) throw new HttpError(400, "알 수 없는 모델입니다. 페이지를 새로고침하세요");
  const mode = String(b.mode ?? "") as Mode;
  if (!MODES.includes(mode)) throw new HttpError(400, "생성 방식이 없습니다. 페이지를 새로고침하세요");
  return {
    family,
    mode,
    prompt: String(b.prompt ?? ""),
    params: b.params && typeof b.params === "object" ? (b.params as Record<string, unknown>) : {},
    images: list(b.images, "이미지").map((u) => publicUrl(u, "이미지")),
    videos: list(b.videos, "영상").map((v) => {
      const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
      return { url: publicUrl(o.url, "영상"), seconds: Number(o.seconds) };
    }),
    startFromImage: b.startFromImage === true,
  };
}

/**
 * POST /api/generations — submit one generation. The body is a Draft: { family, mode, prompt, params, images,
 * videos: [{ url, seconds }], startFromImage }. 201 when Higgsfield accepted it, 202 when it waits as 제출 대기 and
 * submits itself again, 502 when Higgsfield refused it, 400 when the plan is not ready. Every answer after insert
 * carries the row as `item`, and estimatedCostUsd is the row's cost, decided now.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const draft = parseDraft(await req.json().catch(() => ({})));
    const setting = await loadModelSetting(draft.family);
    if (!setting.enabled) throw new HttpError(400, `관리자가 ${FAMILIES[draft.family].name}을(를) 껐습니다`);
    const plan = planGeneration(draft, setting.rateUsd);
    if (!plan.ready) throw new HttpError(400, plan.blocker);

    const row = await submitGeneration(user, plan, after);
    const failed = row.status === "failed";
    return Response.json(
      { item: publicGeneration(row), error: failed ? row.error : undefined, estimatedCostUsd: Number(row.costUsd) },
      { status: failed ? 502 : row.status === "pending" ? 202 : 201 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
