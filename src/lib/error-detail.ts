/** Fields postgres-js and Node put on database and socket errors; they name why a query failed. */
const FIELDS = ["code", "severity", "detail", "hint", "routine", "errno", "syscall", "address"] as const;
const MAX_DEPTH = 4;

/** Drizzle's "Failed query" message ends with the bound parameters, which can be members' emails or password hashes. */
function withoutParams(text: string): string {
  return text.replace(/\nparams: [\s\S]*?(?=\n    at |$)/, "\nparams: [redacted]");
}

/** A loggable view of an error and its causes: the top error's stack, then each cause's message and codes. */
export function errorDetail(e: unknown, depth = 0): Record<string, unknown> | string {
  if (!(e instanceof Error)) return String(e);
  const out: Record<string, unknown> = { name: e.name, message: withoutParams(e.message) };
  if (depth === 0 && e.stack) out.stack = withoutParams(e.stack);
  const fields = e as unknown as Record<string, unknown>;
  for (const f of FIELDS) if (fields[f] !== undefined) out[f] = fields[f];
  if (e.cause !== undefined && depth < MAX_DEPTH) out.cause = errorDetail(e.cause, depth + 1);
  return out;
}
