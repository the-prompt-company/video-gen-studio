import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser, errorResponse, HttpError } from "@/lib/auth";
import { isGenerationId, publicGeneration } from "@/lib/generations";
import { readRow, viewerOf } from "@/lib/scope";
import { streamDownload } from "@/lib/result-download";

export const maxDuration = 300;

/** A same-origin attachment response also works for provider URLs without CORS/download headers. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isGenerationId(id)) throw new HttpError(404, "noSuchGeneration");
    const [row] = await getDb().select().from(schema.generations).where(eq(schema.generations.id, id)).limit(1);
    const access = readRow(await viewerOf(user), row ?? null);
    if (access.kind === "refuse") throw new HttpError(access.status, access.code);
    const result = publicGeneration(access.row);
    const media = result.image ?? result.video;
    if (!media) throw new HttpError(404, "resultGone");
    // Only the authorized row's server-recorded result can be downloaded; never accept a URL from the caller.
    return await streamDownload(new URL(media.url, req.url), id, result.image?.format, req.signal, {
      fallback: result.video && access.row.resultUrl ? new URL(access.row.resultUrl, req.url) : undefined,
      inline: new URL(req.url).searchParams.get("inline") === "1",
      range: req.headers.get("range"),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
