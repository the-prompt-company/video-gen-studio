export type SheetMember = { sheetRow: number; nickname: string; email: string };

/** The header each column takes. An admin types either spelling in the sheet, so messages quote both as they are in every language. */
export const COLUMNS = {
  nickname: {
    header: "nickname",
    // eslint-disable-next-line i18n/no-hangul -- header aliases an admin types in a sheet, not screen text
    alias: "닉네임",
  },
  email: {
    header: "email",
    // eslint-disable-next-line i18n/no-hangul -- header aliases an admin types in a sheet, not screen text
    alias: "이메일",
  },
} as const;

export type Column = keyof typeof COLUMNS;

/** Why a sheet gave no members. `headerRow` counts from 1, as the sheet numbers its rows; `found` is the header row's non-blank cells. */
export type SheetProblem = { kind: "empty" } | { kind: "missingColumns"; headerRow: number; missing: Column | "both"; found: string[] };

export type SheetRead = { ok: true; members: SheetMember[] } | { ok: false; problem: SheetProblem };

function cellText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

const isBlank = (value: unknown) => cellText(value).trim() === "";

/** Finds the nickname and email columns by header and passes their cells on untouched; the server judges every value. */
export function membersFromSheet(rows: readonly (readonly unknown[])[]): SheetRead {
  const headerIndex = rows.findIndex((row) => !row.every(isBlank));
  if (headerIndex === -1) return { ok: false, problem: { kind: "empty" } };
  const header = rows[headerIndex].map((cell) => cellText(cell).normalize("NFC").trim().toLowerCase());
  const columnOf = (column: Column) => header.findIndex((h) => h === COLUMNS[column].header || h === COLUMNS[column].alias);
  const nicknameColumn = columnOf("nickname");
  const emailColumn = columnOf("email");
  if (nicknameColumn === -1 || emailColumn === -1) {
    const missing = nicknameColumn !== -1 ? "email" : emailColumn !== -1 ? "nickname" : "both";
    const found = rows[headerIndex].map((cell) => cellText(cell).trim()).filter(Boolean);
    return { ok: false, problem: { kind: "missingColumns", headerRow: headerIndex + 1, missing, found } };
  }

  const members: SheetMember[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const nickname = rows[i][nicknameColumn];
    const email = rows[i][emailColumn];
    if (isBlank(nickname) && isBlank(email)) continue;
    members.push({ sheetRow: i + 1, nickname: cellText(nickname), email: cellText(email) });
  }
  return { ok: true, members };
}
