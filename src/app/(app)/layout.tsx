import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Nav username={user.username} role={user.role} />
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
