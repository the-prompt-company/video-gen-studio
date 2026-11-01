import { and, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { getDb, schema } from "@/db";
import { errorResponse, HttpError, requireUser } from "@/lib/auth";
import { contactEmail, parseContact, type ContactEmail, type GenerationFacts } from "@/lib/contact";
import { appError, type AppError } from "@/lib/errors";
import { isGenerationId } from "@/lib/generations";

/** Where every contact message goes: the operator's inbox unless CONTACT_TO names another. */
const CONTACT_TO = process.env.CONTACT_TO || "jeongjun@the-prompt.me";

/**
 * POST /api/contact — the signed-in member's message, emailed to the operator. The body is { kind, message, context,
 * generationId }. A generation is described from the caller's own row, and one that is not theirs is left out.
 * 200 once Gmail accepted it, 400 for an empty or overlong message, 503 while SMTP_PASS is unset, 502 when
 * Gmail refused it or could not be reached.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const parsed = parseContact(await req.json().catch(() => null));
    if (!parsed.ok) throw HttpError.of(400, parsed.reason);
    const { report } = parsed;
    const generation = report.generationId && isGenerationId(report.generationId) ? await ownGeneration(user.id, report.generationId) : null;
    const email = contactEmail({ report, sender: user, generation, sentAt: new Date(), version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null });
    const sent = await sendContactEmail(email);
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

/**
 * Sends over Gmail SMTP, signed in with a Google app password (SMTP_PASS) for SMTP_USER, which defaults to the recipient,
 * so the operator's own Gmail sends to its own inbox.
 */
async function sendContactEmail(email: ContactEmail): Promise<SendResult> {
  const user = process.env.SMTP_USER || CONTACT_TO;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return { ok: false, status: 503, reason: appError("contactUnavailable") };
  const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000 });
  try {
    await transport.sendMail({ from: `Video Gen Studio <${user}>`, to: CONTACT_TO, subject: email.subject, text: email.text, ...(email.replyTo && { replyTo: email.replyTo }) });
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; responseCode?: number };
    console.error(JSON.stringify({ evt: "contact_send_failed", code: err.code ?? null, responseCode: err.responseCode ?? null }));
    return { ok: false, status: 502, reason: appError("contactNotSent") };
  }
}
