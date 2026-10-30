import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { User } from "@/db/schema";
import { requireUser, errorResponse, HttpError } from "@/lib/auth";
import { appError } from "@/lib/errors";
import { cancelGeneration, isGenerationId, publicGeneration, settle } from "@/lib/generations";

/** The copy a settle schedules with `after` runs inside this budget. MIRROR_LEASE_S in generations.ts outlasts it. */
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

async function ownRow(id: string, user: User) {
  if (!isGenerationId(id)) throw new HttpError(404, "noSuchGeneration");
  const db = getDb();
  const where = user.role === "admin"
    ? eq(schema.generations.id, id)
    : and(eq(schema.generations.id, id), eq(schema.generations.userId, user.id));
  const [row] = await db.select().from(schema.generations).where(where).limit(1);
  if (!row) throw new HttpError(404, "noSuchGeneration");
  return row;
}

/** GET /api/generations/:id — returns the row after settling it. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    return Response.json({ item: publicGeneration(await settle(await ownRow(id, user), after)) });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * DELETE /api/generations/:id — cancel while pending or queued. 409 while a submit is in flight or a resend could not
 * learn whether Higgsfield holds the job, 403 while Higgsfield may hold it and the owner has no key to ask with, and
 * 409 with the current row when Higgsfield already started it.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const row = await ownRow(id, user);
    if (row.userId !== user.id) throw new HttpError(403, "notYourGeneration");
    const current = await cancelGeneration(row, after);
    if (current.status === "canceled") return Response.json({ item: publicGeneration(current) });
    return Response.json({ item: publicGeneration(current), error: appError("alreadyStarted") }, { status: 409 });
  } catch (e) {
    return errorResponse(e);
  }
}
