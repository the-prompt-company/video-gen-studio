import { getDb, schema } from "@/db";
import { requireAdmin, errorResponse, HttpError } from "@/lib/auth";
import { listTeams } from "@/lib/team-store";
import { parseTeamName } from "@/lib/teams";

/** GET /api/admin/teams — every team by name, each with its members. */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ items: await listTeams() });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/admin/teams — { name } → the new team. 409 when a team already has that name in any case. */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const b = (await req.json().catch(() => null)) as { name?: unknown } | null;
    const parsed = parseTeamName(b?.name);
    if (!parsed.ok) throw HttpError.of(400, parsed.reason);
    const [row] = await getDb()
      .insert(schema.teams)
      .values({ name: parsed.name })
      .onConflictDoNothing()
      .returning({ id: schema.teams.id, name: schema.teams.name });
    if (!row) throw new HttpError(409, "duplicateTeamName");
    return Response.json(row, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
