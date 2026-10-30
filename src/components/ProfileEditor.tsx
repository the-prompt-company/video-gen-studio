"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { Button, ErrorText, Field, Input } from "@/components/ui";
import { AVATAR_MAX_BYTES, AVATAR_SIDE } from "@/lib/avatar";
import { parseAppError, type AppError } from "@/lib/errors";
import { MAX_NICKNAME_LENGTH, parseNickname, type ParsedNickname } from "@/lib/nickname";
import { useErrorText } from "@/i18n/errors";

type Photo =
  | { kind: "shown" }
  | { kind: "preparing" }
  | { kind: "picked"; blob: Blob; preview: string }
  | { kind: "saving"; blob: Blob; preview: string }
  | { kind: "removing" };

type Note = { tone: "done" | "failed"; text: string } | null;

/** Center square of the photo at AVATAR_SIDE px, as WebP where the browser encodes it and JPEG elsewhere. */
async function squarePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIDE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
  const webp = await encode("image/webp");
  if (webp?.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg");
  if (!jpeg) throw new Error("canvas encoding failed");
  return jpeg;
}

async function errorOf(res: Response): Promise<AppError> {
  return parseAppError(await res.json().catch(() => null), res.status);
}

export function ProfileEditor({
  username,
  nickname: savedNickname,
  avatarUrl,
  photoStorage,
}: {
  username: string;
  nickname: string | null;
  avatarUrl: string | null;
  photoStorage: boolean;
}) {
  const router = useRouter();
  const errorText = useErrorText();
  const picker = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState(avatarUrl);
  const [photo, setPhoto] = useState<Photo>({ kind: "shown" });
  const [photoNote, setPhotoNote] = useState<Note>(null);
  const [nickname, setNickname] = useState(savedNickname);
  const [typed, setTyped] = useState(savedNickname ?? "");
  const [nicknameNote, setNicknameNote] = useState<Note>(null);
  const [savingNickname, setSavingNickname] = useState(false);

  const preview = photo.kind === "picked" || photo.kind === "saving" ? photo.preview : null;
  useEffect(() => (preview ? () => URL.revokeObjectURL(preview) : undefined), [preview]);

  const name = nickname ?? username;
  const busy = photo.kind === "preparing" || photo.kind === "saving" || photo.kind === "removing";

  async function pick(file: File | undefined) {
    if (!file) return;
    setPhotoNote(null);
    setNicknameNote(null);
    setPhoto({ kind: "preparing" });
    try {
      const blob = await squarePhoto(file);
      if (blob.size > AVATAR_MAX_BYTES) throw new Error("too large");
      setPhoto({ kind: "picked", blob, preview: URL.createObjectURL(blob) });
    } catch {
      setPhoto({ kind: "shown" });
      setPhotoNote({ tone: "failed", text: "이 파일은 사진으로 열 수 없습니다. JPG, PNG, WebP 같은 이미지 파일을 고르세요" });
    }
  }

  async function savePhoto() {
    if (photo.kind !== "picked") return;
    setPhotoNote(null);
    setNicknameNote(null);
    setPhoto({ ...photo, kind: "saving" });
    try {
      const res = await fetch("/api/me/avatar", { method: "PUT", headers: { "Content-Type": photo.blob.type }, body: photo.blob, cache: "no-store" });
      if (!res.ok) {
        setPhoto({ ...photo, kind: "picked" });
        setPhotoNote({ tone: "failed", text: errorText(await errorOf(res)) });
        return;
      }
      const body = (await res.json()) as { avatarUrl: string | null };
      setPhotoUrl(body.avatarUrl);
      setPhoto({ kind: "shown" });
      setPhotoNote({ tone: "done", text: "사진을 저장했습니다." });
      router.refresh();
    } catch {
      setPhoto({ ...photo, kind: "picked" });
      setPhotoNote({ tone: "failed", text: "서버에 연결할 수 없습니다. 연결을 확인하고 다시 저장하세요" });
    }
  }

  async function removePhoto() {
    setPhotoNote(null);
    setNicknameNote(null);
    setPhoto({ kind: "removing" });
    try {
      const res = await fetch("/api/me/avatar", { method: "DELETE", cache: "no-store" });
      setPhoto({ kind: "shown" });
      if (!res.ok) {
        setPhotoNote({ tone: "failed", text: errorText(await errorOf(res)) });
        return;
      }
      setPhotoUrl(null);
      setPhotoNote({ tone: "done", text: "사진을 지웠습니다. 상단 메뉴에는 이름의 첫 글자가 보입니다." });
      router.refresh();
    } catch {
      setPhoto({ kind: "shown" });
      setPhotoNote({ tone: "failed", text: "서버에 연결할 수 없습니다. 연결을 확인하고 다시 시도하세요" });
    }
  }

  const parsed: ParsedNickname | { ok: true; nickname: null } = typed.trim() ? parseNickname(typed) : { ok: true, nickname: null };
  const unchanged = parsed.ok && parsed.nickname === nickname;

  async function saveNickname(e: FormEvent) {
    e.preventDefault();
    setPhotoNote(null);
    if (!parsed.ok) {
      setNicknameNote({ tone: "failed", text: errorText(parsed.reason) });
      return;
    }
    setSavingNickname(true);
    setNicknameNote(null);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: parsed.nickname }),
        cache: "no-store",
      });
      if (!res.ok) {
        setNicknameNote({ tone: "failed", text: errorText(await errorOf(res)) });
        return;
      }
      const body = (await res.json()) as { nickname: string | null };
      setNickname(body.nickname);
      setTyped(body.nickname ?? "");
      setNicknameNote({ tone: "done", text: body.nickname ? "닉네임을 저장했습니다." : "닉네임을 지웠습니다. 상단 메뉴에 ID가 보입니다." });
      router.refresh();
    } catch {
      setNicknameNote({ tone: "failed", text: "서버에 연결할 수 없습니다. 연결을 확인하고 다시 저장하세요" });
    } finally {
      setSavingNickname(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex items-center gap-5">
          <Avatar name={name} url={preview ?? photoUrl} size="lg" alt={preview ? "새 프로필 사진 미리보기" : "프로필 사진"} />
          <div className="flex flex-wrap gap-2">
            {photo.kind === "picked" || photo.kind === "saving" ? (
              <>
                <Button type="button" size="sm" onClick={savePhoto} disabled={photo.kind === "saving"} aria-busy={photo.kind === "saving"}>
                  {photo.kind === "saving" ? "저장 중…" : "사진 저장"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPhoto({ kind: "shown" })} disabled={photo.kind === "saving"}>
                  취소
                </Button>
              </>
            ) : (
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => picker.current?.click()} disabled={!photoStorage || busy}>
                  {photo.kind === "preparing" ? "사진 준비 중…" : photoUrl ? "사진 바꾸기" : "사진 고르기"}
                </Button>
                {photoUrl && (
                  <Button type="button" size="sm" variant="ghost" onClick={removePhoto} disabled={!photoStorage || busy} aria-busy={photo.kind === "removing"}>
                    {photo.kind === "removing" ? "지우는 중…" : "사진 삭제"}
                  </Button>
                )}
              </>
            )}
            <input
              ref={picker}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        {photoStorage ? (
          <p className="break-keep text-xs leading-relaxed text-subtle">
            {preview
              ? "미리보기입니다. 사진 저장을 눌러야 바뀝니다."
              : `이미지 파일을 고르면 가운데를 정사각형으로 잘라 ${AVATAR_SIDE}×${AVATAR_SIDE}으로 줄인 뒤 올립니다.`}
          </p>
        ) : (
          <p role="status" className="break-keep rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-foreground-2">
            사진 저장소(Vercel Blob)가 연결되지 않아 지금은 사진을 바꿀 수 없습니다. 관리자에게 연결을 요청하세요.
          </p>
        )}
        {photoNote?.tone === "failed" && <ErrorText>{photoNote.text}</ErrorText>}
        {photoNote?.tone === "done" && (
          <p role="status" className="break-keep text-sm text-foreground-2">
            {photoNote.text}
          </p>
        )}
      </div>

      <form onSubmit={saveNickname} className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="닉네임" hint={`${Array.from(typed.trim()).length}/${MAX_NICKNAME_LENGTH}`}>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={username} autoComplete="nickname" aria-describedby="nickname-help" />
            </Field>
          </div>
          <Button type="submit" variant={unchanged ? "outline" : "primary"} disabled={savingNickname || unchanged} aria-busy={savingNickname}>
            {savingNickname ? "저장 중…" : "닉네임 저장"}
          </Button>
        </div>
        <p id="nickname-help" className="break-keep text-xs leading-relaxed text-subtle">
          비워 두고 저장하면 닉네임이 지워지고 ID가 보입니다. 다른 사람과 같아도 됩니다.
        </p>
        {nicknameNote?.tone === "failed" && <ErrorText>{nicknameNote.text}</ErrorText>}
        {nicknameNote?.tone === "done" && (
          <p role="status" className="break-keep text-sm text-foreground-2">
            {nicknameNote.text}
          </p>
        )}
      </form>
    </div>
  );
}
