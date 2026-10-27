import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "로그인" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display mb-8 inline-block text-[22px] leading-none">
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
