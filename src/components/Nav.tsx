"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/Avatar";
import { ContactButton } from "@/components/Contact";

const LINKS = [
  { href: "/playground", page: "playground" },
  { href: "/gallery", page: "gallery" },
  { href: "/dashboard", page: "dashboard" },
] as const;

export function Nav({ username, nickname, avatarUrl, role }: { username: string; nickname: string | null; avatarUrl: string | null; role: string }) {
  const t = useTranslations("nav");
  const tPages = useTranslations("pages");
  const pathname = usePathname();
  const name = nickname ?? username;

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Full navigation so proxy.ts sees the cleared cookie and no client cache survives.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
    }
  }

  const links = role === "admin" ? [...LINKS, { href: "/admin", page: "admin" } as const] : LINKS;
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-4 sm:gap-7 sm:px-5">
        <Link href="/" className="font-display shrink-0 whitespace-nowrap text-[22px] leading-none text-foreground">
          Video Gen Studio
        </Link>
        <nav aria-label={t("label")} className="hidden items-center gap-1 sm:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-3 text-sm transition ${
                isActive(l.href) ? "bg-white/12 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {tPages(l.page)}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-2 text-sm sm:gap-3">
          <ContactButton />
          <Link
            href="/settings"
            aria-current={isActive("/settings") ? "page" : undefined}
            title={nickname ? `${nickname} (${username})` : username}
            className={`flex min-h-11 min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-2 transition sm:min-h-10 sm:pr-3 ${
              isActive("/settings") ? "bg-white/12 text-foreground" : "text-foreground-2 hover:bg-white/10 hover:text-foreground"
            }`}
          >
            <Avatar name={name} url={avatarUrl} size="sm" />
            <span className="truncate">{name}</span>
            <span className="sr-only"> {tPages("settings")}</span>
          </Link>
          {role === "admin" && (
            <span className="font-display shrink-0 rounded-sm border border-border px-1.5 pt-0.5 text-[12px] leading-none text-sand">ADMIN</span>
          )}
          <button
            type="button"
            onClick={logout}
            title={t("logout")}
            className="inline-flex size-11 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-border text-xs text-foreground-2 transition hover:border-foreground hover:text-foreground sm:h-9 sm:w-auto sm:px-3"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-4 sm:hidden">
              <path d="M8 3.5H5.5a1.5 1.5 0 0 0-1.5 1.5v10a1.5 1.5 0 0 0 1.5 1.5H8M12.5 6.5 16 10l-3.5 3.5M16 10H8" />
            </svg>
            <span className="sr-only sm:not-sr-only">{t("logout")}</span>
          </button>
        </div>
      </div>
      <nav aria-label={t("label")} className="flex gap-1 overflow-x-auto px-2 pb-2 sm:hidden">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={isActive(l.href) ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-sm ${
              isActive(l.href) ? "bg-white/12 text-foreground" : "text-muted"
            }`}
          >
            {tPages(l.page)}
          </Link>
        ))}
      </nav>
    </header>
  );
}
