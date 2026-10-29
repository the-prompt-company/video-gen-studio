import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireAdmin, errorResponse } from "@/lib/auth";
import { endpointsOf, isFamilyId } from "@/lib/catalog";
import { publicGeneration } from "@/lib/generations";

/**
 * GET /api/admin/generations?userId=&modelId=&status=&before=&limit=&format=csv
 * modelId is a model (all its endpoints) or one stored endpoint id.
 * Every user's history, newest first, keyset-paginated by createdAt.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const q = url.searchParams;
    const limit = Math.min(500, Math.max(1, Number(q.get("limit") ?? 50)));
    const g = schema.generations;
    const u = schema.users;

    const where = [];
    if (q.get("userId")) where.push(eq(g.userId, Number(q.get("userId"))));
    const model = q.get("modelId");
    if (model) where.push(isFamilyId(model) ? inArray(g.modelId, endpointsOf(model)) : eq(g.modelId, model));
    if (q.get("status")) where.push(eq(g.status, q.get("status") as schema.Generation["status"]));
    if (q.get("before")) where.push(lt(g.createdAt, new Date(String(q.get("before")))));

    const db = getDb();
    const rows = await db
      .select({ g, username: u.username })
      .from(g)
      .innerJoin(u, eq(u.id, g.userId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(g.createdAt))
      .limit(limit);

    const items = rows.map((r) => publicGeneration(r.g, r.username));

    if (q.get("format") === "csv") {
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const head = ["created_at", "username", "model", "status", "duration_s", "cost_usd", "prompt", "params", "result_url", "error"];
      const lines = items.map((i) =>
        [i.createdAt.toISOString(), i.username, i.modelId, i.status, i.durationS, i.costUsd, i.prompt, JSON.stringify(i.params), (i.video ?? i.image)?.url, i.error]
          .map(esc)
          .join(","),
      );
      return new Response([head.join(","), ...lines].join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="history-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(g)
      .where(where.length ? and(...where) : undefined);

    return Response.json({ items, total });
  } catch (e) {
    return errorResponse(e);
  }
}
