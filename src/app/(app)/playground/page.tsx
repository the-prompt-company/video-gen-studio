import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { FAMILY_IDS } from "@/lib/catalog";
import { unavailableFor } from "@/lib/generations";
import { loadModelSettings } from "@/lib/model-settings";
import { refPrefix } from "@/lib/storage";
import { listThreads } from "@/lib/thread-store";
import { Playground } from "@/components/Playground";
import { pageTitle } from "@/i18n/metadata";
import { NextIntlClientProvider } from "next-intl";
import { pageMessages } from "@/i18n/provider";

export const generateMetadata = pageTitle("playground");

export default async function PlaygroundPage({ searchParams }: { searchParams: Promise<{ thread?: string | string[] }> }) {
  const user = await getCurrentUser();
  const { thread } = await searchParams;
  const db = getDb();
  const [settings, [{ completed }], threads, messages] = await Promise.all([
    loadModelSettings(),
    user
      ? db.select({ completed: count() }).from(schema.generations).where(and(eq(schema.generations.userId, user.id), eq(schema.generations.status, "completed")))
      : Promise.resolve([{ completed: 0 }]),
    user ? listThreads(user.id) : Promise.resolve([]),
    pageMessages(["generation", "playground", "threads", "mode", "paramValues"]),
  ]);
  const offers = FAMILY_IDS.filter((f) => settings[f].enabled).map((family) => ({
    family,
    rateUsd: settings[family].rateUsd,
    unavailable: unavailableFor(family, { apiKeyEnc: user?.apiKeyEnc ?? null }, settings[family].rateUsd),
  }));

  return (
    <NextIntlClientProvider messages={messages}>
      <Playground
        offers={offers}
        largeUploadPrefix={user && process.env.BLOB_READ_WRITE_TOKEN ? refPrefix(user.id) : null}
        galleryCount={Number(completed)}
        threads={threads}
        initialThread={typeof thread === "string" ? thread : null}
      />
    </NextIntlClientProvider>
  );
}
