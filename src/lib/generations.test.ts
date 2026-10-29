import { test } from "node:test";
import assert from "node:assert/strict";
import type { User } from "@/db/schema";
import { HttpError } from "./auth";
import { planGeneration, type ReadyPlan } from "./catalog";
import { submitGeneration, unavailableFor } from "./generations";

const member = { id: 7, apiKeyEnc: null } as User;
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
    const noKey = unavailableFor("openai/gpt-image-2", keyed);
    assert.equal(noKey?.status, 503);
    assert.match(noKey?.message ?? "", /관리자.*OPENAI_API_KEY/);
    process.env.OPENAI_API_KEY = "sk-test";
    assert.equal(unavailableFor("openai/gpt-image-2", member), null, "a member without a Higgsfield key can make images");
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const noBlob = unavailableFor("openai/gpt-image-2", member);
    assert.equal(noBlob?.status, 503);
    assert.match(noBlob?.message ?? "", /Blob/);
  }));

test("video models keep their rule: the member's own Higgsfield key, whatever the server holds", () =>
  withEnv({ OPENAI_API_KEY: "sk-test", BLOB_READ_WRITE_TOKEN: BLOB }, () => {
    const noKey = unavailableFor("bytedance/seedance-2.0", member);
    assert.equal(noKey?.status, 403);
    assert.match(noKey?.message ?? "", /API 키가 아직 할당되지 않았습니다/);
    assert.equal(unavailableFor("minimax/h3", keyed), null);
  }));

test("submitting an image without OPENAI_API_KEY answers 503 before anything is written", () =>
  withEnv({ BLOB_READ_WRITE_TOKEN: BLOB }, async () => {
    const plan = planGeneration({ family: "openai/gpt-image-2", mode: "t2i", prompt: "등대", params: {}, images: [], videos: [], startFromImage: false }, 30);
    assert.ok(plan.ready);
    let scheduled = 0;
    await assert.rejects(
      submitGeneration(member, plan as ReadyPlan, () => void scheduled++),
      (e: unknown) => e instanceof HttpError && e.status === 503 && /OPENAI_API_KEY/.test(e.message),
      "with DATABASE_URL unset, any insert would have thrown 'DATABASE_URL is not set' instead",
    );
    assert.equal(scheduled, 0);
  }));
