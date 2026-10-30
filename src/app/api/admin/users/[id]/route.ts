import { eq } from "drizzle-orm";
import { FOREIGN_KEY_VIOLATION, getDb, pgErrorCode, schema } from "@/db";
import { requireAdmin, errorResponse, HttpError, setSessionCookie } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/credentials";
import { hashPassword, encrypt, decrypt, maskApiKey } from "@/lib/crypto";
import { parseNickname } from "@/lib/nickname";
import { parseTeamId } from "@/lib/teams";

type Ctx = { params: Promise<{ id: string }> };
type Body = {
  nickname?: string | null;
  password?: string;
  role?: "user" | "admin";
  teamId?: unknown;
  active?: boolean;
  apiKey?: string | null;
  note?: string | null;
  unlock?: boolean;
};

/** GET /api/admin/users/:id — details incl. masked key. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireAdmin();
    const id = Number((await params).id);
    const db = getDb();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
    if (!u) throw new HttpError(404, "noSuchUser");
    return Response.json({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      role: u.role,
      teamId: u.teamId,
      active: u.active,
      note: u.note,
      apiKeyMasked: u.apiKeyEnc ? maskApiKey(decrypt(u.apiKeyEnc)) : null,
      lockedUntil: u.lockedUntil,
      failedAttempts: u.failedAttempts,
      mustChangePassword: u.mustChangePassword,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PATCH /api/admin/users/:id — nickname / role / team / active / api key / password / note / unlock. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const admin = await requireAdmin();
    const id = Number((await params).id);
    const b = (await req.json().catch(() => ({}))) as Body;
    const patch: Partial<typeof schema.users.$inferInsert> = {};

    if (b.nickname !== undefined) {
      const raw = b.nickname === null ? "" : String(b.nickname);
      if (raw.trim() === "") patch.nickname = null;
      else {
        const parsed = parseNickname(raw);
        if (!parsed.ok) throw HttpError.of(400, parsed.reason);
        patch.nickname = parsed.nickname;
      }
    }

    if (b.role !== undefined) {
      if (b.role !== "user" && b.role !== "admin") throw new HttpError(400, "badRole");
      if (id === admin.id && b.role !== "admin") throw new HttpError(400, "ownAdminRole");
      patch.role = b.role;
    }
    if (b.teamId !== undefined) {
      const team = parseTeamId(b.teamId);
      if (!team.ok) throw HttpError.of(400, team.reason);
      patch.teamId = team.teamId;
    }
    if (b.active !== undefined) {
      if (id === admin.id && !b.active) throw new HttpError(400, "deactivateSelf");
      patch.active = Boolean(b.active);
    }
    if (b.apiKey !== undefined) {
      const k = b.apiKey === null ? "" : String(b.apiKey).trim();
      if (k && !k.includes(":")) throw new HttpError(400, "badApiKey");
      patch.apiKeyEnc = k ? encrypt(k) : null;
    }
    if (b.password !== undefined) {
      if (String(b.password).length < MIN_PASSWORD_LENGTH) throw new HttpError(400, "passwordMinLength", { min: MIN_PASSWORD_LENGTH });
      patch.passwordHash = hashPassword(String(b.password));
      patch.passwordChangedAt = new Date();
      if (id !== admin.id) patch.mustChangePassword = true;
    }
    if (b.note !== undefined) patch.note = b.note ? String(b.note) : null;
    if (b.unlock) {
      patch.failedAttempts = 0;
      patch.lockedUntil = null;
    }
    if (Object.keys(patch).length === 0) throw new HttpError(400, "nothingToChange");

    const db = getDb();
    const [row] = await db
      .update(schema.users)
      .set(patch)
      .where(eq(schema.users.id, id))
      .returning({ id: schema.users.id })
      .catch((e: unknown) => {
        throw pgErrorCode(e) === FOREIGN_KEY_VIOLATION ? new HttpError(400, "noSuchTeam") : e;
      });
    if (!row) throw new HttpError(404, "noSuchUser");
    const revokedOwnSession = id === admin.id && patch.passwordChangedAt !== undefined;
    if (revokedOwnSession) await setSessionCookie(admin);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
