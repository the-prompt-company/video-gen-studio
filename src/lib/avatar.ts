/** Profile photos. The browser crops and scales every photo to an AVATAR_SIDE square before upload. The browser imports this module too. */
export const AVATAR_SIDE = 256;
export const AVATAR_MAX_BYTES = 512 * 1024;

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The stored types, each with the bytes its files start with: [offset, expected bytes]. */
const AVATAR_TYPES = [
  { contentType: "image/webp", ext: "webp", magic: [[0, ascii("RIFF")], [8, ascii("WEBP")]] },
  { contentType: "image/jpeg", ext: "jpg", magic: [[0, [0xff, 0xd8, 0xff]]] },
  { contentType: "image/png", ext: "png", magic: [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]] },
] as const satisfies readonly { contentType: string; ext: string; magic: readonly (readonly [number, readonly number[]])[] }[];

export type AvatarType = Pick<(typeof AVATAR_TYPES)[number], "contentType" | "ext">;

/** The type of an upload whose declared Content-Type is an avatar type and whose bytes start like one. Null otherwise. */
export function avatarType(bytes: Uint8Array, declared: string | null): AvatarType | null {
  const mime = declared?.split(";")[0].trim().toLowerCase();
  const type = AVATAR_TYPES.find((t) => t.contentType === mime);
  if (!type) return null;
  const starts = type.magic.every(([at, expected]) => expected.every((b, i) => bytes[at + i] === b));
  return starts ? { contentType: type.contentType, ext: type.ext } : null;
}
