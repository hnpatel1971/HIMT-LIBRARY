import { db, schema } from "./db/index.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function audit(tx: Tx | typeof db, userId: number | null, action: string, details?: unknown) {
  await tx.insert(schema.auditLog).values({ userId, action, details: details ?? null });
}
