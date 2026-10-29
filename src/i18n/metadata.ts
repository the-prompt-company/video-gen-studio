import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { Messages } from "next-intl";

/** `export const generateMetadata = pageTitle("gallery")` gives a page its tab title in the page's language. */
export function pageTitle(page: keyof Messages["pages"]) {
  return async (): Promise<Metadata> => ({ title: (await getTranslations("pages"))(page) });
}
