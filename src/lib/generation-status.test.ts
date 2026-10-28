import { test } from "node:test";
import assert from "node:assert/strict";
import { GENERATION_STATUSES, isLive, predecessorsOf, STATUS_LABEL, STATUS_TONE, type GenerationStatus } from "./generation-status";

const LIVE: Record<GenerationStatus, boolean> = {
  queued: true,
  in_progress: true,
  completed: false,
  failed: false,
  nsfw: false,
  canceled: false,
};

const MAY_MOVE_FROM: Record<GenerationStatus, GenerationStatus[]> = {
  queued: [],
  in_progress: ["queued"],
  completed: ["queued", "in_progress"],
  failed: ["queued", "in_progress"],
  nsfw: ["queued", "in_progress"],
  canceled: ["queued", "in_progress"],
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

test("every status has a label and a tone", () => {
  for (const s of GENERATION_STATUSES) {
    assert.ok(STATUS_LABEL[s], `label for ${s}`);
    assert.ok(STATUS_TONE[s], `tone for ${s}`);
  }
});
