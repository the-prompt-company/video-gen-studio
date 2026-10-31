import { getCurrentUser } from "@/lib/auth";
import { usageFor } from "@/lib/stats";
import { Stat, PageContainer } from "@/components/ui";
import { AdminPanels } from "@/components/admin/AdminPanels";
import { getFormatter, getTranslations } from "next-intl/server";
import { usd } from "@/i18n/format";
import { pageTitle } from "@/i18n/metadata";
import { NextIntlClientProvider } from "next-intl";
import { pageMessages } from "@/i18n/provider";

export const generateMetadata = pageTitle("admin");

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  const [all, format, t, tDashboard, tPages, messages] = await Promise.all([
    usageFor(null),
    getFormatter(),
    getTranslations("admin"),
    getTranslations("dashboard"),
    getTranslations("pages"),
    pageMessages(["mode", "prices", "generation", "admin", "members", "teams", "import", "models", "logs"]),
  ]);

  return (
    <PageContainer className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{tPages("admin")}</h1>
        <p className="mt-1 text-sm text-muted">{t("lead")}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("stats.totalSpend")} value={usd(format, all.totalCostUsd)} sub={tDashboard("stats.last30", { amount: usd(format, all.last30dCostUsd) })} />
        <Stat label={t("stats.generations")} value={all.generations} sub={tDashboard("stats.outcomes", { completed: all.completed, failed: all.failed })} />
        <Stat label={tDashboard("stats.videoLength")} value={tDashboard("seconds", { seconds: String(all.totalSeconds) })} />
        <Stat label={t("stats.models")} value={all.byModel.length} sub={t("stats.modelsSub")} />
      </div>
      <NextIntlClientProvider messages={messages}>
        <AdminPanels adminId={user.id} />
      </NextIntlClientProvider>
    </PageContainer>
  );
}
