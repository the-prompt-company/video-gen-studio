// Member import (.xlsx) fixtures: `node scripts/import-fixtures.mjs [outDir] [stamp]`.
// Every email is vgs-imp-<stamp>-<n>@example.test, so a run can find and delete exactly what it created.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import writeExcelFile from "write-excel-file/node";

export const importEmail = (stamp, n) => `vgs-imp-${stamp}-${n}@example.test`;

export function importFixtures(stamp) {
  const email = (n) => importEmail(stamp, n);
  return {
    "english-headers.xlsx": [
      ["nickname", "email"],
      ["김민지", email(1)],
      ["Park Joon", email(2)],
      ["이서연", email(3)],
    ],
    "korean-headers.xlsx": [
      ["닉네임", "이메일"],
      ["정하늘", email(10)],
      ["오세훈", email(11)],
    ],
    "mixed.xlsx": [
      [null],
      [null],
      ["부서", " EMAIL ", "Nickname", "메모"],
      ["디자인", email(4).toUpperCase(), "  최유나  ", "대문자 이메일"],
      [null],
      ["영상", `  ${email(5)} `, "한지호", "앞뒤 공백"],
      ["영상", email(4), "중복", "4행과 같은 이메일"],
      ["디자인", email(1), "이미 있음", "english-headers로 만든 계정"],
      [null, "not-an-email", "형식 오류", "잘못된 이메일"],
      [null, email(6), "   ", "빈 닉네임"],
      [null, email(7), "가".repeat(31), "31자 닉네임"],
      [null, email(8), "줄\n바꿈", "제어 문자"],
      [null, null, null, "다른 열만 있음"],
    ],
    "too-many.xlsx": [["nickname", "email"], ...Array.from({ length: 201 }, (_, i) => [`회원 ${i + 1}`, email(100 + i)])],
    "missing-column.xlsx": [
      ["이름", "메일", "nickname"],
      ["김민지", email(9), "민지"],
    ],
  };
}

export async function writeImportFixtures(outDir, stamp) {
  mkdirSync(outDir, { recursive: true });
  /** @type {Record<string, string>} */
  const files = {};
  for (const [name, rows] of Object.entries(importFixtures(stamp))) {
    files[name] = join(outDir, name);
    await writeExcelFile(rows).toFile(files[name]);
  }
  return files;
}

// No top-level await: the unit tests load this file through require().
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const outDir = resolve(process.argv[2] ?? ".verify/import-fixtures");
  const stamp = process.argv[3] ?? randomBytes(3).toString("hex");
  writeImportFixtures(outDir, stamp).then((files) => console.log(JSON.stringify({ stamp, files }, null, 2)));
}
