import { createHmac, timingSafeEqual } from "node:crypto";

// Ring webhooks (Partner API notifications, payload v1.1). Ring signs each
// POST with HMAC-SHA256 over the raw body, sent as `X-Signature: sha256=<hex>`
// with the app's HMAC signing key. The signature is checked on the raw bytes
// before the JSON is trusted. PairUp Points use two event types:
//   button_press     someone pressed the doorbell at a point
//   motion_detected  sub_type "human" (Smart Alerts on) or "motion" (off)
// Shape: { meta: { version, time, request_id, account_id },
//          data: { id, type, attributes: { source, source_type, timestamp, sub_type? } } }

export const RING_WEBHOOK_PATH = "/api/ring/webhook";

export function ringSignature(raw: Buffer | string, key: string) {
  return `sha256=${createHmac("sha256", key).update(raw).digest("hex")}`;
}

/** Constant-time check of an X-Signature header against the raw body. */
export function verifyRingSignature(raw: Buffer | undefined, header: string | undefined, key: string) {
  if (!raw || !header || !key) return false;
  const want = Buffer.from(ringSignature(raw, key));
  const got = Buffer.from(header.trim().toLowerCase());
  return want.length === got.length && timingSafeEqual(want, got);
}

export interface RingNotification {
  request_id: string | null;
  event_id: string;
  event_type: string;
  sub_type: string | null;
  device_id: string;
  at: number;
}

/** The fields PairUp uses from a verified webhook body, or null when it isn't a device event. */
export function parseRingNotification(body: unknown): RingNotification | null {
  const b = body as { meta?: { request_id?: unknown }; data?: { id?: unknown; type?: unknown; attributes?: Record<string, unknown> } } | null;
  const a = b?.data?.attributes;
  if (!b?.data || !a || a.source_type !== "devices" || typeof a.source !== "string") return null;
  const at = Number(a.timestamp);
  if (!Number.isFinite(at) || typeof b.data.type !== "string") return null;
  return {
    request_id: typeof b.meta?.request_id === "string" ? b.meta.request_id : null,
    event_id: typeof b.data.id === "string" ? b.data.id : `${a.source}_${b.data.type}_${at}`,
    event_type: b.data.type,
    sub_type: typeof a.sub_type === "string" ? a.sub_type : null,
    device_id: a.source,
    at,
  };
}
