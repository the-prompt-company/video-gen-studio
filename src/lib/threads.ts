// The playground imports this module too, so it must stay free of server-only imports. Queries live in thread-store.ts.

export type ThreadId = string & { readonly __brand: "ThreadId" };

/**
 * Which thread a request means. `earlier` is the member's earlier history: the generations made before threads, which
 * no thread row holds. A `chat` thread is a row, named by the id the browser chose before its first generation.
 */
export type ThreadRef = { kind: "earlier" } | { kind: "chat"; id: ThreadId };

/** A thread as the playground lists it. An empty title means the first prompt was empty. */
export type PublicThread = { kind: "earlier"; id: typeof EARLIER } | { kind: "chat"; id: ThreadId; title: string };

/** The earlier history's id in URLs and on the wire. */
export const EARLIER = "earlier";

/** Graphemes of the first prompt a title keeps before it is cut. */
export const TITLE_GRAPHEMES = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `earlier`, or a uuid as a chat thread in lower case. Anything else names no thread. */
export function parseThreadRef(raw: unknown): ThreadRef | null {
  if (raw === EARLIER) return { kind: "earlier" };
  if (typeof raw !== "string" || !UUID.test(raw)) return null;
  return { kind: "chat", id: raw.toLowerCase() as ThreadId };
}

/** A thread's title: the first prompt with its whitespace collapsed, cut after TITLE_GRAPHEMES graphemes with "…". */
export function threadTitle(prompt: string): string {
  const text = prompt.replace(/\s+/g, " ").trim();
  const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
  if (graphemes.length <= TITLE_GRAPHEMES) return text;
  return `${graphemes.slice(0, TITLE_GRAPHEMES).join("").trimEnd()}…`;
}
