import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { usageFor } from "@/lib/stats";
import { getFormatter, getTranslations } from "next-intl/server";
import { modelLine } from "@/lib/catalog";
import { Card, Stat, Empty, PageContainer } from "@/components/ui";
import { StatusBadge } from "@/components/StatusBadge";
import { UsageChart } from "@/components/UsageChart";
import { dateTime, usd } from "@/i18n/format";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("dashboard");

const RECENT = 20;

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [usage, recent, format, t, tMode, tPages] = await Promise.all([
    usageFor(user.id),
    getDb()
      .select()
      .from(schema.generations)
      .where(eq(schema.generations.userId, user.id))
      .orderBy(desc(schema.generations.createdAt))
      .limit(RECENT),
    getFormatter(),
    getTranslations("dashboard"),
    getTranslations("mode"),
    getTranslations("pages"),
  ]);

  return (
    <PageContainer className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{tPages("dashboard")}</h1>
        <p className="mt-1 text-sm text-muted">{t("lead", { name: user.username })}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("stats.totalSpend")} value={usd(format, usage.totalCostUsd)} sub={t("stats.last30", { amount: usd(format, usage.last30dCostUsd) })} />
        <Stat label={t("stats.generations")} value={usage.generations} sub={t("stats.outcomes", { completed: usage.completed, failed: usage.failed })} />
        <Stat label={t("stats.videoLength")} value={t("seconds", { seconds: String(usage.totalSeconds) })} sub={t("stats.videoLengthSub")} />
        <Stat
          label={t("stats.apiKey")}
          value={user.apiKeyEnc ? t("stats.keyAssigned") : t("stats.keyMissing")}
          sub={user.apiKeyEnc ? t("stats.keyAssignedSub") : t("stats.keyMissingSub")}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title={t("daily")}>
          {usage.byDay.length === 0 ? <Empty>{t("noData")}</Empty> : <UsageChart rows={usage.byDay} />}
        </Card>
        <Card title={t("byModel")}>
          {usage.byModel.length === 0 ? (
            <Empty>{t("noData")}</Empty>
          ) : (
            <ul className="space-y-3">
              {usage.byModel.map((m) => {
                const pct = usage.totalCostUsd > 0 ? (m.costUsd / usage.totalCostUsd) * 100 : 0;
                return (
                  <li key={m.group}>
                    <div className="flex justify-between text-sm">
                      <span className="text-foreground-2">{m.name}</span>
                      <span className="text-muted">{t("modelUsage", { count: m.count, cost: usd(format, m.costUsd) })}</span>
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

      <Card title={t("recent", { count: RECENT })}>
        {recent.length === 0 ? (
          <Empty>{t("noHistory")}</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-subtle">
                <tr>
                  <th className="py-2 pr-4 font-medium">{t("table.time")}</th>
                  <th className="py-2 pr-4 font-medium">{t("table.status")}</th>
                  <th className="py-2 pr-4 font-medium">{t("table.model")}</th>
                  <th className="py-2 pr-4 font-medium">{t("table.prompt")}</th>
                  <th className="py-2 pr-4 text-right font-medium">{t("table.length")}</th>
                  <th className="py-2 text-right font-medium">{t("table.cost")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recent.map((g) => (
                  <tr key={g.id}>
                    <td className="whitespace-nowrap py-2 pr-4 text-muted">{dateTime(format, g.createdAt)}</td>
                    <td className="py-2 pr-4"><StatusBadge status={g.status} /></td>
                    <td className="whitespace-nowrap py-2 pr-4 text-foreground-2">{modelLine(g.modelId, (m) => tMode(m))}</td>
                    <td className="max-w-[320px] truncate py-2 pr-4 text-foreground-2">{g.prompt || "—"}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-muted">{g.durationS > 0 ? t("seconds", { seconds: String(g.durationS) }) : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{usd(format, g.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageContainer>
  );
}
