import type { Messages } from "next-intl";
import { getMessages } from "next-intl/server";

type Namespace = keyof Messages;

/** What client components on any page read: the shell, sign-in, errors, the parameter names errors quote, and contact. */
const SHARED: readonly Namespace[] = ["pages", "common", "nav", "status", "language", "auth", "errors", "params", "contact"];

/**
 * Each namespace is the object getMessages() returned, not a copy, so React's server payload can send a namespace that
 * two providers share once and refer back to it.
 */
async function pick(namespaces: readonly Namespace[]): Promise<Partial<Messages>> {
  const all = await getMessages();
  return Object.fromEntries(namespaces.map((ns) => [ns, all[ns]])) as Partial<Messages>;
}

/**
 * The root layout's provider messages. The layout awaits them itself: a separate async component around the page
 * delayed the new `<title>` after a language pick's refresh.
 */
export function sharedMessages(): Promise<Partial<Messages>> {
  return pick(SHARED);
}

/** A page's provider messages. A nested provider replaces the messages above it rather than merging, so these carry SHARED too. */
export function pageMessages(namespaces: readonly Namespace[]): Promise<Partial<Messages>> {
  return pick([...SHARED, ...namespaces]);
}
