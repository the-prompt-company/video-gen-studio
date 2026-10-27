import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser, errorResponse, HttpError } from "@/lib/auth";
import { apiKeyFor, publicGeneration, syncStatus } from "@/lib/generations";
import * as hf from "@/lib/higgsfield";

type Ctx = { params: Promise<{ id: string }> };

async function ownRow(id: string, userId: number, role: string) {
  const db = getDb();
  const where = role === "admin"
    ? eq(schema.generations.id, id)
    : and(eq(schema.generations.id, id), eq(schema.generations.userId, userId));
  const [row] = await db.select().from(schema.generations).where(where).limit(1);
  if (!row) throw new HttpError(404, "없는 생성 건입니다");
  return row;
}

/** GET /api/generations/:id — returns the row, polling Higgsfield once if still running. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    let row = await ownRow(id, user.id, user.role);
    const live = row.status === "queued" || row.status === "in_progress";
    if (row.userId === user.id && live && row.requestId) {
      row = await syncStatus(row, apiKeyFor(user));
    }
    return Response.json({ item: publicGeneration(row) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/generations/:id — cancel while queued. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const row = await ownRow(id, user.id, user.role);
    if (row.userId !== user.id) throw new HttpError(403, "본인 생성 건만 취소할 수 있습니다");
    if (row.status !== "queued" || !row.requestId) throw new HttpError(409, "대기 중인 건만 취소할 수 있습니다");
    await hf.cancel(apiKeyFor(user), row.requestId);
    const db = getDb();
    const [updated] = await db
      .update(schema.generations)
      .set({ status: "canceled", completedAt: new Date(), costUsd: "0" })
      .where(eq(schema.generations.id, row.id))
      .returning();
    return Response.json({ item: publicGeneration(updated) });
  } catch (e) {
    if (e instanceof hf.HiggsfieldError) return Response.json({ error: e.message }, { status: 409 });
    return errorResponse(e);
  }
}
