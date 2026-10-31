"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/Avatar";
import { Button, ErrorText, Field, Input } from "@/components/ui";
import { AVATAR_MAX_BYTES, AVATAR_SIDE } from "@/lib/avatar";
import { parseAppError, type AppError, type Reason } from "@/lib/errors";
import { MAX_NICKNAME_LENGTH, parseNickname, type ParsedNickname } from "@/lib/nickname";
import { useErrorText } from "@/i18n/errors";

type Photo =
  | { kind: "shown" }
  | { kind: "preparing" }
  | { kind: "picked"; blob: Blob; preview: string }
  | { kind: "saving"; blob: Blob; preview: string }
  | { kind: "removing" };

/** What the last action did. The page words it at render, so a language switch rewords it too. */
type Note =
  | { kind: "done"; done: "photoSaved" | "photoRemoved" | "nicknameSaved" | "nicknameCleared" }
  | { kind: "failed"; reason: Reason }
  | { kind: "unreadablePhoto" };

const NETWORK: Note = { kind: "failed", reason: { code: "network" } };

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

function NoteLine({ note }: { note: Note | null }) {
  const t = useTranslations("profile");
  const errorText = useErrorText();
  if (!note) return null;
  if (note.kind === "failed") return <ErrorText>{errorText(note.reason)}</ErrorText>;
  if (note.kind === "unreadablePhoto") return <ErrorText>{t("photo.unreadable")}</ErrorText>;
  return (
    <p role="status" className="break-keep text-sm text-foreground-2">
      {t(`done.${note.done}`)}
    </p>
  );
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
  const t = useTranslations("profile");
  const tCommon = useTranslations("common");
  const picker = useRef<HTMLInputElement>(null);
  const [photoUrl, setPhotoUrl] = useState(avatarUrl);
  const [photo, setPhoto] = useState<Photo>({ kind: "shown" });
  const [photoNote, setPhotoNote] = useState<Note | null>(null);
  const [nickname, setNickname] = useState(savedNickname);
  const [typed, setTyped] = useState(savedNickname ?? "");
  const [nicknameNote, setNicknameNote] = useState<Note | null>(null);
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
      setPhotoNote({ kind: "unreadablePhoto" });
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
        setPhotoNote({ kind: "failed", reason: await errorOf(res) });
        return;
      }
      const body = (await res.json()) as { avatarUrl: string | null };
      setPhotoUrl(body.avatarUrl);
      setPhoto({ kind: "shown" });
      setPhotoNote({ kind: "done", done: "photoSaved" });
      router.refresh();
    } catch {
      setPhoto({ ...photo, kind: "picked" });
      setPhotoNote(NETWORK);
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
        setPhotoNote({ kind: "failed", reason: await errorOf(res) });
        return;
      }
      setPhotoUrl(null);
      setPhotoNote({ kind: "done", done: "photoRemoved" });
      router.refresh();
    } catch {
      setPhoto({ kind: "shown" });
      setPhotoNote(NETWORK);
    }
  }

  const parsed: ParsedNickname | { ok: true; nickname: null } = typed.trim() ? parseNickname(typed) : { ok: true, nickname: null };
  const unchanged = parsed.ok && parsed.nickname === nickname;

  async function saveNickname(e: FormEvent) {
    e.preventDefault();
    setPhotoNote(null);
    if (!parsed.ok) {
      setNicknameNote({ kind: "failed", reason: parsed.reason });
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
        setNicknameNote({ kind: "failed", reason: await errorOf(res) });
        return;
      }
      const body = (await res.json()) as { nickname: string | null };
      setNickname(body.nickname);
      setTyped(body.nickname ?? "");
      setNicknameNote({ kind: "done", done: body.nickname ? "nicknameSaved" : "nicknameCleared" });
      router.refresh();
    } catch {
      setNicknameNote(NETWORK);
    } finally {
      setSavingNickname(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex items-center gap-5">
          <Avatar name={name} url={preview ?? photoUrl} size="lg" alt={preview ? t("avatar.preview") : t("avatar.current")} />
          <div className="flex flex-wrap gap-2">
            {photo.kind === "picked" || photo.kind === "saving" ? (
              <>
                <Button type="button" size="sm" onClick={savePhoto} disabled={photo.kind === "saving"} aria-busy={photo.kind === "saving"}>
                  {photo.kind === "saving" ? t("saving") : t("photo.save")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPhoto({ kind: "shown" })} disabled={photo.kind === "saving"}>
                  {tCommon("cancel")}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => picker.current?.click()} disabled={!photoStorage || busy}>
                  {photo.kind === "preparing" ? t("photo.preparing") : photoUrl ? t("photo.change") : t("photo.choose")}
                </Button>
                {photoUrl && (
                  <Button type="button" size="sm" variant="ghost" onClick={removePhoto} disabled={!photoStorage || busy} aria-busy={photo.kind === "removing"}>
                    {photo.kind === "removing" ? t("photo.removing") : t("photo.remove")}
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
          <p className="break-keep text-xs leading-relaxed text-subtle">{preview ? t("photo.previewHint") : t("photo.cropHint", { side: String(AVATAR_SIDE) })}</p>
        ) : (
          <p role="status" className="break-keep rounded-md border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-foreground-2">
            {t("photo.storageOff")}
          </p>
        )}
        <NoteLine note={photoNote} />
      </div>

      <form onSubmit={saveNickname} className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label={t("nickname.label")} hint={t("nickname.counter", { length: String(Array.from(typed.trim()).length), max: String(MAX_NICKNAME_LENGTH) })}>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={username} autoComplete="nickname" aria-describedby="nickname-help" />
            </Field>
          </div>
          <Button type="submit" variant={unchanged ? "outline" : "primary"} disabled={savingNickname || unchanged} aria-busy={savingNickname}>
            {savingNickname ? t("saving") : t("nickname.save")}
          </Button>
        </div>
        <p id="nickname-help" className="break-keep text-xs leading-relaxed text-subtle">
          {t("nickname.help")}
        </p>
        <NoteLine note={nicknameNote} />
      </form>
    </div>
  );
}
