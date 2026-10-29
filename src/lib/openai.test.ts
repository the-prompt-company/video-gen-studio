import { test } from "node:test";
import assert from "node:assert/strict";
import { gradientPng } from "../../scripts/fake-openai";
import { outcomeOf, serverKey, talksToRealOpenAi } from "./openai";

const PNG = gradientPng(8, 8, 1);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const WEBP = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const USAGE = { input_tokens: 4410, input_tokens_details: { image_tokens: 4354, text_tokens: 56 }, output_tokens: 1756, total_tokens: 6166 };

function ok(bytes: Buffer, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ created: 1, data: [{ b64_json: bytes.toString("base64") }], usage: USAGE, ...extra });
}

function error(code: string | null, type: string, message = "m") {
  return JSON.stringify({ error: { message, type, param: null, code } });
}

const h = (o: Record<string, string> = {}) => new Headers(o);

test("an answer with an image in the requested format is the image, with OpenAI's token counts", () => {
  const o = outcomeOf(200, h(), ok(PNG), "png");
  assert.equal(o.kind, "image");
  assert.ok(o.kind === "image" && Buffer.from(o.bytes).equals(PNG));
  assert.deepEqual(o.kind === "image" && o.usage, { inputTextTokens: 56, inputImageTokens: 4354, outputTokens: 1756 });
  assert.equal(outcomeOf(200, h(), ok(JPEG), "jpeg").kind, "image");
  assert.equal(outcomeOf(200, h(), ok(WEBP), "webp").kind, "image");
});

test("usage is optional: missing or malformed counts leave it null, and an unsplit input is priced as image input", () => {
  const none = outcomeOf(200, h(), JSON.stringify({ created: 1, data: [{ b64_json: PNG.toString("base64") }] }), "png");
  assert.equal(none.kind === "image" && none.usage, null);
  const unsplit = outcomeOf(200, h(), ok(PNG, { usage: { input_tokens: 4410, output_tokens: 1756, total_tokens: 6166 } }), "png");
  assert.deepEqual(unsplit.kind === "image" && unsplit.usage, { inputTextTokens: 0, inputImageTokens: 4410, outputTokens: 1756 });
  const bad = outcomeOf(200, h(), ok(PNG, { usage: { input_tokens: -1, output_tokens: "x" } }), "png");
  assert.equal(bad.kind === "image" && bad.usage, null);
});

test("a 2xx without a usable image may have been billed: unknown, keeping any usage it reported", () => {
  for (const text of ["not json", JSON.stringify({ created: 1, data: [] }), JSON.stringify({ created: 1, data: [{ url: "https://x" }] }), ok(JPEG)]) {
    const o = outcomeOf(200, h(), text, "png");
    assert.equal(o.kind, "unknown", text.slice(0, 40));
  }
  const wrong = outcomeOf(200, h(), ok(JPEG), "png");
  assert.deepEqual(wrong.kind === "unknown" && wrong.usage, { inputTextTokens: 56, inputImageTokens: 4354, outputTokens: 1756 });
});

test("a rate-limit 429 and an overloaded 503 were refused before any work: refused, with Retry-After", () => {
  const limited = outcomeOf(429, h({ "retry-after": "7" }), error("rate_limit_exceeded", "requests"), "png");
  assert.deepEqual(limited.kind === "refused" && limited.retryAfterS, 7);
  const overloaded = outcomeOf(503, h(), error("server_is_overloaded", "service_unavailable_error"), "png");
  assert.equal(overloaded.kind, "refused");
  assert.equal(overloaded.kind === "refused" && overloaded.retryAfterS, 5, "no Retry-After means 5 s");
});

test("quota, moderation, a bad key and a bad request are rejected and never resent", () => {
  const quota = outcomeOf(429, h(), error("insufficient_quota", "insufficient_quota"), "png");
  assert.deepEqual(quota.kind === "rejected" && quota.cause, "quota");
  const blocked = outcomeOf(400, h(), JSON.stringify({ error: { message: "rejected by the safety system", type: "image_generation_user_error", code: "moderation_blocked", moderation_details: { moderation_stage: "output" } } }), "png");
  assert.deepEqual(blocked.kind === "rejected" && blocked.cause, "moderation");
  const key = outcomeOf(401, h(), error("invalid_api_key", "invalid_request_error", "Incorrect API key provided: sk-proj-abc***wxyz."), "png");
  assert.equal(key.kind === "rejected" && key.cause, "key");
  assert.doesNotMatch(key.kind === "rejected" ? key.error : "", /sk-|wxyz/, "the error never carries a fragment of the key");
  assert.equal(outcomeOf(403, h(), error("unsupported_country_region_territory", "request_forbidden"), "png").kind, "rejected");
  const bad = outcomeOf(400, h(), error(null, "invalid_request_error", "Invalid value for size, key sk-live-123456"), "png");
  assert.equal(bad.kind === "rejected" && bad.cause, "request");
  assert.match(bad.kind === "rejected" ? bad.error : "", /^OpenAI 400: Invalid value for size/);
  assert.doesNotMatch(bad.kind === "rejected" ? bad.error : "", /sk-live/);
});

test("server errors, timeouts the server reports, and an HTML 503 may follow work OpenAI billed: unknown", () => {
  for (const status of [408, 409, 500, 502, 504]) assert.equal(outcomeOf(status, h(), error(null, "server_error"), "png").kind, "unknown", String(status));
  assert.equal(outcomeOf(503, h(), "<html>busy</html>", "png").kind, "unknown");
});

test("the key is read from OPENAI_API_KEY only, and the base URL says whether this process talks to OpenAI", () => {
  const saved = { key: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL };
  try {
    delete process.env.OPENAI_API_KEY;
    assert.equal(serverKey(), null);
    process.env.OPENAI_API_KEY = "  ";
    assert.equal(serverKey(), null);
    process.env.OPENAI_API_KEY = " sk-test ";
    assert.equal(serverKey(), "sk-test");
    delete process.env.OPENAI_BASE_URL;
    assert.equal(talksToRealOpenAi(), true);
    process.env.OPENAI_BASE_URL = "http://localhost:4010/openai/v1";
    assert.equal(talksToRealOpenAi(), false);
  } finally {
    for (const [name, v] of [["OPENAI_API_KEY", saved.key], ["OPENAI_BASE_URL", saved.base]] as const) {
      if (v === undefined) delete process.env[name];
      else process.env[name] = v;
    }
  }
});
