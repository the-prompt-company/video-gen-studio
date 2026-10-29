import { loginId } from "./credentials";
import { parseNickname } from "./nickname";

export const MAX_IMPORT_ROWS = 200;

const MAX_ID_LENGTH = 80;
const EMAIL = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export type ImportRow = { nickname: string; email: string };

export type PlannedRow =
  | { outcome: "create"; username: string; nickname: string }
  | { outcome: "exists"; username: string }
  | { outcome: "duplicate"; username: string; firstIndex: number }
  | { outcome: "invalid"; reason: string };

export type ImportResult = PlannedRow | { outcome: "created"; username: string; nickname: string };

export type ImportResponse = { dryRun: boolean; results: ImportResult[] };

export type ImportRequest = { ok: true; rows: ImportRow[]; dryRun: boolean } | { ok: false; error: string };

function cellText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function parseImportRequest(body: unknown): ImportRequest {
  const b = (body && typeof body === "object" ? body : {}) as { rows?: unknown; dryRun?: unknown };
  if (!Array.isArray(b.rows)) return { ok: false, error: "rows 배열이 필요합니다" };
  if (b.rows.length === 0) return { ok: false, error: "만들 회원이 없습니다. 제목 줄 아래에 회원을 한 줄에 한 명씩 적으세요" };
  if (b.rows.length > MAX_IMPORT_ROWS) {
    return { ok: false, error: `한 번에 ${MAX_IMPORT_ROWS}명까지 만들 수 있는데 이 파일은 ${b.rows.length}명입니다. 파일을 ${MAX_IMPORT_ROWS}명씩 나눠 올리세요` };
  }
  const rows = b.rows.map((r: unknown) => {
    const cells = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    return { nickname: cellText(cells.nickname), email: cellText(cells.email) };
  });
  return { ok: true, rows, dryRun: b.dryRun !== false };
}

export function importUsername(row: ImportRow): string {
  return loginId(row.email);
}

function emailError(username: string): string | null {
  if (!username) return "이메일이 비어 있습니다";
  if (!EMAIL.test(username)) return "이메일 형식이 아닙니다 (예: name@company.com)";
  if (username.length > MAX_ID_LENGTH) return `이메일이 ${MAX_ID_LENGTH}자를 넘습니다`;
  return null;
}

export function planImport(rows: ImportRow[], existingUsernames: ReadonlySet<string>): PlannedRow[] {
  const firstIndex = new Map<string, number>();
  return rows.map((row, index): PlannedRow => {
    const username = importUsername(row);
    const emailProblem = emailError(username);
    if (emailProblem) return { outcome: "invalid", reason: emailProblem };
    const first = firstIndex.get(username);
    if (first !== undefined) return { outcome: "duplicate", username, firstIndex: first };
    firstIndex.set(username, index);
    if (existingUsernames.has(username)) return { outcome: "exists", username };
    const nickname = parseNickname(row.nickname);
    if (!nickname.ok) return { outcome: "invalid", reason: nickname.reason };
    return { outcome: "create", username, nickname: nickname.nickname };
  });
}

/** A planned row the insert skipped lost a race with another create of the same ID. */
export function settleImport(plan: PlannedRow[], insertedUsernames: ReadonlySet<string>): ImportResult[] {
  return plan.map((row) => {
    if (row.outcome !== "create") return row;
    return insertedUsernames.has(row.username) ? { ...row, outcome: "created" } : { outcome: "exists", username: row.username };
  });
}
