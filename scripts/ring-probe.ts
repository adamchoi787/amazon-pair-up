// npm run ring:probe
// Calls the Ring Partner API with RING_ACCESS_TOKEN (a Ring Developer
// Playground token: developer.amazon.com/ring/console/playground, valid 30
// minutes) and prints each device with its recent Event History, then the
// RING_POINT_DEVICES line that links the first device to the HUB PairUp Point.
import { config } from "../src/config.js";
import { RingClient } from "../src/ring/client.js";

const token = config.ring.accessToken;
if (!token) {
  console.error("Set RING_ACCESS_TOKEN to a Ring Partner API token (Playground: Generate Token).");
  process.exit(1);
}
const ring = new RingClient(token, { apiBase: config.ring.apiBase });
const devices = await ring.devices();
console.log(`${devices.length} Ring device(s):`);
for (const d of devices) {
  const events = await ring.history(d.id, { since: Date.now() - 24 * 3600_000, maxPages: 1 });
  console.log(`- ${d.name}  id=${d.id}  events in the last 24 h: ${events.length}`);
  for (const e of events.slice(0, 5)) console.log(`    ${new Date(e.start).toISOString()}  ${e.event_type}`);
}
if (devices[0]) console.log(`\nLink it to the HUB point:\n  RING_POINT_DEVICES=pt_uw_hub=${devices[0].id}`);
