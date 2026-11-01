import { appError, type AppError } from "@/lib/errors";

export const CONTACT_KINDS = ["bug", "question", "other"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const CONTACT_MESSAGE_MAX = 5000;
export const CONTACT_SUBJECT_MAX = 120;
/** Files ride in the POST itself, and a Vercel Function takes 4.5 MB of body, so the files get 4 MB of it. */
export const CONTACT_FILES_MAX = 5;
export const CONTACT_FILES_BYTES = 4 * 1024 * 1024;
export const CONTACT_FILE_ACCEPT = "image/*,video/*,application/pdf,text/plain,application/json";
const FILE_TYPE = /^(image\/|video\/|application\/pdf$|text\/plain$|application\/json$)/;

/** What the browser knows about where the member was when they wrote. */
export type ContactContext = { page: string; locale: string; userAgent: string; viewport: string };
/** `subject` is null when the member left it blank. `generationId` is the turn the member reported from. */
export type ContactReport = { kind: ContactKind; subject: string | null; message: string; context: ContactContext; generationId: string | null };
export type AttachmentMeta = { name: string; type: string; size: number };

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

/** The report part of the POST as a report, or the reason to refuse it. Subject and context are cut to length, never refused. */
export function parseContact(body: unknown): { ok: true; report: ContactReport } | { ok: false; reason: AppError } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!CONTACT_KINDS.includes(b.kind as ContactKind)) return { ok: false, reason: appError("contactKind") };
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message) return { ok: false, reason: appError("contactEmpty") };
  if (message.length > CONTACT_MESSAGE_MAX) return { ok: false, reason: appError("contactTooLong", { max: CONTACT_MESSAGE_MAX }) };
  const subject = text(b.subject, CONTACT_SUBJECT_MAX).replace(/\s+/g, " ").trim();
  const c = (b.context ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    report: {
      kind: b.kind as ContactKind,
      subject: subject || null,
      message,
      context: { page: text(c.page, 2000), locale: text(c.locale, 20), userAgent: text(c.userAgent), viewport: text(c.viewport, 40) },
      generationId: typeof b.generationId === "string" && b.generationId ? b.generationId : null,
    },
  };
}

/** Why these files cannot go with a message, or null. The dialog asks before adding a file and the route asks again. */
export function attachmentProblem(files: readonly AttachmentMeta[]): AppError | null {
  if (files.length > CONTACT_FILES_MAX) return appError("contactTooManyFiles", { max: CONTACT_FILES_MAX });
  const refused = files.find((f) => !FILE_TYPE.test(f.type));
  if (refused) return appError("contactFileType", { name: refused.name });
  if (files.reduce((n, f) => n + f.size, 0) > CONTACT_FILES_BYTES) return appError("contactFilesTooLarge", { mb: CONTACT_FILES_BYTES / 1024 / 1024 });
  return null;
}

export const fileSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`);

const KST = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium" });
const kst = (d: Date) => `${KST.format(d)} KST`;

/** The email the operator reads: the member's words first, then everything needed to act on them without asking back. */
export function contactEmail({ report, attachments, sender, generation, sentAt, version }: { report: ContactReport; attachments: readonly AttachmentMeta[]; sender: ContactSender; generation: GenerationFacts | null; sentAt: Date; version: string | null }): ContactEmail {
  const name = sender.nickname ? `${sender.nickname} (${sender.username})` : sender.username;
  const title = report.subject ?? report.message.split("\n", 1)[0].slice(0, 60);
  const section = (heading: string, rows: [string, string | null][]) => [`— ${heading}`, ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)].join("\n");
  const parts = [
    report.message,
    attachments.length > 0 && section("Attachments", attachments.map((f) => [f.name, `${f.type}, ${fileSize(f.size)}`])),
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
    subject: `[Video Gen Studio] ${KIND_LABEL[report.kind]} · ${name} · ${title}`,
    text: parts.filter(Boolean).join("\n\n"),
    replyTo: EMAIL.test(sender.username) ? sender.username : null,
  };
}
