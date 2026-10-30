import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { FAMILY_IDS } from "@/lib/catalog";
import { unavailableFor } from "@/lib/generations";
import { loadModelSettings } from "@/lib/model-settings";
import { refPrefix } from "@/lib/storage";
import { Playground } from "@/components/Playground";
import { pageTitle } from "@/i18n/metadata";
import { NextIntlClientProvider } from "next-intl";
import { pageMessages } from "@/i18n/provider";

export const generateMetadata = pageTitle("playground");

export default async function PlaygroundPage() {
  const user = await getCurrentUser();
  const db = getDb();
  const [settings, [{ completed }], messages] = await Promise.all([
    loadModelSettings(),
    user
      ? db.select({ completed: count() }).from(schema.generations).where(and(eq(schema.generations.userId, user.id), eq(schema.generations.status, "completed")))
      : Promise.resolve([{ completed: 0 }]),
    pageMessages(["generation", "playground", "mode", "paramValues", "families", "prices"]),
  ]);
  const offers = FAMILY_IDS.filter((f) => settings[f].enabled).map((family) => ({
    family,
    rateUsd: settings[family].rateUsd,
    unavailable: unavailableFor(family, { apiKeyEnc: user?.apiKeyEnc ?? null }),
  }));

  return (
    <NextIntlClientProvider messages={messages}>
      <Playground
        offers={offers}
        largeUploadPrefix={user && process.env.BLOB_READ_WRITE_TOKEN ? refPrefix(user.id) : null}
        galleryCount={Number(completed)}
      />
    </NextIntlClientProvider>
  );
}
