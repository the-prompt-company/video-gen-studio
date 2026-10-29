import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_IMPORT_ROWS, parseImportRequest, planImport, settleImport, type ImportResult } from "./member-import";

const NONE = new Set<string>();
const row = (email: string, nickname = "김민지") => ({ email, nickname });

function reasonOf(result: ImportResult): string {
  assert.equal(result.outcome, "invalid");
  return result.outcome === "invalid" ? result.reason : "";
}

test("a new row is create, with the email trimmed and lowercased as the ID and the nickname trimmed", () => {
  assert.deepEqual(planImport([row("  Kim.Min@Example.COM ", "  김민 ")], NONE), [
    { outcome: "create", username: "kim.min@example.com", nickname: "김민" },
  ]);
});

test("an email that is already an ID is exists, whatever its case in the file", () => {
  assert.deepEqual(planImport([row("Lee@Example.com")], new Set(["lee@example.com"])), [{ outcome: "exists", username: "lee@example.com" }]);
});

test("the same email later in the file is a duplicate of its first row, in any case or spacing, and the first row still counts", () => {
  const plan = planImport([row("a@example.com"), row("b@example.com"), row(" A@EXAMPLE.com ")], NONE);
  assert.deepEqual(plan, [
    { outcome: "create", username: "a@example.com", nickname: "김민지" },
    { outcome: "create", username: "b@example.com", nickname: "김민지" },
    { outcome: "duplicate", username: "a@example.com", firstIndex: 0 },
  ]);
});

test("a repeated existing email is exists once, then duplicate", () => {
  const plan = planImport([row("old@example.com"), row("OLD@example.com")], new Set(["old@example.com"]));
  assert.deepEqual(plan.map((p) => p.outcome), ["exists", "duplicate"]);
});

test("a malformed or empty email is invalid with a Korean reason", () => {
  const bad = ["", "   ", "kim", "kim@", "@example.com", "kim@example", "kim min@example.com", "김민@example.com", "kim@exa mple.com", "kim@@example.com"];
  for (const email of bad) {
    const [result] = planImport([row(email)], NONE);
    assert.match(reasonOf(result), /이메일/, JSON.stringify(email));
  }
});

test("an email longer than an ID may be (80 characters) is invalid", () => {
  const local = "a".repeat(80 - "@example.com".length);
  assert.equal(planImport([row(`${local}@example.com`)], NONE)[0].outcome, "create");
  assert.match(reasonOf(planImport([row(`${local}a@example.com`)], NONE)[0]), /80자/);
});

test("a nickname that is empty after trimming is invalid", () => {
  for (const nickname of ["", "   ", "\t \n"]) {
    assert.match(reasonOf(planImport([row("a@example.com", nickname)], NONE)[0]), /닉네임이 비어/, JSON.stringify(nickname));
  }
});

test("a nickname may be 30 characters, counted per Unicode character so an emoji is one, and not 31", () => {
  assert.equal(planImport([row("a@example.com", "가".repeat(30))], NONE)[0].outcome, "create");
  assert.equal(planImport([row("a@example.com", "😀".repeat(30))], NONE)[0].outcome, "create");
  assert.match(reasonOf(planImport([row("a@example.com", "가".repeat(31))], NONE)[0]), /30자/);
});

test("a nickname with a line break, tab or other control character inside is invalid", () => {
  for (const nickname of ["김\n민", "김\r\n민", "김\t민", "김\u0000민", "김\u007f민"]) {
    assert.match(reasonOf(planImport([row("a@example.com", nickname)], NONE)[0]), /제어 문자/, JSON.stringify(nickname));
  }
});

test("an existing email is exists even when its nickname is bad, since fixing the nickname would not create it", () => {
  assert.equal(planImport([row("old@example.com", "")], new Set(["old@example.com"]))[0].outcome, "exists");
});

test("a bad email is invalid before it can be a duplicate, and a valid repeat after it is not a duplicate of it", () => {
  const plan = planImport([row("kim min@example.com"), row("kimmin@example.com")], NONE);
  assert.deepEqual(plan.map((p) => p.outcome), ["invalid", "create"]);
});

test("after the insert, a planned row the database took is created and one it skipped is exists", () => {
  const plan = planImport([row("new@example.com"), row("raced@example.com"), row("bad"), row("NEW@example.com")], NONE);
  assert.deepEqual(settleImport(plan, new Set(["new@example.com"])), [
    { outcome: "created", username: "new@example.com", nickname: "김민지" },
    { outcome: "exists", username: "raced@example.com" },
    plan[2],
    { outcome: "duplicate", username: "new@example.com", firstIndex: 0 },
  ]);
});

test("a request with 200 rows is accepted and one with 201 is refused with the limit and the count", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => row(`m${i}@example.com`));
  const ok = parseImportRequest({ rows: rows(MAX_IMPORT_ROWS), dryRun: true });
  assert.equal(ok.ok && ok.rows.length, 200);
  const tooMany = parseImportRequest({ rows: rows(MAX_IMPORT_ROWS + 1), dryRun: true });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.ok ? "" : tooMany.error, /200명.*201명/);
});

test("a request without rows, or with none, is refused", () => {
  for (const body of [null, {}, { rows: "x" }, { rows: [] }]) {
    const parsed = parseImportRequest(body);
    assert.equal(parsed.ok, false, JSON.stringify(body));
  }
});

test("only dryRun: false creates; a missing or other dryRun stays a dry run", () => {
  const rows = [row("a@example.com")];
  const dryRunOf = (dryRun: unknown) => {
    const parsed = parseImportRequest({ rows, dryRun });
    return parsed.ok ? parsed.dryRun : undefined;
  };
  assert.equal(dryRunOf(false), false);
  assert.equal(dryRunOf(true), true);
  assert.equal(dryRunOf(undefined), true);
  assert.equal(dryRunOf("false"), true);
});

test("cells that are numbers become text and missing cells become empty", () => {
  const parsed = parseImportRequest({ rows: [{ nickname: 2026, email: "a@example.com" }, { email: null }, "junk"], dryRun: true });
  assert.deepEqual(parsed.ok && parsed.rows, [
    { nickname: "2026", email: "a@example.com" },
    { nickname: "", email: "" },
    { nickname: "", email: "" },
  ]);
});
