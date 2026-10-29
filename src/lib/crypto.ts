import {
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
} from "node:crypto";

function packHash(salt: Buffer, hash: Buffer): string {
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** scrypt password hash: "scrypt$<salt hex>$<hash hex>" */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return packHash(salt, scryptSync(password, salt, 64));
}

function hashPasswordAsync(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, (err, hash) => (err ? reject(err) : resolve(packHash(salt, hash)))),
  );
}

// A 1-vCPU function gains nothing from more at once, and every extra one holds a libuv thread that DNS and file I/O also wait on.
const HASH_CONCURRENCY = 2;

/** `count` hashes of one password, each with its own salt, on the thread pool so the event loop keeps serving. */
export async function hashPasswords(password: string, count: number): Promise<string[]> {
  const hashes: string[] = [];
  while (hashes.length < count) {
    const batch = Math.min(HASH_CONCURRENCY, count - hashes.length);
    hashes.push(...(await Promise.all(Array.from({ length: batch }, () => hashPasswordAsync(password)))));
  }
  return hashes;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("AUTH_SECRET must be set (16+ chars)");
  return secret;
}

function secretKey(): Buffer {
  return createHash("sha256").update(authSecret()).digest();
}

/** What a token authorizes. Each purpose has its own key, so a token for one never verifies for another. */
export type TokenPurpose = "hf-hook" | "openai-safety";

const TOKEN_CHARS = 32;

/** base64url HMAC-SHA256 of `value` under a key derived from AUTH_SECRET and `purpose`, cut to 32 chars (192 bits). */
export function signToken(purpose: TokenPurpose, value: string): string {
  const key = createHmac("sha256", authSecret()).update(`token:${purpose}`).digest();
  return createHmac("sha256", key).update(value).digest("base64url").slice(0, TOKEN_CHARS);
}

export function verifyToken(purpose: TokenPurpose, value: string, token: string): boolean {
  const expected = Buffer.from(signToken(purpose, value));
  const actual = Buffer.from(token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
