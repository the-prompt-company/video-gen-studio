import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { verifyPassword } from "@/lib/crypto";
import { setSessionCookie } from "@/lib/auth";

const MAX_FAILURES = 10;
const LOCK_MINUTES = 15;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!username || !password) return Response.json({ error: "ID와 비밀번호를 입력하세요" }, { status: 400 });

  const db = getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
  const generic = Response.json({ error: "ID 또는 비밀번호가 맞지 않습니다" }, { status: 401 });
  if (!u) return generic;

  if (u.lockedUntil && u.lockedUntil.getTime() > Date.now()) {
    return Response.json(
      { error: `실패가 누적되어 잠겼습니다. ${LOCK_MINUTES}분 후 다시 시도하세요` },
      { status: 423 },
    );
  }
  if (!u.active) return Response.json({ error: "비활성화된 계정입니다" }, { status: 403 });

  if (!verifyPassword(password, u.passwordHash)) {
    const failures = u.failedAttempts + 1;
    await db
      .update(schema.users)
      .set({
        failedAttempts: failures,
        lockedUntil: failures >= MAX_FAILURES ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      })
      .where(eq(schema.users.id, u.id));
    return generic;
  }

  await db
    .update(schema.users)
    .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(schema.users.id, u.id));
  await setSessionCookie({ id: u.id, username: u.username, role: u.role });
  return Response.json({ ok: true, role: u.role });
}
