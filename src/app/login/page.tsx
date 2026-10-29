import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { getCurrentUser } from "@/lib/auth";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("login");

type Props = { searchParams: Promise<{ next?: string | string[] }> };

export default async function LoginPage({ searchParams }: Props) {
  const asked = (await searchParams).next;
  const next = typeof asked === "string" && asked.startsWith("/") && !asked.startsWith("//") ? asked : "/playground";
  if (await getCurrentUser()) redirect(next);

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="font-display mb-8 inline-block text-[22px] leading-none">
          Video Gen Studio
        </Link>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
