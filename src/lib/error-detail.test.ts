import { test } from "node:test";
import assert from "node:assert/strict";
import { errorDetail } from "./error-detail";

test("the cause chain is kept with each error's code, so a pooler failure names its real reason", () => {
  const pg = Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01", severity: "FATAL" });
  const wrapped = new Error('Failed query: select "id" from "users" where "username" = $1\nparams: someone@example.com', { cause: pg });
  const detail = errorDetail(wrapped) as Record<string, unknown>;
  const cause = detail.cause as Record<string, unknown>;
  assert.equal(cause.message, "terminating connection due to administrator command");
  assert.equal(cause.code, "57P01");
  assert.equal(cause.severity, "FATAL");
});

test("query parameters are left out of the log, because they carry members' data", () => {
  const wrapped = new Error('Failed query: update "users" set "password_hash" = $1 where "id" = $2\nparams: scrypt$abc$def,7');
  const text = JSON.stringify(errorDetail(wrapped));
  assert.ok(!text.includes("scrypt$abc$def"), text);
  assert.ok(text.includes('update \\"users\\" set'), "the query text stays");
});

test("a value that is not an Error is logged as text, and a cause cycle ends", () => {
  assert.equal(errorDetail("boom"), "boom");
  const a = new Error("a");
  const b = new Error("b", { cause: a });
  (a as { cause?: unknown }).cause = b;
  assert.doesNotThrow(() => JSON.stringify(errorDetail(a)));
});
