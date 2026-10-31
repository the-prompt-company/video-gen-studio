import { defaultParams, FAMILIES, paramsWithDefaults, type Draft, type FamilyId, type Mode, type ModeKind } from "@/lib/catalog";

/**
 * `url` is null until the upload answers. `blob`: uploaded to our Blob store, whose references a Higgsfield row
 * deletes when it ends.
 */
type AttachmentBase = { id: string; name: string; preview: string; url: string | null; blob: boolean };

export type Attachment = AttachmentBase & ({ kind: "image"; w: number | null; h: number | null } | { kind: "video"; seconds: number });

export type Attachments =
  | { kind: "text" }
  | { kind: "firstFrame"; start: Attachment | null; end: Attachment | null }
  | { kind: "reference"; items: readonly Attachment[] };

export type Slot = "start" | "end";

/** `removed` holds what 되돌리기 puts back, until the member next adds or removes an attachment or changes the model. */
export type Note =
  | { kind: "switched"; mode: Mode }
  | { kind: "removed"; count: number; restore: Attachments }
  | { kind: "reused"; needsAttachments: boolean }
  | { kind: "spent"; count: number };

export type Composer = { family: FamilyId; params: Readonly<Record<string, unknown>>; attach: Attachments; note: Note | null };

export type Refusal = { reason: "full"; kind: "image" | "video"; max: number } | { reason: "noVideos" } | { reason: "framesTakeImages" } | { reason: "framesFull" };

export type Action =
  | { type: "family"; family: FamilyId }
  | { type: "mode"; kind: ModeKind }
  | { type: "param"; key: string; value: unknown }
  | { type: "add"; items: readonly Attachment[]; slot?: Slot }
  | { type: "uploaded"; id: string; url: string }
  /** The member took it off, which also ends the chance to undo. */
  | { type: "remove"; id: string }
  /** Its upload failed: gone from the attachments and from what 되돌리기 restores. */
  | { type: "failed"; id: string }
  | { type: "undo" }
  /** A submit went. The Blob references a Higgsfield row was sent with are deleted when it ends, so they leave. */
  | { type: "sent" }
  | { type: "reuse"; family: FamilyId; kind: ModeKind; params: Readonly<Record<string, unknown>> };

const EMPTY: Record<ModeKind, Attachments> = {
  text: { kind: "text" },
  firstFrame: { kind: "firstFrame", start: null, end: null },
  reference: { kind: "reference", items: [] },
};

export function newComposer(family: FamilyId): Composer {
  return { family, params: defaultParams(family), attach: EMPTY.text, note: null };
}

export function attachmentsOf(a: Attachments): Attachment[] {
  if (a.kind === "text") return [];
  if (a.kind === "reference") return [...a.items];
  return [a.start, a.end].filter((x): x is Attachment => x !== null);
}

export function modeOfComposer(c: Composer): Mode {
  const modes = FAMILIES[c.family].modes;
  return modes[c.attach.kind] ?? modes.reference;
}

export function uploading(c: Composer): boolean {
  return attachmentsOf(c.attach).some((a) => a.url === null);
}

/** An attachment still uploading stands in with its preview URL, so counts and costs are right before it lands. */
export function draftOf(c: Composer, prompt: string): Draft {
  const url = (a: Attachment) => a.url ?? a.preview;
  const base = { family: c.family, mode: modeOfComposer(c), prompt, params: c.params };
  const a = c.attach;
  if (a.kind === "text") return { ...base, images: [], videos: [], endImage: null };
  if (a.kind === "firstFrame") return { ...base, images: a.start ? [url(a.start)] : [], videos: [], endImage: a.end ? url(a.end) : null };
  return {
    ...base,
    images: a.items.filter((x) => x.kind === "image").map(url),
    videos: a.items.flatMap((x) => (x.kind === "video" ? [{ url: url(x), seconds: x.seconds }] : [])),
    endImage: null,
  };
}

function toKind(c: Composer, kind: ModeKind): Composer {
  if (c.attach.kind === kind) return c;
  const all = attachmentsOf(c.attach);
  let attach: Attachments;
  if (kind === "text") attach = EMPTY.text;
  else if (kind === "reference") attach = { kind, items: all };
  else {
    const images = all.filter((x) => x.kind === "image");
    attach = { kind, start: images[0] ?? null, end: FAMILIES[c.family].modes.endFrame ? (images[1] ?? null) : null };
  }
  const dropped = all.length - attachmentsOf(attach).length;
  return { ...c, attach, note: dropped > 0 ? { kind: "removed", count: dropped, restore: c.attach } : null };
}

