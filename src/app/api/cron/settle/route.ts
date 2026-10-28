import { sweep } from "@/lib/generations";

/** The sweep copies inline, so the last row it starts before SWEEP_BUDGET_MS needs the rest of this budget. */
export const maxDuration = 300;

const SWEEP_BUDGET_MS = 240_000;

/** GET /api/cron/settle — Vercel Cron, every minute on Pro. Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json(await sweep({ deadline: Date.now() + SWEEP_BUDGET_MS }));
}
