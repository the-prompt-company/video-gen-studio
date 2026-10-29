import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { User } from "@/db/schema";
import { errorResponse, HttpError, requireUser } from "@/lib/auth";
import { AVATAR_MAX_BYTES, avatarType } from "@/lib/avatar";
import { avatarUrl, deleteAvatar, newAvatarKey, putAvatar, storageEnabled, type ObjectKey } from "@/lib/storage";

const TOO_LARGE = `사진이 ${AVATAR_MAX_BYTES / 1024} KB를 넘습니다. 설정 화면에서 사진을 다시 골라 올리세요`;
const RACED = "다른 창에서 사진을 먼저 바꿨습니다. 새로고침한 뒤 다시 시도하세요";

async function memberWithStorage(): Promise<User> {
  const u = await requireUser();
  if (!storageEnabled()) {
    throw new HttpError(503, "사진을 저장할 Vercel Blob 스토어가 연결되지 않았습니다. 관리자에게 BLOB_READ_WRITE_TOKEN 설정을 요청하세요");
  }
  return u;
}

/** Point the row at `next` only while it still names the photo this request read, so two tabs never orphan or lose one. */
async function swapAvatarKey(u: User, next: ObjectKey | null): Promise<boolean> {
  const unchanged = u.avatarKey === null ? isNull(schema.users.avatarKey) : eq(schema.users.avatarKey, u.avatarKey);
  const moved = await getDb()
    .update(schema.users)
    .set({ avatarKey: next })
    .where(and(eq(schema.users.id, u.id), unchanged))
    .returning({ id: schema.users.id });
  return moved.length > 0;
}

/** A photo no row names any more. A failed delete only leaves an unused object behind, so it is logged, not raised. */
async function discardAvatar(key: string, userId: number) {
  try {
    await deleteAvatar(key, userId);
  } catch (e) {
    console.error(JSON.stringify({ evt: "avatar_delete_failed", key, error: e instanceof Error ? e.message : String(e) }));
  }
}

/** PUT /api/me/avatar — the body is the photo itself, WebP, JPEG or PNG, at most AVATAR_MAX_BYTES. */
export async function PUT(req: Request) {
  try {
    const u = await memberWithStorage();
    if (Number(req.headers.get("content-length")) > AVATAR_MAX_BYTES) throw new HttpError(413, TOO_LARGE);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > AVATAR_MAX_BYTES) throw new HttpError(413, TOO_LARGE);
    const type = avatarType(bytes, req.headers.get("content-type"));
    if (!type) throw new HttpError(415, "WebP, JPEG, PNG 이미지만 올릴 수 있습니다. 설정 화면에서 사진을 다시 고르세요");

    const key = newAvatarKey(u.id, type.ext);
    try {
      await putAvatar(key, bytes, type.contentType);
    } catch (e) {
      console.error(JSON.stringify({ evt: "avatar_put_failed", key, error: e instanceof Error ? e.message : String(e) }));
      throw new HttpError(502, "사진을 저장소에 올리지 못했습니다. 잠시 뒤 다시 저장하세요");
    }
    let swapped: boolean;
    try {
      swapped = await swapAvatarKey(u, key);
    } catch (e) {
      // The update may have committed with only its reply lost, so the new object stays: an orphan, never a missing photo.
      console.error(JSON.stringify({ evt: "avatar_swap_failed", key, previous: u.avatarKey }));
      throw e;
    }
    if (!swapped) {
      await discardAvatar(key, u.id);
      throw new HttpError(409, RACED);
    }
    if (u.avatarKey) await discardAvatar(u.avatarKey, u.id);
    return Response.json({ avatarUrl: avatarUrl(key) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/me/avatar — clear the row first, then delete the photo it named. */
export async function DELETE() {
  try {
    const u = await memberWithStorage();
    if (u.avatarKey) {
      if (!(await swapAvatarKey(u, null))) throw new HttpError(409, RACED);
      await discardAvatar(u.avatarKey, u.id);
    }
    return Response.json({ avatarUrl: null });
  } catch (e) {
    return errorResponse(e);
  }
}
