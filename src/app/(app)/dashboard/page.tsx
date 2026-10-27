import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { usageFor } from "@/lib/stats";
import { usd, fmtDate, shortModel } from "@/lib/format";
import { Card, Stat, Empty } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { UsageChart } from "@/components/UsageChart";

export const metadata = { title: "대시보드" };

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [usage, recent] = await Promise.all([
    usageFor(user.id),
    getDb()
      .select()
      .from(schema.generations)
      .where(eq(schema.generations.userId, user.id))
      .orderBy(desc(schema.generations.createdAt))
      .limit(20),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">대시보드</h1>
        <p className="mt-1 text-sm text-zinc-400">{user.username} 님의 사용량. 비용은 모델 단가 × 영상 길이로 계산되며 실패·NSFW·취소 건은 과금되지 않습니다.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="누적 비용" value={usd(usage.totalCostUsd)} sub={`최근 30일 ${usd(usage.last30dCostUsd)}`} />
        <Stat label="생성 횟수" value={usage.generations} sub={`완료 ${usage.completed} · 실패 ${usage.failed}`} />
        <Stat label="생성한 영상 길이" value={`${usage.totalSeconds}s`} sub="완료 건 합계" />
        <Stat label="API 키" value={user.apiKeyEnc ? "할당됨" : "미할당"} sub={user.apiKeyEnc ? "관리자가 서버에 보관" : "관리자에게 요청하세요"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="최근 30일 · 일별 비용">
          {usage.byDay.length === 0 ? <Empty>아직 데이터가 없습니다.</Empty> : <UsageChart rows={usage.byDay} />}
        </Card>
        <Card title="모델별">
          {usage.byModel.length === 0 ? (
            <Empty>아직 데이터가 없습니다.</Empty>
          ) : (
            <ul className="space-y-3">
              {usage.byModel.map((m) => {
                const pct = usage.totalCostUsd > 0 ? (m.costUsd / usage.totalCostUsd) * 100 : 0;
                return (
                  <li key={m.modelId}>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-200">{shortModel(m.modelId)}</span>
                      <span className="text-zinc-400">
                        {m.count}회 · {usd(m.costUsd)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card title="최근 생성 20건">
        {recent.length === 0 ? (
          <Empty>기록이 없습니다.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="py-2 pr-4 font-medium">시각</th>
                  <th className="py-2 pr-4 font-medium">상태</th>
                  <th className="py-2 pr-4 font-medium">모델</th>
                  <th className="py-2 pr-4 font-medium">프롬프트</th>
                  <th className="py-2 pr-4 text-right font-medium">길이</th>
                  <th className="py-2 text-right font-medium">비용</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recent.map((g) => (
                  <tr key={g.id}>
                    <td className="whitespace-nowrap py-2 pr-4 text-zinc-400">{fmtDate(g.createdAt)}</td>
                    <td className="py-2 pr-4"><StatusBadge status={g.status} /></td>
                    <td className="whitespace-nowrap py-2 pr-4 text-zinc-300">{shortModel(g.modelId)}</td>
                    <td className="max-w-[320px] truncate py-2 pr-4 text-zinc-300">{g.prompt || "—"}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-zinc-400">{g.durationS}s</td>
                    <td className="py-2 text-right tabular-nums">{usd(g.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
