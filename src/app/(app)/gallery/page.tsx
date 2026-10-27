import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { publicGeneration } from "@/lib/generations";
import { Gallery } from "@/components/Gallery";

export const metadata = { title: "갤러리" };

export default async function GalleryPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { all } = await searchParams;
  const showAll = user.role === "admin" && all === "1";

  const db = getDb();
  const g = schema.generations;
  const rows = await db
    .select({ g, username: schema.users.username })
    .from(g)
    .innerJoin(schema.users, eq(schema.users.id, g.userId))
    .where(showAll ? eq(g.status, "completed") : and(eq(g.userId, user.id), eq(g.status, "completed")))
    .orderBy(desc(g.createdAt))
    .limit(120);

  return <Gallery items={rows.map((r) => publicGeneration(r.g, r.username))} isAdmin={user.role === "admin"} showAll={showAll} />;
}
