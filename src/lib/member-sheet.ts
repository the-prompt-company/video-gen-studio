export type SheetMember = { sheetRow: number; nickname: string; email: string };

export type SheetRead = { ok: true; members: SheetMember[] } | { ok: false; error: string };

const COLUMNS = {
  nickname: { names: ["nickname", "닉네임"], label: "nickname(또는 닉네임)" },
  email: { names: ["email", "이메일"], label: "email(또는 이메일)" },
} as const;

function cellText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

const isBlank = (value: unknown) => cellText(value).trim() === "";

/** Finds the nickname and email columns by header and passes their cells on untouched; the server judges every value. */
export function membersFromSheet(rows: readonly (readonly unknown[])[]): SheetRead {
  const headerIndex = rows.findIndex((row) => !row.every(isBlank));
  if (headerIndex === -1) {
    return { ok: false, error: "시트가 비어 있습니다. 첫 줄에 nickname과 email(또는 닉네임과 이메일) 제목을 쓰고, 그 아래에 회원을 한 줄에 한 명씩 적으세요" };
  }
  const header = rows[headerIndex].map((cell) => cellText(cell).normalize("NFC").trim().toLowerCase());
  const nicknameColumn = header.findIndex((h) => (COLUMNS.nickname.names as readonly string[]).includes(h));
  const emailColumn = header.findIndex((h) => (COLUMNS.email.names as readonly string[]).includes(h));
  if (nicknameColumn === -1 || emailColumn === -1) {
    const missing = [nicknameColumn === -1 && COLUMNS.nickname.label, emailColumn === -1 && COLUMNS.email.label].filter(Boolean).join("과 ");
    const found = rows[headerIndex].map((cell) => cellText(cell).trim()).filter(Boolean).join(", ");
    return { ok: false, error: `${headerIndex + 1}행을 제목 줄로 읽었는데 ${missing} 열이 없습니다 (찾은 제목: ${found}). 제목 칸을 고친 뒤 파일을 다시 고르세요` };
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
