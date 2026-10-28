import { after } from "next/server";
import { onProviderHook, type HookOutcome } from "@/lib/generations";

/** The copy a completing hook schedules with `after` runs inside this budget. MIRROR_LEASE_S in generations.ts outlasts it. */
export const maxDuration = 300;

/** Higgsfield redelivers a 5xx for up to 2 hours and never redelivers a 4xx. */
const HTTP: Record<HookOutcome, number> = { done: 204, unauthorized: 401, retry: 503 };

/** POST /api/hooks/higgsfield?g=<generation id>&t=<token> — Higgsfield's completion webhook. The body is never read. */
export async function POST(req: Request) {
  return new Response(null, { status: HTTP[await onProviderHook(new URL(req.url), after)] });
}
