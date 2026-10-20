import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Db } from "../db/client.js";

// Shared by the service and the pairing engine.

export const shortId = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;

/** One recorded market event, as listeners see it (src/mcp/subscriptions.ts tells subscribed agents). */
export interface MarketEvent {
  db: Db;
  kind: string;
  actorId: string | null;
  refId: string | null;
  detail: Record<string, unknown>;
}

/** Emits "event" with a MarketEvent after each one is recorded. Listeners must not throw. */
export const marketEvents = new EventEmitter();

/** Append to the audit trail that powers the dashboard. Never put private limits in `detail`. */
export async function logEvent(db: Db, kind: string, actorId: string | null, refId: string | null, detail: object = {}) {
  await db.query(`INSERT INTO events (kind, actor_id, ref_id, detail) VALUES ($1,$2,$3,$4)`, [
    kind, actorId, refId, JSON.stringify(detail),
  ]);
  if (marketEvents.listenerCount("event")) {
    marketEvents.emit("event", { db, kind, actorId, refId, detail: detail as Record<string, unknown> } satisfies MarketEvent);
  }
}
