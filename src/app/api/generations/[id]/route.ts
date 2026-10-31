import { after } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser, errorResponse, HttpError } from "@/lib/auth";
import { appError } from "@/lib/errors";
import { cancelGeneration, isGenerationId, publicGeneration, settle } from "@/lib/generations";
import { cancelRow, readRow, viewerOf } from "@/lib/scope";

/** The copy a settle schedules with `after` runs inside this budget. MIRROR_LEASE_S in generations.ts outlasts it. */
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

async function rowById(id: string) {
  if (!isGenerationId(id)) return null;
  const [row] = await getDb().select().from(schema.generations).where(eq(schema.generations.id, id)).limit(1);
  return row ?? null;
}

/**
 * GET /api/generations/:id — the owner or an admin gets the row after settling it, a current teammate gets a finished
 * row as stored, and anyone else gets 404.
 */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const [row, viewer] = await Promise.all([rowById(id), viewerOf(user)]);
    const read = readRow(viewer, row);
    if (read.kind === "refuse") throw new HttpError(read.status, read.code);
    return Response.json({ item: publicGeneration(read.kind === "settle" ? await settle(read.row, after) : read.row) });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * DELETE /api/generations/:id — only the owner cancels, while pending or queued. 403 for a row the caller can see but
 * does not own, 404 for one they cannot see. 409 while a submit is in flight or a resend could not learn whether
 * Higgsfield holds the job, 403 while Higgsfield may hold it and the owner has no key to ask with, and 409 with the
 * current row when Higgsfield already started it.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const [row, viewer] = await Promise.all([rowById(id), viewerOf(user)]);
    const cancel = cancelRow(viewer, row);
    if (cancel.kind === "refuse") throw new HttpError(cancel.status, cancel.code);
    const current = await cancelGeneration(cancel.row, after);
    if (current.status === "canceled") return Response.json({ item: publicGeneration(current) });
    return Response.json({ item: publicGeneration(current), error: appError("alreadyStarted") }, { status: 409 });
  } catch (e) {
    return errorResponse(e);
  }
}
