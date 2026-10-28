import { Badge } from "@/components/ui";
import { isLive, STATUS_LABEL, STATUS_TONE, type GenerationStatus } from "@/lib/generation-status";

export function StatusBadge({ status }: { status: GenerationStatus }) {
  return (
    <Badge className={STATUS_TONE[status]}>
      {isLive(status) && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {STATUS_LABEL[status]}
    </Badge>
  );
}
