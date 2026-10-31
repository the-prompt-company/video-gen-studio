import { getNow } from "next-intl/server";
import { getCurrentUser } from "@/lib/auth";
import { loadGallery } from "@/lib/gallery";
import { Gallery } from "@/components/Gallery";
import { PageContainer } from "@/components/ui";
import { pageTitle } from "@/i18n/metadata";
import { NextIntlClientProvider } from "next-intl";
import { pageMessages } from "@/i18n/provider";

export const generateMetadata = pageTitle("gallery");

export default async function GalleryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const [gallery, now, messages] = await Promise.all([loadGallery(user, await searchParams), getNow(), pageMessages(["generation", "gallery", "mode"])]);

  return (
    <PageContainer>
      <NextIntlClientProvider messages={messages}>
        <Gallery {...gallery} now={now.getTime()} />
      </NextIntlClientProvider>
    </PageContainer>
  );
}
