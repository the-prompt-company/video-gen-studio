import { usd } from "@/lib/format";

/** Tiny dependency-free bar chart: one bar per day, height = cost. */
export function UsageChart({ rows }: { rows: { day: string; count: number; costUsd: number }[] }) {
  const max = Math.max(0.0001, ...rows.map((r) => r.costUsd));
  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {rows.map((r) => (
          <div key={r.day} className="group relative flex-1">
            <div
              className="w-full rounded-t bg-gradient-to-t from-violet-700 to-cyan-400/80 transition group-hover:brightness-125"
              style={{ height: `${Math.max(4, (r.costUsd / max) * 100)}%` }}
            />
            <div className="pointer-events-none absolute -top-9 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-100 group-hover:block">
              {r.day.slice(5)} · {r.count}회 · {usd(r.costUsd)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-zinc-500">
        <span>{rows[0]?.day}</span>
        <span>{rows[rows.length - 1]?.day}</span>
      </div>
    </div>
  );
}
