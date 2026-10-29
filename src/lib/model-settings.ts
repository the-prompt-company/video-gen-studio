import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { FAMILIES, FAMILY_IDS, type FamilyId } from "@/lib/catalog";

/**
 * The admin's settings per model, the only code that reads or writes `models`. Rows are keyed by FamilyId; a missing
 * row reads as rate 0 (미정) and enabled. Rows left by earlier catalogs, keyed by endpoint ids, are never read.
 */
export type ModelSetting = { family: FamilyId; rateUsd: number; enabled: boolean; note: string | null };

export async function loadModelSettings(): Promise<Record<FamilyId, ModelSetting>> {
  const rows = await getDb().select().from(schema.models).where(inArray(schema.models.modelId, [...FAMILY_IDS]));
  const byId = new Map(rows.map((r) => [r.modelId, r]));
  return Object.fromEntries(
    FAMILY_IDS.map((family) => {
      const r = byId.get(family);
      return [family, { family, rateUsd: r ? Number(r.pricePerSecUsd) : 0, enabled: r ? r.enabled : true, note: r?.note ?? null }];
    }),
  ) as Record<FamilyId, ModelSetting>;
}

export async function loadModelSetting(family: FamilyId): Promise<ModelSetting> {
  const [r] = await getDb().select().from(schema.models).where(eq(schema.models.modelId, family)).limit(1);
  return { family, rateUsd: r ? Number(r.pricePerSecUsd) : 0, enabled: r ? r.enabled : true, note: r?.note ?? null };
}

/** Upserts one model's settings. A rate outside 0..100 USD throws RangeError. */
export async function saveModelSetting(family: FamilyId, patch: { rateUsd?: number; enabled?: boolean; note?: string | null }): Promise<void> {
  const set: Partial<typeof schema.models.$inferInsert> = {};
  if (patch.rateUsd !== undefined) {
    if (!Number.isFinite(patch.rateUsd) || patch.rateUsd < 0 || patch.rateUsd > 100) throw new RangeError("단가는 0~100 USD");
    set.pricePerSecUsd = patch.rateUsd.toFixed(4);
  }
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.note !== undefined) set.note = patch.note;
  await getDb()
    .insert(schema.models)
    .values({ modelId: family, name: FAMILIES[family].name, ...set })
    .onConflictDoUpdate({ target: schema.models.modelId, set });
}
