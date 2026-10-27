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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">플레이그라운드</h1>
        <p className="mt-1 text-sm text-muted">프롬프트와 레퍼런스를 올리고 모델을 고른 뒤 생성합니다. 완료 영상은 갤러리와 사용량에 자동 기록됩니다.</p>
      </div>
      <Playground
        models={models}
        hasApiKey={Boolean(user?.apiKeyEnc)}
        largeUploads={Boolean(process.env.BLOB_READ_WRITE_TOKEN)}
      />
    </div>
  );
}
