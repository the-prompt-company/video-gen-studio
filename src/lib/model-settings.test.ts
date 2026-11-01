import { test } from "node:test";
import assert from "node:assert/strict";
import { FAMILIES, FAMILY_IDS } from "./catalog";
import { rateOf } from "./model-settings";

test("a model nobody priced, or priced at 0, is costed at its published rate, so usage never sums a 0", () => {
  for (const id of FAMILY_IDS) {
    const { defaultUsd, published } = FAMILIES[id].rate;
    assert.ok(defaultUsd > 0 && published.some((p) => p.usd === defaultUsd), `${id} defaults to one of its published prices`);
    for (const saved of [undefined, null, "0", "0.0000"]) assert.equal(rateOf(id, saved), defaultUsd, `${id} with ${saved}`);
  }
  assert.equal(rateOf("minimax/h3", "0.1200"), 0.12, "a rate the admin saved wins");
});
