import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSheet } from "read-excel-file/node";
import { importEmail, writeImportFixtures } from "../../scripts/import-fixtures.mjs";
import { membersFromSheet, type SheetMember } from "./member-sheet";

function membersOf(rows: unknown[][]): SheetMember[] {
  const read = membersFromSheet(rows);
  assert.equal(read.ok, true, read.ok ? "" : read.error);
  return read.ok ? read.members : [];
}

function errorOf(rows: unknown[][]): string {
  const read = membersFromSheet(rows);
  assert.equal(read.ok, false);
  return read.ok ? "" : read.error;
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

test("a missing email column is an error that names the missing column and the headers found", () => {
  const error = errorOf([["이름", "메일", "nickname"], ["김민지", "minji@example.com", "민지"]]);
  assert.match(error, /email\(또는 이메일\) 열이 없습니다/);
  assert.match(error, /찾은 제목: 이름, 메일, nickname/);
  assert.doesNotMatch(error, /nickname\(또는 닉네임\)/);
});

test("a header row with neither column names both, and the row it read as the header", () => {
  const error = errorOf([[null], ["이름", "메일"]]);
  assert.match(error, /nickname\(또는 닉네임\)과 email\(또는 이메일\) 열이 없습니다/);
  assert.match(error, /^2행을 제목 줄로/);
});

test("an empty sheet is an error that says what the first row needs", () => {
  assert.match(errorOf([]), /nickname/);
  assert.match(errorOf([[null, null], [" "]]), /비어/);
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

    const many = await read("too-many.xlsx");
    assert.equal(many.ok && many.members.length, 201);

    const missing = await read("missing-column.xlsx");
    assert.match(missing.ok ? "" : missing.error, /이름, 메일, nickname/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
