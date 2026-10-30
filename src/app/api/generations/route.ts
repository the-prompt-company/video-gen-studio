import { after } from "next/server";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { dbNowMs, getDb, schema } from "@/db";
import type { User } from "@/db/schema";
import { requireUser, errorResponse, HttpError } from "@/lib/auth";
import { FAMILIES, isFamilyId, MODES, planGeneration, type Draft, type Mode } from "@/lib/catalog";
import { isGenerationId, publicGeneration, settle, submitGeneration } from "@/lib/generations";
import { loadModelSetting } from "@/lib/model-settings";
import { claimThread, threadFeed } from "@/lib/thread-store";
import { EARLIER, parseThreadRef, type ThreadRef } from "@/lib/threads";

/** The copy a settle schedules with `after` runs inside this budget. MIRROR_LEASE_S in generations.ts outlasts it. */
export const maxDuration = 300;

const MAX_IDS = 24;
const MAX_REFS = 16;

/** A thread named in a request. One the member cannot see answers 404 like any other. */
function threadRefOf(raw: unknown): ThreadRef {
  const ref = parseThreadRef(raw);
  if (!ref) throw new HttpError(404, "noSuchThread");
  return ref;
}

/** Settle the listed rows the caller may see. The client poll sends every live id in one request per tick. */
async function pollRows(user: User, raw: string) {
  const ids = raw.split(",").filter((s) => s !== "");
  if (ids.length > MAX_IDS) throw new HttpError(400, "tooManyIds", { max: MAX_IDS });
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
 * GET /api/generations?thread=<id|earlier>&limit=12 — the newest rows of one of the caller's threads, 404 for a thread
 * the caller cannot see.
 * GET /api/generations?before=<iso>&limit=24&status=completed — the caller's own rows.
 * All answer { items, now }: `now` is the database's clock when the rows were read, absent when none matched.
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
    const thread = url.searchParams.get("thread");
    if (thread !== null) {
      const feed = await threadFeed(user.id, threadRefOf(thread), limit);
      if (!feed) throw new HttpError(404, "noSuchThread");
      return Response.json({ items: feed.rows.map((g) => publicGeneration(g)), now: feed.now });
    }
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

type RefKind = "image" | "video";

function publicUrl(v: unknown, kind: RefKind): string {
  const u = String(v ?? "");
  if (!/^https?:\/\//.test(u)) throw new HttpError(400, "refNotPublicUrl", { kind });
  return u;
}

function list(v: unknown, kind: RefKind): unknown[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new HttpError(400, "refsNotList", { kind });
  if (v.length > MAX_REFS) throw new HttpError(400, "tooManyRefs", { kind, max: MAX_REFS });
  return v;
}

function parseDraft(raw: unknown): Draft {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const family = String(b.family ?? "");
  if (!isFamilyId(family)) throw new HttpError(400, "unknownModel");
  const mode = String(b.mode ?? "") as Mode;
  if (!MODES.includes(mode)) throw new HttpError(400, "noMode");
  return {
    family,
    mode,
    prompt: String(b.prompt ?? ""),
    params: b.params && typeof b.params === "object" ? (b.params as Record<string, unknown>) : {},
    images: list(b.images, "image").map((u) => publicUrl(u, "image")),
    videos: list(b.videos, "video").map((v) => {
      const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
      return { url: publicUrl(o.url, "video"), seconds: Number(o.seconds) };
    }),
    startFromImage: b.startFromImage === true,
  };
}

/**
 * POST /api/generations — submit one generation. The body is a Draft: { family, mode, prompt, params, images,
 * videos: [{ url, seconds }], startFromImage } and `thread`, the id of the thread it goes into: an existing one, a new
 * uuid the browser chose (the first generation creates that thread), or `earlier`, which is also where a body with no
 * thread goes. 201 when Higgsfield accepted it, 202 when it waits as 제출 대기 and submits itself again, 502 when
 * Higgsfield refused it, 400 when the plan is not ready, 404 when the thread is not the caller's to add to. Every answer
 * after insert carries the row as `item` and its thread as `thread`; the row's own reason says why a refused one
 * failed, and estimatedCostUsd is the row's cost, decided now.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body: unknown = await req.json().catch(() => ({}));
    const draft = parseDraft(body);
    const ref = threadRefOf((body as { thread?: unknown } | null)?.thread ?? EARLIER);
    const setting = await loadModelSetting(draft.family);
    if (!setting.enabled) throw new HttpError(400, "modelDisabled", { model: FAMILIES[draft.family].name });
    const plan = planGeneration(draft, setting.rateUsd);
    if (!plan.ready) throw HttpError.of(400, plan.blocker);

    const { threadId, thread } = await claimThread(user.id, ref, plan.prompt);
    const row = await submitGeneration(user, plan, after, threadId);
    return Response.json(
      { item: publicGeneration(row), thread, estimatedCostUsd: Number(row.costUsd) },
      { status: row.status === "failed" ? 502 : row.status === "pending" ? 202 : 201 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
