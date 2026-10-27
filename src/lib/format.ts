export function usd(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return `$${v.toFixed(v >= 100 ? 0 : v >= 1 ? 2 : 4)}`;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short", hour12: false });
}

export function fmtRelative(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const x = typeof d === "string" ? new Date(d) : d;
  const s = Math.round((Date.now() - x.getTime()) / 1000);
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

export const STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  in_progress: "생성 중",
  completed: "완료",
  failed: "실패",
  nsfw: "NSFW 차단",
  canceled: "취소",
};

export const STATUS_TONE: Record<string, string> = {
  queued: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30",
  in_progress: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  completed: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  failed: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  nsfw: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  canceled: "bg-zinc-500/15 text-zinc-400 ring-zinc-500/30",
};

export function shortModel(id: string): string {
  const parts = id.split("/");
  return parts.length > 2 ? parts.slice(0, 2).join("/") : id;
}
