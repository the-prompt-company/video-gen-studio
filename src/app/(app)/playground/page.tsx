import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { CATALOG } from "@/lib/catalog";
import { refPrefix } from "@/lib/storage";
import { Playground } from "@/components/Playground";

export const metadata = { title: "플레이그라운드" };

export default async function PlaygroundPage() {
  const user = await getCurrentUser();
  const db = getDb();
  const rows = await db.select().from(schema.models);
  const [{ completed }] = user
    ? await db.select({ completed: count() }).from(schema.generations).where(and(eq(schema.generations.userId, user.id), eq(schema.generations.status, "completed")))
    : [{ completed: 0 }];
  const byId = new Map(rows.map((r) => [r.modelId, r]));
  const models = CATALOG.filter((m) => byId.get(m.id)?.enabled !== false).map((m) => ({
    ...m,
    pricePerSecUsd: Number(byId.get(m.id)?.pricePerSecUsd ?? 0),
  }));

  return (
    <Playground
      models={models}
      hasApiKey={Boolean(user?.apiKeyEnc)}
      largeUploadPrefix={user && process.env.BLOB_READ_WRITE_TOKEN ? refPrefix(user.id) : null}
      galleryCount={Number(completed)}
    />
  );
}
