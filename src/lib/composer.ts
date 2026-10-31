import { defaultParams, describeModel, FAMILIES, paramsWithDefaults, planGeneration, type Draft, type FamilyId, type Mode, type Plan } from "@/lib/catalog";
import { appError } from "@/lib/errors";

/**
 * `url` is null until the upload answers, or until a stored image 다시 put back is known to still load. `refUpload`:
 * uploaded under the member's refs/<id>/ in our Blob store, which a Higgsfield row deletes when it ends.
 */
type AttachmentBase = { id: string; name: string; preview: string; url: string | null; refUpload: boolean };

export type Attachment = AttachmentBase & ({ kind: "image"; w: number | null; h: number | null } | { kind: "video"; seconds: number });
type Image = Extract<Attachment, { kind: "image" }>;

/** A frame an attached image can be marked as. Image to video starts on `start` and ends on `end`. */
export type Role = "start" | "end";

/** The image that holds each role, by attachment id. One image may hold both, which loops the video. */
export type Frames = Readonly<Record<Role, string | null>>;

const NO_FRAMES: Frames = { start: null, end: null };

export type Note =
  /** A model change took the frame marks off, because the new model takes no frames. */
  | { kind: "unmarked"; family: FamilyId }
  /** 다시. `refs`: what came back with the settings, or that the turn's attachments did not. */
  | { kind: "reused"; refs: "none" | "frames" | "missing" }
  | { kind: "spent"; count: number };

export type Composer = { family: FamilyId; params: Readonly<Record<string, unknown>>; items: readonly Attachment[]; frames: Frames; note: Note | null };

export type Refusal =
  | { reason: "full"; kind: "image" | "video"; max: number }
  | { reason: "noVideos" }
  /** The attachments already hold this URL. */
  | { reason: "attached" };

export type Action =
  | { type: "family"; family: FamilyId }
  | { type: "param"; key: string; value: unknown }
  | { type: "add"; items: readonly Attachment[] }
  | { type: "uploaded"; id: string; url: string }
  /** Marks the image `id` as `role`, taking the role from any other image; null takes the role off. */
  | { type: "frame"; role: Role; id: string | null }
  | { type: "remove"; id: string }
  /** Its upload failed. */
  | { type: "failed"; id: string }
  /** A submit carrying `ids` went. The Blob references a Higgsfield row was sent with are deleted when it ends, so they leave. */
  | { type: "sent"; ids: readonly string[] }
  /** 다시: the turn's model and settings, its frames until they are checked, and whether attachments did not come back. */
  | { type: "reuse"; family: FamilyId; params: Readonly<Record<string, unknown>>; start: Image | null; end: Image | null; missing: boolean }
  /** A frame 다시 put back answered: its size, or null when it no longer loads, which takes it off and says so. */
  | { type: "loaded"; id: string; size: { w: number; h: number } | null };

/** A stored generation as 다시 reads it. */
export type Turn = { modelId: string; params: unknown; imageRefs: readonly string[]; videoRefs: readonly string[] };

/** The file name at the end of a URL. */
function nameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || url;
  } catch {
    return url;
  }
}

/**
 * 다시 for `turn`: its model when offered (else `current`, with that model's defaults), and an image-to-video turn's
 * first image as 시작 and second as 끝. A frame `temporary` names (an upload its row deletes when it ends) stays out.
 */
export function reuseOf(turn: Turn, offered: readonly FamilyId[], current: FamilyId, temporary: (url: string) => boolean): Extract<Action, { type: "reuse" }> {
  const m = describeModel(turn.modelId);
  const family = m.family && offered.includes(m.family) ? m.family : current;
  const [startUrl, endUrl] = m.mode === "i2v" && rolesFor(family).length > 0 ? turn.imageRefs : [];
  const frame = (url: string | undefined): Image | null =>
    url && !temporary(url) ? { id: crypto.randomUUID(), kind: "image", name: nameOf(url), preview: url, url: null, refUpload: false, w: null, h: null } : null;
  const start = frame(startUrl);
  const end = endUrl === startUrl ? start : frame(endUrl);
  const back = [start?.preview, end?.preview];
  return {
    type: "reuse",
    family,
    params: m.family === family ? (turn.params as Record<string, unknown>) : {},
    start,
    end,
    missing: [...turn.imageRefs, ...turn.videoRefs].some((u) => !back.includes(u)),
  };
}

