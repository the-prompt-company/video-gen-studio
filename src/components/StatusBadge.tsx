import { Badge } from "@/components/ui";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/format";

export function StatusBadge({ status }: { status: string }) {
  const live = status === "queued" || status === "in_progress";
  return (
    <Badge className={STATUS_TONE[status] ?? STATUS_TONE.queued}>
      {live && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
