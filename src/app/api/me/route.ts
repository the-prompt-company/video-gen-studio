import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { errorResponse, HttpError, requireUser } from "@/lib/auth";
import { parseNickname } from "@/lib/nickname";

/** PATCH /api/me — the signed-in member's own nickname. `null` or blank clears it. */
export async function PATCH(req: Request) {
  try {
    const u = await requireUser();
    const b = (await req.json().catch(() => null)) as { nickname?: unknown } | null;
    const typed = b?.nickname;
    if (typed !== null && typeof typed !== "string") throw new HttpError(400, "nicknameNotText");
    let nickname: string | null = null;
    if (typed?.trim()) {
      const parsed = parseNickname(typed);
      if (!parsed.ok) throw HttpError.of(400, parsed.reason);
      nickname = parsed.nickname;
    }
    await getDb().update(schema.users).set({ nickname }).where(eq(schema.users.id, u.id));
    return Response.json({ nickname });
  } catch (e) {
    return errorResponse(e);
  }
}
