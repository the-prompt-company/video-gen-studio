import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { CATALOG } from "@/lib/catalog";
import { Playground } from "@/components/Playground";

export const metadata = { title: "플레이그라운드" };

export default async function PlaygroundPage() {
  const user = await getCurrentUser();
  const db = getDb();
  const rows = await db.select().from(schema.models);
  const byId = new Map(rows.map((r) => [r.modelId, r]));
  const models = CATALOG.filter((m) => byId.get(m.id)?.enabled !== false).map((m) => ({
    ...m,
    pricePerSecUsd: Number(byId.get(m.id)?.pricePerSecUsd ?? 0),
  }));

  return (
    <Playground
      models={models}
      hasApiKey={Boolean(user?.apiKeyEnc)}
      largeUploads={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
    />
  );
}
