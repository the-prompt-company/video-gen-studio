type Item = { id: string; kind: "image" | "video" };

/** Frame requests send start before end, even when the files were attached in another order. */
export function orderedAttachments<T extends Item>(items: readonly T[], frames: { start: string | null; end: string | null }) {
  const ids = [...new Set([frames.start, frames.end].filter((id): id is string => id !== null))];
  return [...ids.flatMap((id) => items.filter((item) => item.id === id)), ...items.filter((item) => !ids.includes(item.id))];
}

export function attachmentMentions<T extends Item>(items: readonly T[]) {
  const counts = { image: 0, video: 0 };
  return items.map((item) => ({ ...item, token: `@${item.kind} ${++counts[item.kind]}` }));
}

export function insertMention(text: string, start: number, end: number, token: string) {
  const inserted = `${start > 0 && !/\s/.test(text[start - 1]) ? " " : ""}${token} `;
  return { text: text.slice(0, start) + inserted + text.slice(end), caret: start + inserted.length };
}

/** Keep references attached to the same file when a preceding attachment is removed. */
export function remapMentions(text: string, before: readonly Item[], after: readonly Item[]) {
  const next = new Map(attachmentMentions(after).map((a) => [a.id, a.token]));
  const replacements = new Map(attachmentMentions(before).map((a) => [a.token, next.get(a.id) ?? ""]));
  return text.replace(/(?<!\S)@(image|video) [1-9]\d*\b/g, (token) => replacements.get(token) ?? token);
}
