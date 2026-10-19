import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";

// Shared by the service and the pairing engine.

export const shortId = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;

/** Append to the audit trail that powers the dashboard. Never put private limits in `detail`. */
export async function logEvent(db: Db, kind: string, actorId: string | null, refId: string | null, detail: object = {}) {
  await db.query(`INSERT INTO events (kind, actor_id, ref_id, detail) VALUES ($1,$2,$3,$4)`, [
    kind, actorId, refId, JSON.stringify(detail),
  ]);
}
