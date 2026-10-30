import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth";
import { viewerOf } from "@/lib/scope";
import { avatarUrl, storageEnabled } from "@/lib/storage";
import { PageContainer } from "@/components/ui";
import { PasswordChangeForm } from "@/components/PasswordChangeForm";
import { ProfileEditor } from "@/components/ProfileEditor";
import { LanguagePicker } from "@/components/LanguagePicker";
import { pageTitle } from "@/i18n/metadata";

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
  const [{ team }, tLanguage] = await Promise.all([viewerOf(user), getTranslations("language")]);

  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold">설정</h1>
      <p className="mt-1 break-keep text-sm text-muted">상단 메뉴에 보이는 사진과 닉네임, 화면 언어, 로그인 비밀번호를 바꿉니다.</p>
      <div className="mt-6 divide-y divide-border border-t border-border md:max-w-[42rem]">
        <Section id="settings-profile" title="프로필" lead="사진과 닉네임으로 상단 메뉴에 내가 표시됩니다. 닉네임이 없으면 ID가 보입니다.">
          <ProfileEditor
            username={user.username}
            nickname={user.nickname}
            avatarUrl={user.avatarKey ? avatarUrl(user.avatarKey) : null}
            photoStorage={storageEnabled()}
          />
        </Section>
        <Section id="settings-account" title="계정" lead="로그인에 쓰는 ID와 팀은 직접 바꿀 수 없습니다. 바꿔야 하면 관리자에게 요청하세요.">
          <dl className="space-y-4">
            <div>
              <dt className="text-xs font-medium text-muted">ID</dt>
              <dd className="mt-1.5 break-all text-sm text-foreground-2">{user.username}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-muted">팀</dt>
              <dd className="mt-1.5 break-words text-sm text-foreground-2">{team ? team.name : <span className="text-subtle">미소속</span>}</dd>
            </div>
          </dl>
        </Section>
        <Section id="settings-language" title={tLanguage("label")} lead={tLanguage("lead")}>
          <LanguagePicker />
        </Section>
        <Section
          id="settings-password"
          title="비밀번호"
          lead="현재 비밀번호를 확인한 뒤 바꿉니다. 이 브라우저는 로그인 상태로 남고, 다른 기기와 브라우저의 로그인은 모두 끝납니다."
        >
          <PasswordChangeForm username={user.username} hideId />
        </Section>
      </div>
    </PageContainer>
  );
}
