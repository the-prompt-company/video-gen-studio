import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentProblem, CONTACT_FILES_BYTES, CONTACT_FILES_MAX, CONTACT_MESSAGE_MAX, CONTACT_SUBJECT_MAX, contactEmail, parseContact, type ContactReport } from "./contact";

const context = { page: "https://video-gen-studio-sigma.vercel.app/playground?thread=earlier", locale: "ko", userAgent: "Mozilla/5.0 Chrome/141", viewport: "1440×900" };

test("a report needs a known kind and a message, and keeps the message as written apart from its outer blank lines", () => {
  assert.deepEqual(parseContact({ kind: "praise", message: "hi" }), { ok: false, reason: { code: "contactKind" } });
  assert.deepEqual(parseContact({ kind: "bug", message: "  \n " }), { ok: false, reason: { code: "contactEmpty" } });
  assert.deepEqual(parseContact({ kind: "bug", message: "x".repeat(CONTACT_MESSAGE_MAX + 1) }), { ok: false, reason: { code: "contactTooLong", params: { max: CONTACT_MESSAGE_MAX } } });
  assert.deepEqual(parseContact(null), { ok: false, reason: { code: "contactKind" } });
  const ok = parseContact({ kind: "bug", message: "\n생성하기가 안 눌려요\n  두 번째 줄\n", generationId: "g1", context });
  assert.ok(ok.ok);
  assert.deepEqual(ok.report, { kind: "bug", subject: null, message: "생성하기가 안 눌려요\n  두 번째 줄", generationId: "g1", context });
});

test("a subject is one line cut to its limit, and a blank one is no subject", () => {
  const subjectOf = (subject: unknown) => {
    const r = parseContact({ kind: "bug", message: "m", subject });
    assert.ok(r.ok);
    return r.report.subject;
  };
  assert.equal(subjectOf("  다운로드가\n 안 돼요  "), "다운로드가 안 돼요");
  assert.equal(subjectOf("s".repeat(CONTACT_SUBJECT_MAX + 30)), "s".repeat(CONTACT_SUBJECT_MAX));
  for (const blank of ["", "  \n", undefined, 7]) assert.equal(subjectOf(blank), null, JSON.stringify(blank));
});

test("context the browser sends is cut to length rather than refused", () => {
  const r = parseContact({ kind: "other", message: "m", context: { page: 42, userAgent: "u".repeat(900), viewport: "1×1" } });
  assert.ok(r.ok);
  assert.deepEqual(r.report.context, { page: "", locale: "", userAgent: "u".repeat(500), viewport: "1×1" });
  assert.equal(r.report.generationId, null);
});

test("attachments are images, videos, PDF or text, at most five, and 4 MB together", () => {
  const png = (size: number, name = "shot.png") => ({ name, type: "image/png", size });
  assert.equal(attachmentProblem([]), null);
  assert.equal(attachmentProblem([png(1000), { name: "clip.mp4", type: "video/mp4", size: 2000 }, { name: "log.txt", type: "text/plain", size: 10 }, { name: "a.pdf", type: "application/pdf", size: 10 }, { name: "a.json", type: "application/json", size: 10 }]), null);
  assert.deepEqual(attachmentProblem(Array.from({ length: CONTACT_FILES_MAX + 1 }, () => png(1))), { code: "contactTooManyFiles", params: { max: CONTACT_FILES_MAX } });
  assert.deepEqual(attachmentProblem([png(1), { name: "setup.exe", type: "application/x-msdownload", size: 1 }]), { code: "contactFileType", params: { name: "setup.exe" } });
  assert.deepEqual(attachmentProblem([{ name: "notes", type: "", size: 1 }]), { code: "contactFileType", params: { name: "notes" } }, "a file the browser could not type is refused, not guessed");
  assert.equal(attachmentProblem([png(CONTACT_FILES_BYTES / 2), png(CONTACT_FILES_BYTES / 2)]), null, "exactly 4 MB fits");
  assert.deepEqual(attachmentProblem([png(CONTACT_FILES_BYTES / 2), png(CONTACT_FILES_BYTES / 2 + 1)]), { code: "contactFilesTooLarge", params: { mb: 4 } });
});

const report: ContactReport = { kind: "bug", subject: null, message: "영상이 실패로 끝났어요\n다시 해도 같아요", context, generationId: "g1" };
const sentAt = new Date("2026-11-01T08:30:00Z");

test("the email leads with the member's words and labels everything the operator needs, generation facts included", () => {
  const generation = { id: "g1", modelId: "bytedance/seedance-2.0/text-to-video", status: "failed", requestId: "req-9", reason: 'providerUnreachable {"status":502}', createdAt: new Date("2026-11-01T08:20:00Z"), completedAt: null };
  const e = contactEmail({ report, attachments: [], sender: { username: "designer@example.test", nickname: "디자이너", role: "member" }, generation, sentAt, version: "accf00a" });
  assert.equal(e.subject, "[Video Gen Studio] Bug report · 디자이너 (designer@example.test) · 영상이 실패로 끝났어요");
  assert.ok(e.text.startsWith("영상이 실패로 끝났어요\n다시 해도 같아요\n\n— From\nName: 디자이너 (designer@example.test)"), e.text);
  for (const line of [`Page: ${context.page}`, "Browser: Mozilla/5.0 Chrome/141", "Viewport: 1440×900", "Model: bytedance/seedance-2.0/text-to-video", "Status: failed", 'Error: providerUnreachable {"status":502}', "Provider request ID: req-9", "Version: accf00a", "Sent: 2026-11-01 17:30:00 KST", "Created: 2026-11-01 17:20:00 KST"]) {
    assert.ok(e.text.includes(line), `has ${line}`);
  }
  assert.ok(!e.text.includes("Ended"), "an unfinished generation has no end time line");
  assert.ok(!e.text.includes("— Attachments"), "no attachments, no attachment list");
  assert.equal(e.replyTo, "designer@example.test", "a username that is an address is where the operator replies");
});

test("a subject the member wrote titles the email, and attached files are listed right under the message", () => {
  const attachments = [{ name: "screen.png", type: "image/png", size: 1_258_291 }, { name: "console.txt", type: "text/plain", size: 900 }];
  const e = contactEmail({ report: { ...report, subject: "실패 후 다시가 안 돼요" }, attachments, sender: { username: "minji", nickname: null, role: "member" }, generation: null, sentAt, version: null });
  assert.equal(e.subject, "[Video Gen Studio] Bug report · minji · 실패 후 다시가 안 돼요");
  assert.ok(e.text.startsWith("영상이 실패로 끝났어요\n다시 해도 같아요\n\n— Attachments\nscreen.png: image/png, 1.2 MB\nconsole.txt: text/plain, 1 KB\n\n— From"), e.text);
});

test("without a generation or an address-like username, those parts are simply absent", () => {
  const e = contactEmail({ report: { ...report, kind: "question", generationId: null }, attachments: [], sender: { username: "minji", nickname: null, role: "admin" }, generation: null, sentAt, version: null });
  assert.equal(e.subject, "[Video Gen Studio] Question · minji · 영상이 실패로 끝났어요");
  assert.ok(!e.text.includes("— Generation"));
  assert.ok(e.text.includes("Version: local"));
  assert.equal(e.replyTo, null);
});
