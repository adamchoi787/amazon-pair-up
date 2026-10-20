import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/client.js";
import { shortId } from "../market/events.js";
import { ensureUser } from "../market/service.js";

// Device tokens: what an Apple Watch Shortcut or the Bee bridge uses instead of
// an OAuth session. A signed-in user creates one in the web app, sees it once,
// and can revoke it at any time. A device token reaches only /api/voice and
// /api/context, never /mcp, so a lost watch can't post or confirm through any
// other path, and every confirm still needs the user's spoken yes.

export const DEVICE_KINDS = ["watch", "bee", "phone"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
const MAX_DEVICES = 10;
const PREFIX = "apd_";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function createDeviceToken(db: Db, userId: string, kind: DeviceKind, label: string) {
  await ensureUser(db, userId);
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM device_tokens WHERE user_id = $1 AND NOT revoked`, [userId]);
  if (rows[0].n >= MAX_DEVICES) throw Object.assign(new Error(`You can connect up to ${MAX_DEVICES} devices. Remove one first.`), { status: 400 });
  const id = shortId("dev");
  const token = PREFIX + randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO device_tokens (id, token_hash, user_id, label, kind) VALUES ($1,$2,$3,$4,$5)`,
    [id, sha256(token), userId, label.trim().slice(0, 40) || kind, kind],
  );
  return { device_id: id, kind, label, token };
}

/** The user and device behind a device token, or null. */
export async function deviceForToken(db: Db, authorization: string | undefined) {
  const token = authorization?.match(/^Bearer\s+(apd_\S+)$/)?.[1];
  if (!token) return null;
  const { rows } = await db.query<{ id: string; user_id: string; kind: DeviceKind }>(
    `UPDATE device_tokens SET last_used_at = now() WHERE token_hash = $1 AND NOT revoked RETURNING id, user_id, kind`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

export async function listDevices(db: Db, userId: string) {
  const { rows } = await db.query<{ id: string; kind: string; label: string; created_at: Date; last_used_at: Date | null }>(
    `SELECT id, kind, label, created_at, last_used_at FROM device_tokens WHERE user_id = $1 AND NOT revoked ORDER BY created_at`,
    [userId],
  );
  return rows.map((r) => ({
    device_id: r.id, kind: r.kind, label: r.label,
    created_at: new Date(r.created_at).toISOString(), last_used_at: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
  }));
}

export async function revokeDevice(db: Db, userId: string, deviceId: string) {
  const { rows } = await db.query(`UPDATE device_tokens SET revoked = TRUE WHERE id = $1 AND user_id = $2 AND NOT revoked RETURNING id`, [deviceId, userId]);
  return rows.length > 0;
}
