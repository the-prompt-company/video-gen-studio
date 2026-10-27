"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/playground", label: "플레이그라운드" },
  { href: "/gallery", label: "갤러리" },
  { href: "/dashboard", label: "대시보드" },
];

export function Nav({ username, role }: { username: string; role: string }) {
  const pathname = usePathname();

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Full navigation so proxy.ts sees the cleared cookie and no client cache survives.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
    }
  }

  const links = role === "admin" ? [...LINKS, { href: "/admin", label: "어드민" }] : LINKS;
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-4 sm:gap-7 sm:px-5">
        <Link href="/" className="font-display shrink-0 whitespace-nowrap text-[22px] leading-none text-foreground">
          Video Gen Studio
        </Link>
        <nav aria-label="주 메뉴" className="hidden items-center gap-1 sm:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-3 text-sm transition ${
                isActive(l.href) ? "bg-white/12 text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3 text-sm">
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            <span className="truncate text-foreground-2" title={username}>
              {username}
            </span>
            {role === "admin" && (
              <span className="font-display shrink-0 rounded-sm border border-border px-1.5 pt-0.5 text-[12px] leading-none text-sand">ADMIN</span>
            )}
          </span>
          <button
            type="button"
            onClick={logout}
            className="inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full border border-border px-3 text-xs text-foreground-2 transition hover:border-foreground hover:text-foreground"
          >
            로그아웃
          </button>
        </div>
      </div>
      <nav aria-label="주 메뉴" className="flex gap-1 overflow-x-auto px-2 pb-2 sm:hidden">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={isActive(l.href) ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-sm ${
              isActive(l.href) ? "bg-white/12 text-foreground" : "text-muted"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
