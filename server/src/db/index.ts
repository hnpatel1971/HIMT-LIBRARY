import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set, e.g. postgres://postgres:password@127.0.0.1:5432/library");
}

// Return DATE columns as "YYYY-MM-DD" strings, never as JS dates.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  options: "-c timezone=Asia/Kolkata",
});
export const db = drizzle(pool, { schema });
export { schema };
