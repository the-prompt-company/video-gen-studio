import { eq } from "drizzle-orm";
import { getDb, pgErrorCode, schema, UNIQUE_VIOLATION } from "@/db";
import { requireAdmin, errorResponse, HttpError } from "@/lib/auth";
import { DUPLICATE_TEAM_NAME, NO_SUCH_TEAM, parseTeamName, teamIdFromPath } from "@/lib/teams";

type Ctx = { params: Promise<{ id: string }> };

async function teamIdOf({ params }: Ctx) {
  const id = teamIdFromPath((await params).id);
  if (id === null) throw new HttpError(404, NO_SUCH_TEAM);
  return id;
}

/** PATCH /api/admin/teams/:id — { name } renames the team. */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await requireAdmin();
    const id = await teamIdOf(ctx);
    const b = (await req.json().catch(() => null)) as { name?: unknown } | null;
    const parsed = parseTeamName(b?.name);
    if (!parsed.ok) throw new HttpError(400, parsed.reason);
    const t = schema.teams;
    const [row] = await getDb()
      .update(t)
      .set({ name: parsed.name })
      .where(eq(t.id, id))
      .returning({ id: t.id, name: t.name })
      .catch((e: unknown) => {
        throw pgErrorCode(e) === UNIQUE_VIOLATION ? new HttpError(409, DUPLICATE_TEAM_NAME) : e;
      });
    if (!row) throw new HttpError(404, NO_SUCH_TEAM);
    return Response.json(row);
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/admin/teams/:id — its members become 미소속 and keep their videos. Answers how many were released. */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    await requireAdmin();
    const id = await teamIdOf(ctx);
    const released = await getDb().transaction(async (tx) => {
      const members = await tx.update(schema.users).set({ teamId: null }).where(eq(schema.users.teamId, id)).returning({ id: schema.users.id });
      const [row] = await tx.delete(schema.teams).where(eq(schema.teams.id, id)).returning({ id: schema.teams.id });
      if (!row) throw new HttpError(404, NO_SUCH_TEAM);
      return members.length;
    });
    return Response.json({ id, released });
  } catch (e) {
    return errorResponse(e);
  }
}
