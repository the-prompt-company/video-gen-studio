import Link from "next/link";
import { getUnverifiedSession } from "@/lib/auth";
import { CATALOG } from "@/lib/catalog";
import { Button } from "@/components/ui";

const STEPS = [
  { n: "01", t: "레퍼런스 올리기", d: "텍스트 프롬프트에 이미지 최대 6장, 영상 레퍼런스를 더합니다." },
  { n: "02", t: "모델과 파라미터", d: "Seedance 2.0과 연습용 Hailuo 2.3 중 고르고 길이, 해상도, 화면비를 조정합니다." },
  { n: "03", t: "생성과 기록", d: "진행 상태를 실시간으로 보고, 완료되면 갤러리와 사용량에 자동 기록됩니다." },
];

export default async function Landing() {
  const session = await getUnverifiedSession();
  const cta = session ? { href: "/playground", label: "플레이그라운드 열기" } : { href: "/login", label: "로그인" };

  return (
    <div className="relative flex flex-1 flex-col">

      <header className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <span className="font-display text-[22px] leading-none">Video Gen Studio</span>
        <Link href={cta.href} className="text-sm text-foreground-2 hover:text-foreground">
          {session ? `${session.username} →` : "로그인"}
        </Link>
      </header>

      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-start justify-center px-4 py-20">
        <span className="mb-6 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
          Higgsfield API · 팀 전용 워크스페이스
        </span>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl">
          레퍼런스 몇 장으로
          <br />
          <span className="text-accent-soft">
            영상을 만들고, 비용까지 추적
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
          개인별로 배부된 ID로 로그인하면 끝. API 키는 관리자가 서버에 할당하고, 생성 한 건 한 건의 모델·파라미터·비용이
          사용자별로 쌓입니다.
        </p>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link href={cta.href}>
            <Button size="lg">{cta.label}</Button>
          </Link>
          <Link href="/gallery">
            <Button size="lg" variant="outline">
              갤러리 보기
            </Button>
          </Link>
        </div>

        <div className="mt-20 grid w-full gap-4 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-border bg-surface/80 p-5 backdrop-blur">
              <div className="font-mono text-xs text-accent-soft">{s.n}</div>
              <div className="mt-2 font-medium">{s.t}</div>
              <div className="mt-1 text-sm text-muted">{s.d}</div>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap gap-2">
          {CATALOG.map((m) => (
            <span key={m.id} className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-foreground-2">
              {m.name} <span className="text-subtle">· {m.vendor}</span>
            </span>
          ))}
        </div>
      </section>

      <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-subtle">
        결과 영상은 Higgsfield에 7일간 보관됩니다. 보관하려면 갤러리에서 다운로드하세요.
      </footer>
    </div>
  );
}
