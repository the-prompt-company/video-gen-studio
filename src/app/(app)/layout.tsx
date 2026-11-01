import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { avatarUrl } from "@/lib/storage";
import { Nav } from "@/components/Nav";
import { ContactProvider } from "@/components/Contact";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <ContactProvider>
      <div className="flex min-h-full flex-1 flex-col">
      <Nav
        username={user.username}
        nickname={user.nickname}
        avatarUrl={user.avatarKey ? avatarUrl(user.avatarKey) : null}
        role={user.role}
      />
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </ContactProvider>
  );
}