/**
 * The files a paste attaches. A clipboard from Word, Excel or PowerPoint carries the text and a picture of it; that
 * pastes as text. Files copied in a file manager carry their names as text and attach.
 */
export function pastedFiles<T extends { name: string }>(files: readonly T[], text: string): T[] {
  return files.length > 0 && (!text.trim() || files.every((f) => text.includes(f.name))) ? [...files] : [];
}

export function newComposer(family: FamilyId): Composer {
  return { family, params: defaultParams(family), items: [], frames: NO_FRAMES, note: null };
}

/** The frames a model's image to video takes. A model without one takes none. */
export function rolesFor(family: FamilyId): readonly Role[] {
  const m = FAMILIES[family].modes;
  return m.firstFrame ? (m.endFrame ? ["start", "end"] : ["start"]) : [];
}

export function rolesOf(c: Composer, id: string): Role[] {
  return rolesFor(c.family).filter((r) => c.frames[r] === id);
}

/** No attachments make the text mode, a marked frame image to video, and anything else the reference mode. */
export function modeOf(c: Composer): Mode {
  const modes = FAMILIES[c.family].modes;
  if (c.items.length === 0) return modes.text;
  return (c.frames.start ?? c.frames.end) && modes.firstFrame ? modes.firstFrame : modes.reference;
}

/** Image to video sends the frames alone, so every other attachment would be left out of the request. */
export function unsent(c: Composer): Attachment[] {
  if (modeOf(c) !== FAMILIES[c.family].modes.firstFrame) return [];
  return c.items.filter((a) => a.id !== c.frames.start && a.id !== c.frames.end);
}

export function takes(c: Composer): ("image" | "video")[] {
  return FAMILIES[c.family].maxVideos === 0 ? ["image"] : ["image", "video"];
}

export function uploading(c: Composer): boolean {
  return c.items.some((a) => a.url === null);
}

/** An attachment still uploading stands in with its preview URL, so counts and costs are right before it lands. */
function draftOf(c: Composer, prompt: string): Draft {
  const url = (a: Attachment) => a.url ?? a.preview;
  const mode = modeOf(c);
  const base = { family: c.family, mode, prompt, params: c.params };
  if (mode === FAMILIES[c.family].modes.firstFrame) {
    const frame = (role: Role) => c.items.find((a) => a.id === c.frames[role]);
    const [start, end] = [frame("start"), frame("end")];
    return { ...base, images: start ? [url(start)] : [], videos: [], endImage: end ? url(end) : null };
  }
  return {
    ...base,
    images: c.items.filter((a) => a.kind === "image").map(url),
    videos: c.items.flatMap((a) => (a.kind === "video" ? [{ url: url(a), seconds: a.seconds }] : [])),
    endImage: null,
  };
}

/**
 * What Generate would send and whether it may. Frames beside other attachments are refused here rather than sent
 * without them: the request never carries less than the composer shows.
 */
export function planOf(c: Composer, prompt: string, rateUsd: number): { draft: Draft; plan: Plan } {
  const draft = draftOf(c, prompt);
  const plan = planGeneration(draft, rateUsd);
  const left = unsent(c).length;
  if (left === 0) return { draft, plan };
  return { draft, plan: { ...plan, ready: false, blocker: appError("framesWithOthers", { count: left }) } };
}

