import { appError, type AppError } from "@/lib/errors";

export const CONTACT_KINDS = ["bug", "question", "other"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const CONTACT_MESSAGE_MAX = 5000;

/** What the browser knows about where the member was when they wrote. */
export type ContactContext = { page: string; locale: string; userAgent: string; viewport: string };
/** `generationId` is the turn the member reported from. */
export type ContactReport = { kind: ContactKind; message: string; context: ContactContext; generationId: string | null };

/** The reported generation as the database has it, so the email never repeats what the browser claimed about it. */
export type GenerationFacts = {
  id: string;
  modelId: string;
  status: string;
  requestId: string | null;
  reason: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type ContactSender = { username: string; nickname: string | null; role: string };
export type ContactEmail = { subject: string; text: string; replyTo: string | null };

const KIND_LABEL: Record<ContactKind, string> = { bug: "Bug report", question: "Question", other: "Other" };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD_MAX = 500;

const text = (v: unknown, max = FIELD_MAX): string => (typeof v === "string" ? v.slice(0, max) : "");

/** The POST body as a report, or the reason to refuse it. Context fields are cut to length, never refused. */
export function parseContact(body: unknown): { ok: true; report: ContactReport } | { ok: false; reason: AppError } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!CONTACT_KINDS.includes(b.kind as ContactKind)) return { ok: false, reason: appError("contactKind") };
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message) return { ok: false, reason: appError("contactEmpty") };
  if (message.length > CONTACT_MESSAGE_MAX) return { ok: false, reason: appError("contactTooLong", { max: CONTACT_MESSAGE_MAX }) };
  const c = (b.context ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    report: {
      kind: b.kind as ContactKind,
      message,
      context: { page: text(c.page, 2000), locale: text(c.locale, 20), userAgent: text(c.userAgent), viewport: text(c.viewport, 40) },
      generationId: typeof b.generationId === "string" && b.generationId ? b.generationId : null,
    },
  };
}

const KST = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium" });
const kst = (d: Date) => `${KST.format(d)} KST`;

/** The email the operator reads: the member's words first, then everything needed to act on them without asking back. */
export function contactEmail({ report, sender, generation, sentAt, version }: { report: ContactReport; sender: ContactSender; generation: GenerationFacts | null; sentAt: Date; version: string | null }): ContactEmail {
  const name = sender.nickname ? `${sender.nickname} (${sender.username})` : sender.username;
  const firstLine = report.message.split("\n", 1)[0].slice(0, 60);
  const section = (title: string, rows: [string, string | null][]) => [`— ${title}`, ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)].join("\n");
  const parts = [
    report.message,
    section("From", [["Name", name], ["Role", sender.role]]),
    section("Screen", [["Page", report.context.page], ["Language", report.context.locale], ["Browser", report.context.userAgent], ["Viewport", report.context.viewport]]),
    generation &&
      section("Generation", [
        ["ID", generation.id],
        ["Model", generation.modelId],
        ["Status", generation.status],
        ["Error", generation.reason],
        ["Provider request ID", generation.requestId],
        ["Created", kst(generation.createdAt)],
        ["Ended", generation.completedAt && kst(generation.completedAt)],
      ]),
    section("App", [["Version", version ?? "local"], ["Sent", kst(sentAt)]]),
  ];
  return {
    subject: `[Video Gen Studio] ${KIND_LABEL[report.kind]} · ${name} · ${firstLine}`,
    text: parts.filter(Boolean).join("\n\n"),
    replyTo: EMAIL.test(sender.username) ? sender.username : null,
  };
}
