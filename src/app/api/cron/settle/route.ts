import { sweep } from "@/lib/generations";
import { talksToRealHiggsfield } from "@/lib/higgsfield";

/** The sweep copies inline, so the last row it starts before SWEEP_BUDGET_MS needs the rest of this budget. */
export const maxDuration = 300;

const SWEEP_BUDGET_MS = 240_000;

/**
 * The sweep settles every user's due rows, and a local server shares the one production database. Against a fake
 * Higgsfield it would fail real live rows as "request not found" and record copies that exist only in the fake.
 */
const NONPROD =
  "HIGGSFIELD_BASE_URL이 실제 Higgsfield가 아니라서 공용 DB를 sweep하지 않습니다. 모든 due 행이 이 실행의 것일 때만 SWEEP_ALLOW_NONPROD=1로 여세요. " +
  "(Refusing to sweep the shared database against a non-production Higgsfield; set SWEEP_ALLOW_NONPROD=1 to override.)";

/** GET /api/cron/settle — Vercel Cron, every minute on Pro. Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!talksToRealHiggsfield() && process.env.SWEEP_ALLOW_NONPROD !== "1") return Response.json({ error: NONPROD }, { status: 409 });
  return Response.json(await sweep({ deadline: Date.now() + SWEEP_BUDGET_MS }));
}
