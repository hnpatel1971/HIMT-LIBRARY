import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/** Case-insensitive match for scanned or typed codes (barcodes, member IDs). */
export const sameCode = (col: AnyPgColumn, value: string): SQL => sql`lower(${col}) = lower(${value})`;
