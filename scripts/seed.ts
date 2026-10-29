/**
 * Seed: the first admin (from ADMIN_USERNAME / ADMIN_PASSWORD) and the model rows.
 * Run: npm run db:seed   (loads .env.local via dotenv-cli)
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import { loginId } from "../src/lib/credentials";
import { hashPassword } from "../src/lib/crypto";
import { FAMILIES, FAMILY_IDS } from "../src/lib/catalog";

async function main() {
  const db = getDb();

  for (const id of FAMILY_IDS) {
    const f = FAMILIES[id];
    await db.insert(schema.models).values({ modelId: id, name: f.name, note: f.blurb, pricePerSecUsd: f.rate.defaultUsd.toFixed(4) }).onConflictDoNothing();
  }
  console.log(`models: ${FAMILY_IDS.length} rows ensured`);

  const username = loginId(process.env.ADMIN_USERNAME ?? "");
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    console.log("ADMIN_USERNAME / ADMIN_PASSWORD not set: no admin created");
    return;
  }
  if (password.length < 8) throw new Error("ADMIN_PASSWORD must be 8+ chars");

  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, username)).limit(1);
  if (existing) {
    await db.update(schema.users).set({ passwordHash: hashPassword(password), role: "admin", active: true }).where(eq(schema.users.id, existing.id));
    console.log(`admin "${username}" updated`);
  } else {
    await db.insert(schema.users).values({ username, passwordHash: hashPassword(password), role: "admin" });
    console.log(`admin "${username}" created`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
