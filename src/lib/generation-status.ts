export const GENERATION_STATUSES = ["pending", "queued", "in_progress", "completed", "failed", "nsfw", "canceled"] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

/** Lifecycle order. A row only ever moves to a strictly higher rank, which is what makes racing writers converge. */
export const RANK = {
  pending: 0,
  queued: 1,
  in_progress: 2,
  completed: 3,
  failed: 3,
  nsfw: 3,
  canceled: 3,
} as const satisfies Record<GenerationStatus, 0 | 1 | 2 | 3>;

export type LiveStatus = { [S in GenerationStatus]: (typeof RANK)[S] extends 3 ? never : S }[GenerationStatus];

export function isLive(s: GenerationStatus): s is LiveStatus {
  return RANK[s] < 3;
}

export const LIVE_STATUSES: LiveStatus[] = GENERATION_STATUSES.filter(isLive);

/** Statuses a row may hold for a write that moves it to `to`. */
export function predecessorsOf(to: GenerationStatus): GenerationStatus[] {
  return GENERATION_STATUSES.filter((s) => RANK[s] < RANK[to]);
}

export const STATUS_TONE: Record<GenerationStatus, string> = {
  pending: "bg-zinc-500/15 text-foreground-2 ring-zinc-500/30",
  queued: "bg-zinc-500/15 text-foreground-2 ring-zinc-500/30",
  in_progress: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  completed: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  failed: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  nsfw: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  canceled: "bg-zinc-500/15 text-muted ring-zinc-500/30",
};
