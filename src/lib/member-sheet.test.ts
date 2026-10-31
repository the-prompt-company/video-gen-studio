import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSheet } from "read-excel-file/node";
import { importEmail, writeImportFixtures } from "../../scripts/import-fixtures.mjs";
import { membersFromSheet, type SheetMember, type SheetProblem } from "./member-sheet";

function membersOf(rows: unknown[][]): SheetMember[] {
  const read = membersFromSheet(rows);
  assert.equal(read.ok, true, read.ok ? "" : JSON.stringify(read.problem));
  return read.ok ? read.members : [];
}

function problemOf(rows: unknown[][]): SheetProblem | null {
  const read = membersFromSheet(rows);
  assert.equal(read.ok, false);
  return read.ok ? null : read.problem;
}

test("English headers in the first row give one member per row, numbered as the sheet numbers rows", () => {
  assert.deepEqual(membersOf([["nickname", "email"], ["김민지", "minji@example.com"], ["박준", "joon@example.com"]]), [
    { sheetRow: 2, nickname: "김민지", email: "minji@example.com" },
    { sheetRow: 3, nickname: "박준", email: "joon@example.com" },
  ]);
});

test("Korean headers 닉네임 and 이메일 work the same", () => {
  assert.deepEqual(membersOf([["닉네임", "이메일"], ["김민지", "minji@example.com"]]), [{ sheetRow: 2, nickname: "김민지", email: "minji@example.com" }]);
});

test("headers match trimmed and in any case, in any column order, and other columns are ignored", () => {
  assert.deepEqual(membersOf([["부서", " EMAIL ", "NickName ", "메모"], ["디자인", "minji@example.com", "김민지", "팀장"]]), [
    { sheetRow: 2, nickname: "김민지", email: "minji@example.com" },
  ]);
});

test("the header is the first non-empty row, and blank rows before it still count toward row numbers", () => {
  assert.deepEqual(membersOf([[null, null], ["", "  "], ["nickname", "email"], ["김민지", "minji@example.com"]]), [
    { sheetRow: 4, nickname: "김민지", email: "minji@example.com" },
  ]);
});

test("rows whose nickname and email are both blank are skipped, even when another column has text", () => {
  const members = membersOf([["nickname", "email", "메모"], ["김민지", "minji@example.com", null], [null, null, null], [" ", "", "메모만"], ["박준", "joon@example.com", null]]);
  assert.deepEqual(members.map((m) => m.sheetRow), [2, 5]);
});

test("a row with only one of nickname or email is kept for the server to judge", () => {
  assert.deepEqual(membersOf([["nickname", "email"], ["김민지", null], [null, "joon@example.com"]]), [
    { sheetRow: 2, nickname: "김민지", email: "" },
    { sheetRow: 3, nickname: "", email: "joon@example.com" },
  ]);
});

test("cell text is passed on as written, untrimmed, and numbers become text", () => {
  assert.deepEqual(membersOf([["nickname", "email"], ["  김민지 ", " Minji@Example.com "], [2026, "n@example.com"]]), [
    { sheetRow: 2, nickname: "  김민지 ", email: " Minji@Example.com " },
    { sheetRow: 3, nickname: "2026", email: "n@example.com" },
  ]);
});

test("a missing email column is a problem that names the missing column and the headers found", () => {
  assert.deepEqual(problemOf([["이름", "메일", "nickname"], ["김민지", "minji@example.com", "민지"]]), {
    kind: "missingColumns",
    headerRow: 1,
    missing: "email",
    found: ["이름", "메일", "nickname"],
  });
});

test("a missing nickname column is named alone, and the Korean email header counts as found", () => {
  assert.deepEqual(problemOf([[" 이름 ", null, "이메일"], ["김민지", null, "minji@example.com"]]), {
    kind: "missingColumns",
    headerRow: 1,
    missing: "nickname",
    found: ["이름", "이메일"],
  });
});

test("a header row with neither column names both, and the row it read as the header", () => {
  assert.deepEqual(problemOf([[null], ["이름", "메일"]]), { kind: "missingColumns", headerRow: 2, missing: "both", found: ["이름", "메일"] });
});

test("a sheet with no filled row is the empty problem", () => {
  assert.deepEqual(problemOf([]), { kind: "empty" });
  assert.deepEqual(problemOf([[null, null], [" "]]), { kind: "empty" });
});

test("the generated .xlsx fixtures read back through read-excel-file as the admin wrote them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vgs-imp-"));
  try {
    const files = await writeImportFixtures(dir, "t");
    const read = async (name: string) => membersFromSheet(await readSheet(files[name], { trim: false }));

    const english = await read("english-headers.xlsx");
    assert.deepEqual(english.ok && english.members.map((m) => [m.sheetRow, m.email]), [
      [2, importEmail("t", 1)],
      [3, importEmail("t", 2)],
      [4, importEmail("t", 3)],
    ]);

    const korean = await read("korean-headers.xlsx");
    assert.deepEqual(korean.ok && korean.members.map((m) => m.nickname), ["정하늘", "오세훈"]);

    const mixed = await read("mixed.xlsx");
    assert.equal(mixed.ok, true);
    const members = mixed.ok ? mixed.members : [];
    assert.deepEqual(members.map((m) => m.sheetRow), [4, 6, 7, 8, 9, 10, 11, 12]);
    assert.deepEqual(members[0], { sheetRow: 4, nickname: "  최유나  ", email: importEmail("t", 4).toUpperCase() });
    assert.equal(members[7].nickname, "줄\n바꿈");

    const full = await read("two-hundred.xlsx");
    assert.equal(full.ok && full.members.length, 200);
    const many = await read("too-many.xlsx");
    assert.equal(many.ok && many.members.length, 201);

    const missing = await read("missing-column.xlsx");
    assert.deepEqual(missing.ok ? null : missing.problem, { kind: "missingColumns", headerRow: 1, missing: "email", found: ["이름", "메일", "nickname"] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
