import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "로그인" };

export default function LoginPage() {
  return (
    <main className="relative flex flex-1 items-center justify-center px-4">
      <div className="glow pointer-events-none absolute inset-0 -z-10" />
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />
          Video Gen Studio
        </Link>
        <h1 className="text-2xl font-semibold">로그인</h1>
        <p className="mt-1 text-sm text-muted">배부받은 ID와 비밀번호를 입력하세요.</p>
        <div className="mt-6">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
