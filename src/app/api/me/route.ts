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
    if (typed !== null && typeof typed !== "string") throw new HttpError(400, "닉네임을 글자로 보내세요. 지우려면 빈 값을 보내세요");
    const parsed = parseNickname(typed ?? "");
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    await getDb().update(schema.users).set({ nickname: parsed.nickname }).where(eq(schema.users.id, u.id));
    return Response.json({ nickname: parsed.nickname });
  } catch (e) {
    return errorResponse(e);
  }
}
