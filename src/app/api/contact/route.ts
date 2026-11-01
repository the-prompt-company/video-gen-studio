import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { errorResponse, HttpError, requireUser } from "@/lib/auth";
import { contactEmail, parseContact, type ContactEmail, type GenerationFacts } from "@/lib/contact";
import { appError, type AppError } from "@/lib/errors";
import { isGenerationId } from "@/lib/generations";

/** Where every contact message goes: the operator's inbox. */
const CONTACT_TO = "jeongjun@the-prompt.me";

/**
 * POST /api/contact — the signed-in member's message, emailed to the operator. The body is { kind, message, context,
 * key, generationId }. A generation is described from the caller's own row, and one that is not theirs is left out.
 * 200 once Resend accepted it, 400 for an empty or overlong message, 503 while Resend is not configured, 502 when it
 * refused or could not be reached.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = parseContact(await req.json().catch(() => null));
    if (!parsed.ok) throw HttpError.of(400, parsed.reason);
    const { report } = parsed;
    const generation = report.generationId && isGenerationId(report.generationId) ? await ownGeneration(user.id, report.generationId) : null;
    const email = contactEmail({ report, sender: user, generation, sentAt: new Date(), version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null });
    const sent = await sendContactEmail(email, report.key);
    if (!sent.ok) throw HttpError.of(sent.status, sent.reason);
    return Response.json({ sent: true });
  } catch (e) {
    return errorResponse(e);
  }
}

async function ownGeneration(userId: number, id: string): Promise<GenerationFacts | null> {
  const g = schema.generations;
  const [row] = await getDb()
    .select({ id: g.id, modelId: g.modelId, status: g.status, requestId: g.requestId, error: g.error, errorCode: g.errorCode, errorParams: g.errorParams, createdAt: g.createdAt, completedAt: g.completedAt })
    .from(g)
    .where(and(eq(g.id, id), eq(g.userId, userId)))
    .limit(1);
  if (!row) return null;
  const reason = row.errorCode ? `${row.errorCode} ${JSON.stringify(row.errorParams ?? {})}` : row.error;
  return { id: row.id, modelId: row.modelId, status: row.status, requestId: row.requestId, reason, createdAt: row.createdAt, completedAt: row.completedAt };
}

type SendResult = { ok: true } | { ok: false; status: 503 | 502; reason: AppError };

/** Sends through Resend. Its Idempotency-Key makes a retried send of the same dialog one email. */
async function sendContactEmail(email: ContactEmail, key: string | null): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const domain = process.env.RESEND_EMAIL_DOMAIN;
  if (!apiKey || !domain) return { ok: false, status: 503, reason: appError("contactUnavailable") };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...(key && { "Idempotency-Key": `contact-${key}` }) },
    body: JSON.stringify({
      from: `Video Gen Studio <contact@${domain}>`,
      to: [CONTACT_TO],
      subject: email.subject,
      text: email.text,
      ...(email.replyTo && { reply_to: email.replyTo }),
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (res?.ok) return { ok: true };
  console.error(JSON.stringify({ evt: "contact_send_failed", status: res?.status ?? null, body: res ? (await res.text().catch(() => "")).slice(0, 500) : "unreachable" }));
  return { ok: false, status: 502, reason: appError("contactNotSent") };
}
