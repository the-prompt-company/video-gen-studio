import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { FAMILIES, FAMILY_IDS, type FamilyId } from "@/lib/catalog";

export type ModelSetting = { family: FamilyId; rateUsd: number; enabled: boolean; note: string | null };

/** The admin's rate when they saved one above 0, else the model's published default. A row the on/off toggle created holds 0. */
export function rateOf(family: FamilyId, saved: string | null | undefined): number {
  const usd = Number(saved);
  return usd > 0 ? usd : FAMILIES[family].rate.defaultUsd;
}

export async function loadModelSettings(): Promise<Record<FamilyId, ModelSetting>> {
  const rows = await getDb().select().from(schema.models).where(inArray(schema.models.modelId, [...FAMILY_IDS]));
  const byId = new Map(rows.map((r) => [r.modelId, r]));
  return Object.fromEntries(
    FAMILY_IDS.map((family) => {
      const r = byId.get(family);
      return [family, { family, rateUsd: rateOf(family, r?.pricePerSecUsd), enabled: r ? r.enabled : true, note: r?.note ?? null }];
    }),
  ) as Record<FamilyId, ModelSetting>;
}

export async function loadModelSetting(family: FamilyId): Promise<ModelSetting> {
  const [r] = await getDb().select().from(schema.models).where(eq(schema.models.modelId, family)).limit(1);
  return { family, rateUsd: rateOf(family, r?.pricePerSecUsd), enabled: r ? r.enabled : true, note: r?.note ?? null };
}

export const RATE_USD = { min: 0, max: 100 } as const;

/** Upserts one model's settings. A rate outside RATE_USD throws RangeError. */
export async function saveModelSetting(family: FamilyId, patch: { rateUsd?: number; enabled?: boolean; note?: string | null }): Promise<void> {
  const set: Partial<typeof schema.models.$inferInsert> = {};
  if (patch.rateUsd !== undefined) {
    if (!Number.isFinite(patch.rateUsd) || patch.rateUsd < RATE_USD.min || patch.rateUsd > RATE_USD.max) {
      throw new RangeError(`rate ${patch.rateUsd} is outside ${RATE_USD.min}..${RATE_USD.max} USD`);
    }
    set.pricePerSecUsd = patch.rateUsd.toFixed(4);
  }
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.note !== undefined) set.note = patch.note;
  await getDb()
    .insert(schema.models)
    .values({ modelId: family, name: FAMILIES[family].name, ...set })
    .onConflictDoUpdate({ target: schema.models.modelId, set });
}
