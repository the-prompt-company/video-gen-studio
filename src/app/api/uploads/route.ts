import { requireUser, errorResponse, HttpError } from "@/lib/auth";
import { apiKeyFor } from "@/lib/generations";
import * as hf from "@/lib/higgsfield";

/** Function bodies are capped at 4.5 MB on Vercel; larger files go through /api/uploads/blob. */
export const SMALL_FILE_LIMIT = 4 * 1024 * 1024;

/**
 * POST /api/uploads (multipart: file) — small reference files go straight to
 * Higgsfield's upload storage through the server. No Blob quota is used.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "uploadNoFile");
    if (file.size > SMALL_FILE_LIMIT) throw new HttpError(413, "uploadTooLarge", { mb: SMALL_FILE_LIMIT / 1024 / 1024 });

    const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
    if (!(hf.UPLOAD_CONTENT_TYPES as readonly string[]).includes(type)) {
      throw new HttpError(415, "uploadType", { type: file.type || "unknown", allowed: "jpeg/png/webp/gif/mp4/wav" });
    }

    const url = await hf.uploadBytes(apiKeyFor(user), await file.arrayBuffer(), type);
    return Response.json({ url, name: file.name, size: file.size, type });
  } catch (e) {
    if (e instanceof hf.HiggsfieldError) return errorResponse(new HttpError(502, "providerUploadFailed", { detail: e.message }));
    return errorResponse(e);
  }
}
