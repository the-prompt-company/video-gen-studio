import { inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Generation } from "@/db/schema";
import { HttpError } from "@/lib/auth";
import { describeModel, type Draft } from "@/lib/catalog";
import { appError, type AppError } from "@/lib/errors";
import { SUBMIT_DEADLINE_MIN } from "@/lib/generation-status";
import * as storage from "@/lib/storage";

/** A reference as a generation sends it. A video carries its length, which the estimate counts. */
export type Reference = { kind: "image"; url: string } | { kind: "video"; url: string; seconds: number };

/** Higgsfield deletes a result 7 days after it finished (lib/higgsfield.ts). */
const PROVIDER_KEEPS_MS = 7 * 24 * 3600_000;
/** A pending row may be sent at its submit deadline, and may then wait as long again in Higgsfield's queue. */
const PROVIDER_MARGIN_MS = 2 * SUBMIT_DEADLINE_MIN * 60_000;

/** Host and path: another scheme, port, query or fragment still names the same object. */
function place(url: string): { key: string; path: string } | null {
  try {
    const u = new URL(url);
    return { key: `${u.hostname.replace(/\.$/, "")}${u.pathname}`, path: u.pathname };
  } catch {
    return null;
  }
}

function reusableUrls(g: Generation, now: number): string[] {
  if (g.status !== "completed") return [];
  const stored = g.storagePath ? storage.objectUrls(g.storagePath)?.url : undefined;
  const expires = g.expiresAt?.getTime() ?? (g.completedAt ? g.completedAt.getTime() + PROVIDER_KEEPS_MS : null);
  const lasts = expires === null || expires - now > PROVIDER_MARGIN_MS;
  const provider = g.resultUrl && /^https?:\/\//.test(g.resultUrl) && lasts ? g.resultUrl : undefined;
  return [stored, provider].filter((u): u is string => u !== undefined);
}

/** This row's result as a reference, or null when it cannot be one now. */
export function resultRef(g: Generation, now = Date.now()): Reference | null {
  const [url] = reusableUrls(g, now);
  if (!url) return null;
  if (describeModel(g.modelId).output === "image") return { kind: "image", url };
  return g.durationS > 0 ? { kind: "video", url, seconds: g.durationS } : null;
}

/**
 * Why `userId` may not send `ref`, or null. `at` is what its URL names in this app's store, and `row` the generation it
 * names: by a result key's id in the store, by result_url anywhere else.
 */
export function refProblem(userId: number, ref: Reference, at: storage.StoredObject | null, row: Generation | undefined, now: number): AppError | null {
  const notYours = appError("refNotYours", { kind: ref.kind });
  if (at?.kind === "ref") return at.ownerId === userId ? null : notYours;
  if (at?.kind === "other") return notYours;
  // Small uploads land on Higgsfield's upload host, which is unpublished (docs.higgsfield.ai shows cdn.example.com),
  // so a URL outside the store that no row names passes.
  if (!row) return at ? appError("resultGone") : null;
  if (row.userId !== userId) return notYours;
  const sent = place(ref.url)?.key;
  if (!reusableUrls(row, now).some((u) => place(u)?.key === sent)) return appError("resultGone");
  const kind = describeModel(row.modelId).output;
  return kind !== ref.kind || (ref.kind === "video" && ref.seconds !== row.durationS) ? appError("refMismatch") : null;
}

/** The rows a draft's references may name: by id, or by a result_url that holds one of `paths`. */
export type NamedRows = (ids: string[], paths: string[]) => Promise<Generation[]>;

const namedRows: NamedRows = (ids, paths) => {
  const g = schema.generations;
  return getDb()
    .select()
    .from(g)
    .where(or(ids.length > 0 ? inArray(g.id, ids) : undefined, ...paths.map((p) => sql`strpos(${g.resultUrl}, ${p}) > 0`)));
};

/** Refuse (400) a draft with a reference that is not the caller's, or a reused result whose media is gone or that it misstates. */
export async function checkRefs(userId: number, draft: Draft, load: NamedRows = namedRows, now = Date.now()): Promise<void> {
  const sent: Reference[] = [
    ...draft.images.map((url) => ({ kind: "image" as const, url })),
    ...(draft.endImage ? [{ kind: "image" as const, url: draft.endImage }] : []),
    ...draft.videos.map((v) => ({ kind: "video" as const, url: v.url, seconds: v.seconds })),
  ];
  const refs = sent.map((ref) => ({ ref, at: storage.storedObjectOf(ref.url), place: place(ref.url) }));
  const ids = refs.flatMap((r) => (r.at?.kind === "result" ? [r.at.generationId] : []));
  const paths = refs.flatMap((r) => (r.at === null && r.place && r.place.path.length > 1 ? [r.place.path] : []));
  const rows = ids.length + paths.length === 0 ? [] : await load(ids, paths);
  for (const r of refs) {
    const named = rows.filter((row) =>
      r.at?.kind === "result" ? row.id === r.at.generationId : r.at === null && r.place !== null && row.resultUrl !== null && place(row.resultUrl)?.key === r.place.key,
    );
    const problem = refProblem(userId, r.ref, r.at, named.find((row) => row.userId === userId) ?? named[0], now);
    if (problem) throw HttpError.of(400, problem);
  }
}
