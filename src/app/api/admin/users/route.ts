import { inArray } from "drizzle-orm";
import { FOREIGN_KEY_VIOLATION, getDb, pgErrorCode, schema } from "@/db";
import { requireAdmin, errorResponse, HttpError } from "@/lib/auth";
import { loginId, MIN_PASSWORD_LENGTH } from "@/lib/credentials";
import { hashPassword, encrypt } from "@/lib/crypto";
import { usageByUser } from "@/lib/stats";
import { parseTeamId, parseUserIds } from "@/lib/teams";

/** GET /api/admin/users — every user with usage totals. */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ items: await usageByUser() });
  } catch (e) {
    return errorResponse(e);
  }
}

type Body = { username?: string; password?: string; role?: string; apiKey?: string; note?: string };

/** POST /api/admin/users — create a user (optionally with an API key). */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const b = (await req.json().catch(() => ({}))) as Body;
    const username = loginId(String(b.username ?? ""));
    const password = String(b.password ?? "");
    if (!/^[a-zA-Z0-9._@+-]{2,80}$/.test(username))
      throw new HttpError(400, "badUsername");
    if (password.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, "passwordMinLength", { min: MIN_PASSWORD_LENGTH });
    const apiKey = String(b.apiKey ?? "").trim();
    if (apiKey && !apiKey.includes(":")) throw new HttpError(400, "badApiKey");

    const db = getDb();
    const [row] = await db
      .insert(schema.users)
      .values({
        username,
        passwordHash: hashPassword(password),
        mustChangePassword: true,
        role: b.role === "admin" ? "admin" : "user",
        apiKeyEnc: apiKey ? encrypt(apiKey) : null,
        note: b.note ? String(b.note) : null,
      })
      .onConflictDoNothing()
      .returning({ id: schema.users.id });
    if (!row) throw new HttpError(409, "duplicateUsername");
    return Response.json({ id: row.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PATCH /api/admin/users — { userIds, teamId } puts the selected users in one team, or 미소속 with `teamId: null`. */
export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const b = (await req.json().catch(() => null)) as { userIds?: unknown; teamId?: unknown } | null;
    const selected = parseUserIds(b?.userIds);
    if (!selected.ok) throw HttpError.of(400, selected.reason);
    const team = parseTeamId(b?.teamId);
    if (!team.ok) throw HttpError.of(400, team.reason);
    const users = schema.users;
    const updated = await getDb()
      .update(users)
      .set({ teamId: team.teamId })
      .where(inArray(users.id, selected.userIds))
      .returning({ id: users.id })
      .catch((e: unknown) => {
        throw pgErrorCode(e) === FOREIGN_KEY_VIOLATION ? new HttpError(400, "noSuchTeam") : e;
      });
    return Response.json({ updated: updated.length });
  } catch (e) {
    return errorResponse(e);
  }
}
