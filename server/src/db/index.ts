import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set, e.g. mysql://user:password@localhost:3306/himt_library");
}

export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 10,
  dateStrings: true,
  timezone: "+05:30",
});
export const db = drizzle(pool, { schema, mode: "default" });
export { schema };
