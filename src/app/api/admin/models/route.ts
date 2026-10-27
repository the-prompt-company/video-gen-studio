import { getDb, schema } from "@/db";
import { requireAdmin, errorResponse, HttpError } from "@/lib/auth";
import { CATALOG } from "@/lib/catalog";

/** GET /api/admin/models — catalog merged with stored price/enabled. */
export async function GET() {
  try {
    await requireAdmin();
    const db = getDb();
    const rows = await db.select().from(schema.models);
    const byId = new Map(rows.map((r) => [r.modelId, r]));
    const items = CATALOG.map((m) => {
      const r = byId.get(m.id);
      return {
        modelId: m.id,
        name: m.name,
        vendor: m.vendor,
        pricePerSecUsd: r ? Number(r.pricePerSecUsd) : 0,
        enabled: r ? r.enabled : true,
        note: r?.note ?? null,
      };
    });
    return Response.json({ items });
  } catch (e) {
    return errorResponse(e);
  }
}

type Body = { modelId?: string; pricePerSecUsd?: number | string; enabled?: boolean; note?: string | null };

/** PATCH /api/admin/models — upsert price / enabled / note for one model. */
export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const b = (await req.json().catch(() => ({}))) as Body;
    const spec = CATALOG.find((m) => m.id === b.modelId);
    if (!spec) throw new HttpError(400, "알 수 없는 모델");

    const set: Partial<typeof schema.models.$inferInsert> = {};
    if (b.pricePerSecUsd !== undefined) {
      const p = Number(b.pricePerSecUsd);
      if (!Number.isFinite(p) || p < 0 || p > 100) throw new HttpError(400, "초당 단가는 0~100 USD");
      set.pricePerSecUsd = p.toFixed(4);
    }
    if (b.enabled !== undefined) set.enabled = Boolean(b.enabled);
    if (b.note !== undefined) set.note = b.note ? String(b.note) : null;

    const db = getDb();
    await db
      .insert(schema.models)
      .values({ modelId: spec.id, name: spec.name, ...set })
      .onConflictDoUpdate({ target: schema.models.modelId, set });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
