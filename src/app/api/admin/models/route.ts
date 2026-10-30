import { requireAdmin, errorResponse, HttpError } from "@/lib/auth";
import { FAMILIES, FAMILY_IDS, isFamilyId } from "@/lib/catalog";
import { loadModelSettings, RATE_USD, saveModelSetting } from "@/lib/model-settings";

/** GET /api/admin/models — the catalog's models with their stored base rate and enabled flag. */
export async function GET() {
  try {
    await requireAdmin();
    const settings = await loadModelSettings();
    const items = FAMILY_IDS.map((id) => ({
      modelId: id,
      name: FAMILIES[id].name,
      vendor: FAMILIES[id].vendor,
      pricePerSecUsd: settings[id].rateUsd,
      enabled: settings[id].enabled,
      note: settings[id].note,
    }));
    return Response.json({ items });
  } catch (e) {
    return errorResponse(e);
  }
}

type Body = { modelId?: string; pricePerSecUsd?: number | string; enabled?: boolean; note?: string | null };

/** PATCH /api/admin/models — set one model's base rate (USD per second of its reference format), enabled flag or note. */
export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const b = (await req.json().catch(() => ({}))) as Body;
    const family = String(b.modelId ?? "");
    if (!isFamilyId(family)) throw new HttpError(400, "unknownModel");
    const patch: Parameters<typeof saveModelSetting>[1] = {};
    if (b.pricePerSecUsd !== undefined) patch.rateUsd = Number(b.pricePerSecUsd);
    if (b.enabled !== undefined) patch.enabled = Boolean(b.enabled);
    if (b.note !== undefined) patch.note = b.note ? String(b.note) : null;
    if (Object.keys(patch).length === 0) throw new HttpError(400, "nothingToChange");
    try {
      await saveModelSetting(family, patch);
    } catch (e) {
      if (e instanceof RangeError) throw new HttpError(400, "rateOutOfRange", RATE_USD);
      throw e;
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
