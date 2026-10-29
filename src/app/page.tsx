import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getUnverifiedSession } from "@/lib/auth";
import { FAMILIES, FAMILY_IDS } from "@/lib/catalog";
import { Button } from "@/components/ui";

const STEPS = [
  { n: "01", key: "prompt" },
  { n: "02", key: "model" },
  { n: "03", key: "record" },
] as const;

export default async function Landing() {
  const [session, t, tAuth] = await Promise.all([getUnverifiedSession(), getTranslations("landing"), getTranslations("auth")]);
  const cta = session ? { href: "/playground", label: t("openPlayground") } : { href: "/login", label: tAuth("signIn") };

  return (
    <div className="relative flex flex-1 flex-col">

      <header className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <span className="font-display text-[22px] leading-none">Video Gen Studio</span>
        <Link href={cta.href} className="text-sm text-foreground-2 hover:text-foreground">
          {session ? `${session.username} →` : tAuth("signIn")}
        </Link>
      </header>

      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-start justify-center px-4 py-20">
        <span className="mb-6 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
          {t("badge")}
        </span>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
          {t("headline")}
          <br />
          <span className="text-accent-soft">
            {t("headlineAccent")}
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
          {t("lead")}
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href={cta.href}>
            <Button size="lg">{cta.label}</Button>
          </Link>
          <Link href="/gallery">
            <Button size="lg" variant="outline">
              {t("viewGallery")}
            </Button>
          </Link>
        </div>

        <div className="mt-20 grid w-full gap-4 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-border bg-surface/80 p-5 backdrop-blur">
              <div className="font-mono text-xs text-accent-soft">{s.n}</div>
              <div className="mt-2 font-medium">{t(`steps.${s.key}.title`)}</div>
              <div className="mt-1 text-sm text-muted">{t(`steps.${s.key}.body`)}</div>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-2">
          {FAMILY_IDS.map((id) => (
            <span key={id} className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-foreground-2">
              {FAMILIES[id].name} <span className="text-subtle">· {FAMILIES[id].vendor}</span>
            </span>
          ))}
        </div>
      </section>

      <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-subtle">
        {t("retention")}
      </footer>
    </div>
  );
}
