import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser } from "@/lib/auth";
import { isRefPathname, refPrefix } from "@/lib/storage";

/**
 * POST /api/uploads/blob — token endpoint for direct browser → Vercel Blob
 * uploads of large reference videos (bypasses the 4.5 MB function limit).
 * The pathname must be a plain file name (isRefPathname) under the caller's refs/<user id>/, because once a
 * generation finishes the cleanup deletes only its owner's references there (see lib/generations.ts).
 */
export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return Response.json(
      { error: "대용량 업로드가 꺼져 있습니다 (Vercel Blob 스토어가 연결되지 않음). 4 MB 이하 파일만 올릴 수 있습니다." },
      { status: 503 },
    );
  }
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다" }, { status: 401 });

  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!isRefPathname(pathname, user.id)) throw new Error(`업로드 경로는 ${refPrefix(user.id)} 아래 영문, 숫자, . - _ 로 된 파일 이름이어야 합니다`);
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
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
