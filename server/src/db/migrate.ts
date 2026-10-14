import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, schema } from "./index.js";
import { hashPassword } from "../auth.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from src/ (tsx) and dist/src/ (built).
const migrationsFolder = here.includes(`${path.sep}dist${path.sep}`)
  ? path.resolve(here, "../../../migrations")
  : path.resolve(here, "../../migrations");

/** Applies schema migrations, then adds the defaults a fresh install needs. */
export async function migrateAndSeed() {
  await migrate(db, { migrationsFolder });

  const [weeklyOff] = await db.select().from(schema.settings).where(eq(schema.settings.key, "weekly_off"));
  if (!weeklyOff) {
    await db.insert(schema.settings).values([
      { key: "weekly_off", value: [0] },
      { key: "library_name", value: "HIMT College Library" },
    ]);
  }

  // Make sure the admin named in the settings file exists. An existing user's
  // password is left alone, so changing it in the app sticks.
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.users);
    if (Number(n) === 0) console.warn("No staff users yet. Set ADMIN_USERNAME and ADMIN_PASSWORD to create the first admin.");
    return;
  }
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, username));
  if (!existing) {
    await db.insert(schema.users).values({
      username,
      name: "Administrator",
      passwordHash: await hashPassword(password),
      role: "admin",
    });
    console.log(`Created admin user "${username}"`);
  }
}
