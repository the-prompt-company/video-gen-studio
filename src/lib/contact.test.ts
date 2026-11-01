import { test } from "node:test";
import assert from "node:assert/strict";
import { CONTACT_MESSAGE_MAX, contactEmail, parseContact, type ContactReport } from "./contact";

const KEY = "0b6f1a2c-3d4e-4f50-8a6b-7c8d9e0f1a2b";
const context = { page: "https://video-gen-studio-sigma.vercel.app/playground?thread=earlier", locale: "ko", userAgent: "Mozilla/5.0 Chrome/141", viewport: "1440×900" };

test("a report needs a known kind and a message, and keeps the message as written apart from its outer blank lines", () => {
  assert.deepEqual(parseContact({ kind: "praise", message: "hi", key: KEY }), { ok: false, reason: { code: "contactKind" } });
  assert.deepEqual(parseContact({ kind: "bug", message: "  \n ", key: KEY }), { ok: false, reason: { code: "contactEmpty" } });
  assert.deepEqual(parseContact({ kind: "bug", message: "x".repeat(CONTACT_MESSAGE_MAX + 1) }), { ok: false, reason: { code: "contactTooLong", params: { max: CONTACT_MESSAGE_MAX } } });
  assert.deepEqual(parseContact(null), { ok: false, reason: { code: "contactKind" } });
  const ok = parseContact({ kind: "bug", message: "\n생성하기가 안 눌려요\n  두 번째 줄\n", key: KEY, generationId: "g1", context });
  assert.ok(ok.ok);
  assert.deepEqual(ok.report, { kind: "bug", message: "생성하기가 안 눌려요\n  두 번째 줄", key: KEY, generationId: "g1", context });
});

test("context the browser sends is cut to length rather than refused, and a missing or malformed key just turns idempotency off", () => {
  const r = parseContact({ kind: "other", message: "m", key: "not-a-uuid", context: { page: 42, userAgent: "u".repeat(900), viewport: "1×1" } });
  assert.ok(r.ok);
  assert.deepEqual(r.report.context, { page: "", locale: "", userAgent: "u".repeat(500), viewport: "1×1" });
  assert.equal(r.report.key, null);
  assert.equal(r.report.generationId, null);
});

const report: ContactReport = { kind: "bug", message: "영상이 실패로 끝났어요\n다시 해도 같아요", context, key: KEY, generationId: "g1" };
const sentAt = new Date("2026-11-01T08:30:00Z");

test("the email leads with the member's words and labels everything the operator needs, generation facts included", () => {
  const generation = { id: "g1", modelId: "bytedance/seedance-2.0/text-to-video", status: "failed", requestId: "req-9", reason: 'providerUnreachable {"status":502}', createdAt: new Date("2026-11-01T08:20:00Z"), completedAt: null };
  const e = contactEmail({ report, sender: { username: "designer@example.test", nickname: "디자이너", role: "member" }, generation, sentAt, version: "accf00a" });
  assert.equal(e.subject, "[Video Gen Studio] Bug report · 디자이너 (designer@example.test) · 영상이 실패로 끝났어요");
  assert.ok(e.text.startsWith("영상이 실패로 끝났어요\n다시 해도 같아요\n\n— From\nName: 디자이너 (designer@example.test)"), e.text);
  for (const line of [`Page: ${context.page}`, "Browser: Mozilla/5.0 Chrome/141", "Viewport: 1440×900", "Model: bytedance/seedance-2.0/text-to-video", "Status: failed", 'Error: providerUnreachable {"status":502}', "Provider request ID: req-9", "Version: accf00a", "Sent: 2026-11-01 17:30:00 KST", "Created: 2026-11-01 17:20:00 KST"]) {
    assert.ok(e.text.includes(line), `has ${line}`);
  }
  assert.ok(!e.text.includes("Ended"), "an unfinished generation has no end time line");
  assert.equal(e.replyTo, "designer@example.test", "a username that is an address is where the operator replies");
});

test("without a generation or an address-like username, those parts are simply absent", () => {
  const e = contactEmail({ report: { ...report, kind: "question", generationId: null }, sender: { username: "minji", nickname: null, role: "admin" }, generation: null, sentAt, version: null });
  assert.equal(e.subject, "[Video Gen Studio] Question · minji · 영상이 실패로 끝났어요");
  assert.ok(!e.text.includes("— Generation"));
  assert.ok(e.text.includes("Version: local"));
  assert.equal(e.replyTo, null);
});
