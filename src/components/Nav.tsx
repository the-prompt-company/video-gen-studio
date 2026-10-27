"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/playground", label: "플레이그라운드" },
  { href: "/gallery", label: "갤러리" },
  { href: "/dashboard", label: "대시보드" },
];

export function Nav({ username, role }: { username: string; role: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const links = role === "admin" ? [...LINKS, { href: "/admin", label: "어드민" }] : LINKS;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent shadow-[0_0_12px_rgba(124,58,237,.9)]" />
          Video Gen Studio
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-sm transition ${active ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="text-zinc-400">
            <span className="text-zinc-100">{username}</span>
            {role === "admin" && <span className="ml-1.5 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">ADMIN</span>}
          </span>
          <button onClick={logout} className="text-zinc-400 hover:text-white">
            로그아웃
          </button>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-2 pb-2 sm:hidden">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={`rounded-md px-3 py-1.5 text-sm ${pathname.startsWith(l.href) ? "bg-white/10 text-white" : "text-zinc-400"}`}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
