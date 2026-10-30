import { test } from "node:test";
import assert from "node:assert/strict";
import { GENERATION_STATUSES, isLive, predecessorsOf, STATUS_TONE, type GenerationStatus } from "./generation-status";
import ko from "../messages/ko.json";
import en from "../messages/en.json";
import zhCN from "../messages/zh-CN.json";

const LIVE: Record<GenerationStatus, boolean> = {
  pending: true,
  queued: true,
  in_progress: true,
  completed: false,
  failed: false,
  nsfw: false,
  canceled: false,
};

const MAY_MOVE_FROM: Record<GenerationStatus, GenerationStatus[]> = {
  pending: [],
  queued: ["pending"],
  in_progress: ["pending", "queued"],
  completed: ["pending", "queued", "in_progress"],
  failed: ["pending", "queued", "in_progress"],
  nsfw: ["pending", "queued", "in_progress"],
  canceled: ["pending", "queued", "in_progress"],
};

test("isLive is true only while Higgsfield still owes an answer", () => {
  for (const s of GENERATION_STATUSES) assert.equal(isLive(s), LIVE[s], s);
});

test("predecessorsOf lists exactly the statuses a row may leave to reach each status", () => {
  for (const s of GENERATION_STATUSES) assert.deepEqual([...predecessorsOf(s)].sort(), [...MAY_MOVE_FROM[s]].sort(), s);
});

test("no write moves a row backwards or sideways", () => {
  for (const to of GENERATION_STATUSES) {
    for (const from of predecessorsOf(to)) {
      assert.ok(isLive(from), `${from} -> ${to} leaves a terminal status`);
      assert.notEqual(from, to, `${to} is its own predecessor`);
    }
  }
});

test("every status has a tone and a label in every language", () => {
  for (const s of GENERATION_STATUSES) {
    assert.ok(STATUS_TONE[s], `tone for ${s}`);
    for (const [locale, messages] of Object.entries({ ko, en, "zh-CN": zhCN })) {
      const label: unknown = (messages.status as Record<string, unknown>)[s];
      assert.ok(typeof label === "string" && label.trim(), `${locale}.json status.${s}`);
    }
  }
});