/** `placed` are the items to upload. Every attachment lands as a reference; marking a frame is the member's own step. */
export function fit(c: Composer, items: readonly Attachment[]): { composer: Composer; placed: Attachment[]; refused: Refusal[] } {
  const family = FAMILIES[c.family];
  const list = [...c.items];
  const placed: Attachment[] = [];
  const refused: Refusal[] = [];
  for (const item of items) {
    const max = item.kind === "image" ? family.maxImages : family.maxVideos;
    if (item.kind === "video" && max === 0) refused.push({ reason: "noVideos" });
    else if (item.url !== null && list.some((x) => x.url === item.url)) refused.push({ reason: "attached" });
    else if (list.filter((x) => x.kind === item.kind).length >= max) refused.push({ reason: "full", kind: item.kind, max });
    else {
      list.push(item);
      placed.push(item);
    }
  }
  if (placed.length === 0) return { composer: c, placed, refused };
  return { composer: { ...c, items: list, note: null }, placed, refused };
}

/** The items `keep` passes, with any frame mark on the others taken off. */
function keeping(c: Composer, keep: (a: Attachment) => boolean): Composer {
  const items = c.items.filter(keep);
  const held = (id: string | null) => (id !== null && items.some((a) => a.id === id) ? id : null);
  return { ...c, items, frames: { start: held(c.frames.start), end: held(c.frames.end) } };
}

export function composerReducer(c: Composer, action: Action): Composer {
  switch (action.type) {
    case "family": {
      if (action.family === c.family) return c;
      const roles = rolesFor(action.family);
      const frames: Frames = { start: roles.includes("start") ? c.frames.start : null, end: roles.includes("end") ? c.frames.end : null };
      const unmarked = (c.frames.start !== null && frames.start === null) || (c.frames.end !== null && frames.end === null);
      return { family: action.family, params: defaultParams(action.family), items: c.items, frames, note: unmarked ? { kind: "unmarked", family: action.family } : null };
    }
    case "param":
      return { ...c, params: { ...c.params, [action.key]: action.value } };
    // `fit` already placed these against the composer the uploads started from, so what uploads is what shows.
    case "add":
      return { ...c, items: [...c.items, ...action.items], note: null };
    case "uploaded":
      return { ...c, items: c.items.map((a) => (a.id === action.id ? { ...a, url: action.url } : a)) };
    case "frame": {
      const image = action.id === null || c.items.some((a) => a.id === action.id && a.kind === "image");
      if (!image || !rolesFor(c.family).includes(action.role)) return c;
      return { ...c, frames: { ...c.frames, [action.role]: action.id }, note: null };
    }
    case "remove":
      return { ...keeping(c, (a) => a.id !== action.id), note: null };
    case "failed":
      return keeping(c, (a) => a.id !== action.id);
    case "sent": {
      if (FAMILIES[c.family].provider !== "higgsfield") return c.note ? { ...c, note: null } : c;
      const spent = (a: Attachment) => a.refUpload && action.ids.includes(a.id);
      const count = c.items.filter(spent).length;
      return { ...keeping(c, (a) => !spent(a)), note: count > 0 ? { kind: "spent", count } : null };
    }
    case "loaded": {
      const { size } = action;
      if (!c.items.some((a) => a.id === action.id)) return c;
      if (size) return { ...c, items: c.items.map((a) => (a.id === action.id && a.kind === "image" ? { ...a, url: a.preview, ...size } : a)) };
      return { ...keeping(c, (a) => a.id !== action.id), note: { kind: "reused", refs: "missing" } };
    }
    case "reuse": {
      const roles = rolesFor(action.family);
      const start = roles.includes("start") ? action.start : null;
      const end = roles.includes("end") ? action.end : null;
      const items = [start, end].filter((a, i, all): a is Image => a !== null && all.findIndex((b) => b?.id === a.id) === i);
      return {
        family: action.family,
        params: paramsWithDefaults(action.family, action.params),
        items,
        frames: { start: start?.id ?? null, end: end?.id ?? null },
        note: { kind: "reused", refs: action.missing || start !== action.start || end !== action.end ? "missing" : items.length > 0 ? "frames" : "none" },
      };
    }
  }
}
