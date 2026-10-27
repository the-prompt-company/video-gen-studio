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
    if (!(file instanceof File)) throw new HttpError(400, "file 필드가 필요합니다");
    if (file.size > SMALL_FILE_LIMIT) throw new HttpError(413, "4 MB를 넘는 파일은 대용량 업로드를 사용하세요");

    const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
    if (!(hf.UPLOAD_CONTENT_TYPES as readonly string[]).includes(type)) {
      throw new HttpError(415, `지원하지 않는 형식: ${file.type || "unknown"} (jpeg/png/webp/gif/mp4/wav)`);
    }

    const url = await hf.uploadBytes(apiKeyFor(user), await file.arrayBuffer(), type);
    return Response.json({ url, name: file.name, size: file.size, type });
  } catch (e) {
    return errorResponse(e);
  }
}
