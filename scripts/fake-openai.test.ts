import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { inflateSync } from "node:zlib";
import { configFromEnv, createFakeHiggsfield } from "./fake-higgsfield";
import { openAiConfigFromEnv, type OpenAiFakeConfig } from "./fake-openai";

async function fake(openai: Partial<OpenAiFakeConfig> = {}) {
  const server = createFakeHiggsfield(configFromEnv({}), { ...openAiConfigFromEnv({}), delayMs: 0, ...openai });
  server.listen(0);
  await once(server, "listening");
  const a = server.address();
  const base = `http://localhost:${typeof a === "object" && a ? a.port : 0}`;
  return { base, close: () => server.close() };
}

function post(base: string, op: string, body: unknown, auth = "Bearer sk-fake") {
  return fetch(`${base}/openai/v1/images/${op}`, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

type Answer = { data: { b64_json: string }[]; output_format: string; size: string; usage?: { input_tokens_details: { image_tokens: number; text_tokens: number }; output_tokens: number } };

test("a generation answers a real PNG in the requested aspect, with a usage block", async () => {
  const f = await fake();
  try {
    const res = await post(f.base, "generations", { model: "gpt-image-2", prompt: "등대", size: "1536x864", quality: "medium", output_format: "png", background: "auto" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Answer;
    const png = Buffer.from(body.data[0].b64_json, "base64");
    assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [96, 54], "IHDR keeps the 16:9 shape");
    const idat = png.subarray(png.indexOf("IDAT") + 4, png.indexOf("IEND") - 8);
    assert.equal(inflateSync(idat).length, (96 * 3 + 1) * 54, "the pixel data inflates to every row");
    assert.equal(body.size, "1536x864");
    assert.deepEqual(body.usage?.input_tokens_details, { image_tokens: 0, text_tokens: 2 });
    assert.equal(body.usage?.output_tokens, Math.round((1367 * 1536 * 864) / (1536 * 1024)));
  } finally {
    f.close();
  }
});

test("an edit takes image_url references and counts them as input image tokens; a JPEG is a JPEG", async () => {
  const f = await fake();
  try {
    const res = await post(f.base, "edits", { model: "gpt-image-2", prompt: "대리석 위에", output_format: "jpeg", images: [{ image_url: "https://cdn.test/a.png" }, { image_url: "https://cdn.test/b.png" }] });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Answer;
    assert.deepEqual([...Buffer.from(body.data[0].b64_json, "base64").subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.equal(body.usage?.input_tokens_details.image_tokens, 2 * 4354);
  } finally {
    f.close();
  }
});

test("bodies outside the documented parameters are 400s shaped like OpenAI's, and a missing key is a 401", async () => {
  const f = await fake();
  try {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["generations", { model: "gpt-image-2", prompt: "x", size: "1000x1000" }, /divisible by 16/],
      ["generations", { model: "gpt-image-2", prompt: "x", quality: "xhigh" }, /quality/],
      ["generations", { model: "gpt-image-2", prompt: "x", seed: 1 }, /Unknown parameter: 'seed'/],
      ["generations", { model: "dall-e-3", prompt: "x" }, /model/],
      ["generations", { model: "gpt-image-2", prompt: "x", background: "transparent", output_format: "jpeg" }, /transparent/],
      ["edits", { model: "gpt-image-2", prompt: "x", images: [] }, /1 to 16/],
      ["edits", { model: "gpt-image-2", prompt: "x", images: [{ image_url: "https://a" }], input_fidelity: "high" }, /input_fidelity/],
      ["edits", { model: "gpt-image-2", prompt: "x", images: [{ image_url: "ftp://a" }] }, /image_url/],
    ];
    for (const [op, body, why] of cases) {
      const res = await post(f.base, op, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.match(((await res.json()) as { error: { message: string } }).error.message, why);
    }
    assert.equal((await post(f.base, "generations", { model: "gpt-image-2", prompt: "x" }, "")).status, 401);
  } finally {
    f.close();
  }
});

test("knobs: refuse the first request with 429 and Retry-After, then answer; hang up; and every request is listed", async () => {
  const f = await fake({ refuseFirstN: 1, retryAfterS: 3 });
  try {
    const body = { model: "gpt-image-2", prompt: "x" };
    const refused = await post(f.base, "generations", body);
    assert.deepEqual([refused.status, refused.headers.get("retry-after")], [429, "3"]);
    assert.equal((await post(f.base, "generations", body)).status, 200);
    await fetch(`${f.base}/_config`, { method: "POST", body: JSON.stringify({ openai: { fail: "hangup" } }) });
    await assert.rejects(post(f.base, "generations", body));
    const stats = (await (await fetch(`${f.base}/_stats`)).json()) as { openai: { requests: { status: number }[]; answered: number } };
    assert.deepEqual(stats.openai.requests.map((r) => r.status), [429, 200, 0]);
    assert.equal(stats.openai.answered, 1);
  } finally {
    f.close();
  }
});
