import { getDb, schema } from "@/db";
import { requireAdmin, errorResponse, HttpError } from "@/lib/auth";
import { loginId, MIN_PASSWORD_LENGTH } from "@/lib/credentials";
import { hashPassword, encrypt } from "@/lib/crypto";
import { usageByUser } from "@/lib/stats";

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
      throw new HttpError(400, "ID는 영문/숫자/._@+- 2~80자 (이메일 가능)");
    if (password.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상`);
    const apiKey = String(b.apiKey ?? "").trim();
    if (apiKey && !apiKey.includes(":")) throw new HttpError(400, "API 키는 key-id:key-secret 형식");

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
    if (!row) throw new HttpError(409, "이미 있는 ID입니다");
    return Response.json({ id: row.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
