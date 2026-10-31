import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth";
import { viewerOf } from "@/lib/scope";
import { avatarUrl, storageEnabled } from "@/lib/storage";
import { PageContainer } from "@/components/ui";
import { PasswordChangeForm } from "@/components/PasswordChangeForm";
import { ProfileEditor } from "@/components/ProfileEditor";
import { LanguagePicker } from "@/components/LanguagePicker";
import { pageTitle } from "@/i18n/metadata";
import { pageMessages } from "@/i18n/provider";

export const generateMetadata = pageTitle("settings");

function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-5 py-8 md:grid-cols-[15rem_minmax(0,24rem)] md:gap-12">
      <div>
        <h2 id={id} className="text-base font-semibold text-foreground">
          {title}
        </h2>
        <p className="mt-1 break-keep text-sm leading-relaxed text-muted">{lead}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [{ team }, t, tPages, tTeams, tLanguage] = await Promise.all([
    viewerOf(user),
    getTranslations("settings"),
    getTranslations("pages"),
    getTranslations("teams"),
    getTranslations("language"),
  ]);

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold">{tPages("settings")}</h1>
      <p className="mt-1 break-keep text-sm text-muted">{t("lead")}</p>
      <div className="mt-6 divide-y divide-border border-t border-border md:max-w-[42rem]">
        <Section id="settings-profile" title={t("profile.title")} lead={t("profile.lead")}>
          <NextIntlClientProvider messages={await pageMessages(["profile"])}>
            <ProfileEditor
              username={user.username}
              nickname={user.nickname}
              avatarUrl={user.avatarKey ? avatarUrl(user.avatarKey) : null}
              photoStorage={storageEnabled()}
            />
          </NextIntlClientProvider>
        </Section>
        <Section id="settings-account" title={t("account.title")} lead={t("account.lead")}>
          <dl className="space-y-4">
            <div>
              <dt className="text-xs font-medium text-muted">ID</dt>
              <dd className="mt-1.5 break-all text-sm text-foreground-2">{user.username}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted">{t("account.team")}</dt>
              <dd className="mt-1.5 break-words text-sm text-foreground-2">{team ? team.name : <span className="text-subtle">{tTeams("none")}</span>}</dd>
            </div>
          </dl>
        </Section>
        <Section id="settings-language" title={tLanguage("label")} lead={tLanguage("lead")}>
          <LanguagePicker />
        </Section>
        <Section id="settings-password" title={t("password.title")} lead={t("password.lead")}>
          <PasswordChangeForm username={user.username} hideId />
        </Section>
      </div>
    </PageContainer>
  );
}
