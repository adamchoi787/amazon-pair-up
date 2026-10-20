// npm run ring:simulate -- [--type button_press|motion_detected] [--device <id>]
// Demo tool: sends one Ring webhook (payload v1.1, as documented for the Ring
// Partner API) to a running PairUp server, signed with RING_HMAC_KEY exactly as
// Ring signs it, so the real verify-and-confirm path runs. Use it where no Ring
// app can deliver webhooks (the Playground has none). The event is labelled
// demo in its request_id.
import { randomUUID } from "node:crypto";
import { config } from "../src/config.js";
import { ringSignature } from "../src/ring/webhook.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const type = arg("type") ?? "button_press";
const device = arg("device") ?? config.ring.pointDevices.split(",")[0]?.split("=")[1]?.trim();
const url = `${(process.env.PAIRUP_URL ?? `http://127.0.0.1:${config.port}`).replace(/\/$/, "")}/api/ring/webhook`;
if (!config.ring.hmacKey || !device) {
  console.error("Set RING_HMAC_KEY and RING_POINT_DEVICES (pt_uw_hub=<device id>), or pass --device.");
  process.exit(1);
}
const now = Date.now();
const body = JSON.stringify({
  meta: { version: "1.1", time: new Date(now).toISOString(), request_id: `demo_${randomUUID()}`, account_id: "demo" },
  data: {
    id: `${device}_${type}_${now}`,
    type,
    attributes: { source: device, source_type: "devices", timestamp: now, ...(type === "motion_detected" ? { sub_type: "human" } : {}) },
    relationships: { devices: { links: { self: `/v1/devices/${device}` } } },
  },
});
const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Signature": ringSignature(body, config.ring.hmacKey) }, body });
console.log(res.status, await res.text());
