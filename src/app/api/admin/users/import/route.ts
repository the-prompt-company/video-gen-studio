import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireAdmin, errorResponse, HttpError } from "@/lib/auth";
import { INITIAL_PASSWORD } from "@/lib/credentials";
import { hashPasswords } from "@/lib/crypto";
import { importUsername, parseImportRequest, planImport, settleImport, type ImportResponse } from "@/lib/member-import";

// 200 scrypt hashes take about 15 s on one vCPU.
export const maxDuration = 60;

/** POST /api/admin/users/import — { rows: [{ nickname, email }], dryRun } → one outcome per row, in order. */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const request = parseImportRequest(await req.json().catch(() => null));
    if (!request.ok) throw new HttpError(400, request.error);

    const db = getDb();
    const users = schema.users;
    const found = await db
      .select({ username: users.username })
      .from(users)
      .where(inArray(users.username, request.rows.map(importUsername)));
    const plan = planImport(request.rows, new Set(found.map((u) => u.username)));
    if (request.dryRun) return Response.json({ dryRun: true, results: plan } satisfies ImportResponse);

    const toCreate = plan.flatMap((row) => (row.outcome === "create" ? [row] : []));
    const hashes = await hashPasswords(INITIAL_PASSWORD, toCreate.length);
    const inserted = toCreate.length
      ? await db
          .insert(users)
          .values(toCreate.map((row, i) => ({ username: row.username, nickname: row.nickname, passwordHash: hashes[i], mustChangePassword: true, role: "user" as const })))
          .onConflictDoNothing()
          .returning({ username: users.username })
      : [];
    const results = settleImport(plan, new Set(inserted.map((u) => u.username)));
    return Response.json({ dryRun: false, results } satisfies ImportResponse);
  } catch (e) {
    return errorResponse(e);
  }
}
