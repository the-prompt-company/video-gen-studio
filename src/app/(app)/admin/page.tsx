import { getCurrentUser } from "@/lib/auth";
import { usageFor } from "@/lib/stats";
import { usd } from "@/lib/format";
import { Stat } from "@/components/ui";
import { AdminPanels } from "@/components/admin/AdminPanels";

export const metadata = { title: "어드민" };

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  const all = await usageFor(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">어드민</h1>
        <p className="mt-1 text-sm text-muted">사용자와 API 키 할당, 모델 단가, 전체 로그.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="전체 비용" value={usd(all.totalCostUsd)} sub={`최근 30일 ${usd(all.last30dCostUsd)}`} />
        <Stat label="전체 생성" value={all.generations} sub={`완료 ${all.completed} · 실패 ${all.failed}`} />
        <Stat label="생성한 영상 길이" value={`${all.totalSeconds}s`} />
        <Stat label="모델 수" value={all.byModel.length} sub="사용된 모델" />
      </div>
      <AdminPanels adminId={user.id} />
    </div>
  );
}
