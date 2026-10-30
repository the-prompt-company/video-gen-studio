import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { errorResponse, getCurrentUser, HttpError } from "@/lib/auth";
import { isRefPathname, refPrefix } from "@/lib/storage";

/**
 * POST /api/uploads/blob — token endpoint for direct browser → Vercel Blob
 * uploads of large reference videos (bypasses the 4.5 MB function limit).
 * The pathname must be a plain file name (isRefPathname) under the caller's refs/<user id>/, because once a
 * generation finishes the cleanup deletes only its owner's references there (see lib/generations.ts).
 */
export async function POST(req: Request) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new HttpError(503, "largeUploadOff", { mb: 4 });
    const user = await getCurrentUser();
    if (!user) throw new HttpError(401, "signInRequired");

    const body = (await req.json()) as HandleUploadBody;
    try {
      const json = await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (pathname) => {
          if (!isRefPathname(pathname, user.id)) throw new HttpError(400, "uploadPath", { prefix: refPrefix(user.id) });
          return {
            allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4"],
            maximumSizeInBytes: 200 * 1024 * 1024,
            addRandomSuffix: true,
            tokenPayload: JSON.stringify({ userId: user.id, pathname }),
          };
        },
        onUploadCompleted: async () => {
          // Nothing to persist: the browser passes the resulting URL to /api/generations.
        },
      });
      return Response.json(json);
    } catch (e) {
      throw e instanceof HttpError ? e : new HttpError(400, "uploadRefused", { detail: e instanceof Error ? e.message : String(e) });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
