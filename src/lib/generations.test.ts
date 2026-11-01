import { test } from "node:test";
import assert from "node:assert/strict";
import type { Generation, User } from "@/db/schema";
import { HttpError } from "./auth";
import { planGeneration, type ReadyPlan } from "./catalog";
import { publicGeneration, submitGeneration, unavailableFor } from "./generations";

const member = { id: 7, apiKeyEnc: null } as User;
const failedRow = (stored: Pick<Generation, "error" | "errorCode" | "errorParams">) =>
  ({ id: "6f1e2a5c-1d1b-4c55-9a59-6c3f1f1c2b10", modelId: "bytedance/seedance-2.0/text-to-video", status: "failed", costUsd: "0", ...stored }) as Generation;
const keyed = { id: 8, apiKeyEnc: "v1.x.y.z" } as User;
const ENV = ["OPENAI_API_KEY", "BLOB_READ_WRITE_TOKEN", "DATABASE_URL"] as const;

function withEnv(values: Partial<Record<(typeof ENV)[number], string>>, run: () => Promise<void> | void) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) {
    if (values[k] === undefined) delete process.env[k];
    else process.env[k] = values[k];
  }
  return Promise.resolve(run()).finally(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

const BLOB = "vercel_blob_rw_store_secret";

test("the image model needs the server's OPENAI_API_KEY and Blob, never the member's Higgsfield key", () =>
  withEnv({ BLOB_READ_WRITE_TOKEN: BLOB }, () => {
    const noKey = unavailableFor("openai/gpt-image-2", keyed, 30);
    assert.deepEqual(noKey, { status: 503, error: { code: "noOpenAiKey" } });
    process.env.OPENAI_API_KEY = "sk-test";
    assert.equal(unavailableFor("openai/gpt-image-2", member, 30), null, "a member without a Higgsfield key can make images");
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const noBlob = unavailableFor("openai/gpt-image-2", member, 30);
    assert.deepEqual(noBlob, { status: 503, error: { code: "noImageStore" } });
  }));

test("video models keep their rule: the member's own Higgsfield key, whatever the server holds", () =>
  withEnv({ OPENAI_API_KEY: "sk-test", BLOB_READ_WRITE_TOKEN: BLOB }, () => {
    const noKey = unavailableFor("bytedance/seedance-2.0", member, 0.0985);
    assert.deepEqual(noKey, { status: 403, error: { code: "noKey" } });
    assert.equal(unavailableFor("minimax/h3", keyed, 0.065), null);
  }));

test("a model without a rate is unavailable to everyone, so no generation is recorded at a cost of 0", () =>
  withEnv({ OPENAI_API_KEY: "sk-test", BLOB_READ_WRITE_TOKEN: BLOB }, () => {
    for (const rate of [0, -1, Number.NaN]) {
      assert.deepEqual(unavailableFor("bytedance/seedance-2.0", keyed, rate), { status: 503, error: { code: "unpriced", params: { model: "Seedance 2.0" } } }, `Seedance at ${rate}`);
      assert.deepEqual(unavailableFor("openai/gpt-image-2", keyed, rate), { status: 503, error: { code: "unpriced", params: { model: "GPT Image 2" } } }, `GPT Image 2 at ${rate}`);
    }
    assert.equal(unavailableFor("minimax/h3", member, 0)?.error.code, "unpriced", "no rate is named before the missing key, since a key alone would not unlock it");
    assert.equal(unavailableFor("bytedance/seedance-2.0", keyed, 0.0001), null);
  }));

test("submitting an image without OPENAI_API_KEY answers 503 before anything is written", () =>
  withEnv({ BLOB_READ_WRITE_TOKEN: BLOB }, async () => {
    const plan = planGeneration({ family: "openai/gpt-image-2", mode: "t2i", prompt: "등대", params: {}, images: [], videos: [], endImage: null }, 30);
    assert.ok(plan.ready);
    let scheduled = 0;
    await assert.rejects(
      submitGeneration(member, plan as ReadyPlan, () => void scheduled++),
      (e: unknown) => e instanceof HttpError && e.status === 503 && e.error.code === "noOpenAiKey",
      "with DATABASE_URL unset, any insert would have thrown 'DATABASE_URL is not set' instead",
    );
    assert.equal(scheduled, 0);
  }));

test("a failure the app explains reaches the page as its code and params, for the page to translate", () => {
  const noKey = publicGeneration(failedRow({ error: null, errorCode: "noKey", errorParams: null }));
  assert.deepEqual(noKey.reason, { code: "noKey" });
  const late = publicGeneration(failedRow({ error: null, errorCode: "submitDeadline", errorParams: { minutes: 30 } }));
  assert.deepEqual(late.reason, { code: "submitDeadline", params: { minutes: 30 } });
});

test("the provider's own words reach the page exactly as the provider wrote them", () => {
  const refused = publicGeneration(failedRow({ error: "Higgsfield 422: prompt violates content policy", errorCode: null, errorParams: null }));
  assert.deepEqual(refused.reason, { text: "Higgsfield 422: prompt violates content policy" });
});

test("a row that failed before error codes keeps showing its Korean reason as it is", () => {
  const old = publicGeneration(failedRow({ error: "API 키가 아직 할당되지 않았습니다. 관리자에게 문의하세요", errorCode: null, errorParams: null }));
  assert.deepEqual(old.reason, { text: "API 키가 아직 할당되지 않았습니다. 관리자에게 문의하세요" });
  assert.equal(publicGeneration(failedRow({ error: null, errorCode: null, errorParams: null })).reason, null);
});
