import { and, desc, eq } from "drizzle-orm";
import { getNow } from "next-intl/server";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { publicGeneration } from "@/lib/generations";
import { Gallery } from "@/components/Gallery";
import { PageContainer } from "@/components/ui";
import { pageTitle } from "@/i18n/metadata";

export const generateMetadata = pageTitle("gallery");

export default async function GalleryPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { all } = await searchParams;
  const showAll = user.role === "admin" && all === "1";

  const db = getDb();
  const g = schema.generations;
  const [rows, now] = await Promise.all([
    db
      .select({ g, username: schema.users.username })
      .from(g)
      .innerJoin(schema.users, eq(schema.users.id, g.userId))
      .where(showAll ? eq(g.status, "completed") : and(eq(g.userId, user.id), eq(g.status, "completed")))
      .orderBy(desc(g.createdAt))
      .limit(120),
    getNow(),
  ]);

  return (
    <PageContainer>
      <Gallery items={rows.map((r) => publicGeneration(r.g, r.username))} isAdmin={user.role === "admin"} showAll={showAll} now={now.getTime()} />
    </PageContainer>
  );
}
