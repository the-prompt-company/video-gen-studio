import type { PublicGeneration } from "@/lib/generations";
import type { Reference } from "@/lib/references";

const THREAD_MAX = 12;
const RECENT_MAX = 12;

/** The "@" just before the caret, if it starts a word: typed, pasted over a selection, or reached by deleting. */
export function typedMention(text: string, caret: number): number | null {
  const at = caret - 1;
  if (text[at] !== "@") return null;
  return at === 0 || /\s/u.test(text[at - 1]) ? at : null;
}

/** What follows the "@" at `start` up to the caret, or null once the caret leaves that word. */
export function mentionQuery(text: string, start: number, caret: number): string | null {
  if (text[start] !== "@" || caret <= start) return null;
  const query = text.slice(start + 1, caret);
  return /\s/u.test(query) ? null : query;
}

/**
 * The prompt without the "@" word up to the caret, and where the caret goes. No token stays behind: the Seedance 2.0 and
 * MiniMax H3 reference-to-video API references document no prompt syntax that names a reference (open.higgsfield.ai,
 * read 2026-10-31).
 */
export function withoutMention(text: string, start: number, caret: number): { text: string; caret: number } {
  return { text: text.slice(0, start) + text.slice(caret), caret: start };
}

/** What the picker offers: this thread's results, then the member's other recent ones. */
export function pickable(thread: readonly PublicGeneration[], recent: readonly PublicGeneration[], takes: readonly Reference["kind"][], query: string) {
  const q = query.trim().toLocaleLowerCase();
  const offered = (g: PublicGeneration) => g.ref != null && takes.includes(g.ref.kind) && g.prompt.toLocaleLowerCase().includes(q);
  const here = thread.filter(offered).slice(0, THREAD_MAX);
  const shown = new Set(here.map((g) => g.id));
  return { thread: here, recent: recent.filter((g) => !shown.has(g.id) && offered(g)).slice(0, RECENT_MAX) };
}