/** Attaching in text mode switches to references. `placed` are the items to upload. */
export function fit(c: Composer, items: readonly Attachment[], slot?: Slot): { composer: Composer; placed: Attachment[]; refused: Refusal[] } {
  const family = FAMILIES[c.family];
  const placed: Attachment[] = [];
  const refused: Refusal[] = [];
  const switched = c.attach.kind === "text";
  const attach = c.attach.kind === "text" ? EMPTY.reference : c.attach;
  let next: Attachments;
  if (attach.kind === "firstFrame") {
    const slots = { start: attach.start, end: attach.end };
    const open = (s: Slot) => slots[s] === null && (s === "start" || family.modes.endFrame);
    for (const item of items) {
      if (item.kind === "video") {
        refused.push({ reason: "framesTakeImages" });
        continue;
      }
      const target = slot && open(slot) ? slot : open("start") ? "start" : open("end") ? "end" : null;
      if (!target) {
        refused.push({ reason: "framesFull" });
        continue;
      }
      slots[target] = item;
      placed.push(item);
    }
    next = { kind: "firstFrame", ...slots };
  } else {
    const list = attach.kind === "reference" ? [...attach.items] : [];
    for (const item of items) {
      const max = item.kind === "image" ? family.maxImages : family.maxVideos;
      if (item.kind === "video" && max === 0) refused.push({ reason: "noVideos" });
      else if (list.filter((x) => x.kind === item.kind).length >= max) refused.push({ reason: "full", kind: item.kind, max });
      else {
        list.push(item);
        placed.push(item);
      }
    }
    next = { kind: "reference", items: list };
  }
  if (placed.length === 0) return { composer: c, placed, refused };
  const note: Note | null = switched ? { kind: "switched", mode: family.modes.reference } : c.note?.kind === "switched" ? c.note : null;
  return { composer: { ...c, attach: next, note }, placed, refused };
}

function mapAttachments(a: Attachments, f: (x: Attachment) => Attachment | null): Attachments {
  if (a.kind === "text") return a;
  if (a.kind === "reference") return { kind: "reference", items: a.items.map(f).filter((x): x is Attachment => x !== null) };
  return { kind: "firstFrame", start: a.start && f(a.start), end: a.end && f(a.end) };
}

/** The note's restore too: an upload can land after a switch moved its attachment there. */
function everywhere(c: Composer, f: (x: Attachment) => Attachment | null): Composer {
  const attach = mapAttachments(c.attach, f);
  if (c.note?.kind !== "removed") return { ...c, attach };
  const restore = mapAttachments(c.note.restore, f);
  const kept = new Set(attachmentsOf(attach).map((x) => x.id));
  const count = attachmentsOf(restore).filter((x) => !kept.has(x.id)).length;
  return { ...c, attach, note: count > 0 ? { ...c.note, restore, count } : null };
}

export function composerReducer(c: Composer, action: Action): Composer {
  switch (action.type) {
    case "family": {
      if (action.family === c.family) return c;
      const hasKind = FAMILIES[action.family].modes[c.attach.kind] !== null;
      const attach: Attachments = hasKind ? c.attach : { kind: "reference", items: attachmentsOf(c.attach) };
      return { family: action.family, params: defaultParams(action.family), attach, note: null };
    }
    case "mode":
      return FAMILIES[c.family].modes[action.kind] ? toKind(c, action.kind) : c;
    case "param":
      return { ...c, params: { ...c.params, [action.key]: action.value } };
    case "add":
      return fit(c, action.items, action.slot).composer;
    case "uploaded":
      return everywhere(c, (x) => (x.id === action.id ? { ...x, url: action.url } : x));
    case "failed":
      return everywhere(c, (x) => (x.id === action.id ? null : x));
    case "remove":
      return { ...c, attach: mapAttachments(c.attach, (x) => (x.id === action.id ? null : x)), note: null };
    case "undo":
      return c.note?.kind === "removed" ? { ...c, attach: c.note.restore, note: null } : c;
    case "sent": {
      if (FAMILIES[c.family].provider !== "higgsfield") return c.note ? { ...c, note: null } : c;
      const spent = attachmentsOf(c.attach).filter((x) => x.blob).length;
      return { ...c, attach: mapAttachments(c.attach, (x) => (x.blob ? null : x)), note: spent > 0 ? { kind: "spent", count: spent } : null };
    }
    case "reuse": {
      const kind = FAMILIES[action.family].modes[action.kind] ? action.kind : "reference";
      return {
        family: action.family,
        params: paramsWithDefaults(action.family, action.params),
        attach: EMPTY[kind],
        note: { kind: "reused", needsAttachments: kind !== "text" },
      };
    }
  }
}
