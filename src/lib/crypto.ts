import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";

/** scrypt password hash: "scrypt$<salt hex>$<hash hex>" */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function secretKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET must be set (16+ chars)");
  return createHash("sha256").update(secret).digest();
}

/** AES-256-GCM, packed as "v1.<iv>.<tag>.<cipher>" (base64). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decrypt(packed: string): string {
  const [v, ivB, tagB, encB] = packed.split(".");
  if (v !== "v1") throw new Error("unknown cipher version");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encB, "base64")), decipher.final()]).toString(
    "utf8",
  );
}

/** Last 4 characters of the key secret, for display only. */
export function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const secret = key.includes(":") ? (key.split(":").pop() ?? "") : key;
  return `…${secret.slice(-4)}`;
}
