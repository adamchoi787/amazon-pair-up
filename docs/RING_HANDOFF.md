# Ring track handoff: PairUp Point (branch `ring-pairup-point`)

Written October 20, 2026 by the Ring session before a usage limit. Continue from here.

## The idea
PairUp Points are small unstaffed hand-off spots, each watched by one Ring doorbell or camera. Two paired people who'd rather not meet a stranger anywhere else pick a point for their deal. Each presses the Ring doorbell on arrival and tells PairUp "I'm here". Ring confirms each arrival; once both are confirmed the deal shows "both here" and the hand-off goes ahead. No staff, no video kept, no face recognition.

## Ring access (researched from developer.amazon.com/docs/ring)
- Partner API: `https://api.amazonvision.com`, `Authorization: Bearer <token>`, JSON:API, server-to-server only (CORS blocks browsers).
- Playground: https://developer.amazon.com/ring/console/playground. Needs the user's Amazon developer sign-in. One-click token valid 30 minutes (scope `ava.v1:read`), one simulated device, live-view simulation for Package / Vehicle / Motion. Simulations show up in Event History as `on_demand` events (per other hackathon entries), so `RING_SANDBOX=true` counts them as presence.
- Endpoints used: `GET /v1/devices`, `GET /v1/history/devices/{id}/events` (newest first, `links.next`, attributes `event_type` motion | ding | on_demand, `start`/`end` epoch ms).
- Webhooks (needs a real Ring app with an HMAC key; not available in the Playground): `X-Signature: sha256=<hex HMAC-SHA256 of raw body>`; `data.type` = `button_press` | `motion_detected`, `data.attributes.source` = device id, `.timestamp` epoch ms, `.sub_type` human | vehicle | package_delivery | other_motion | motion; `meta.request_id`.

## Built (all on this branch)
- `src/ring/client.ts` RingClient (devices, history). `src/ring/webhook.ts` signature check + payload parse.
- `src/market/points.ts` points registry (`data/pairup-points.json`, demo data), `list_meetup_points`, `choose_meetup_point`, `check_in_at_point`, webhook recording, arrival matching (Ring presence event within 10 min of the check-in), 24 h / 30 day purge.
- Schema: `meetups`, `meetup_arrivals`, `ring_events` (src/db/schema.ts). Deal view: `meetup.point` with `status` chosen | one_here | both_here and `you` / `them` = not_here | checked_in | confirmed.
- `POST /api/ring/webhook` in src/app.ts (raw body kept by the JSON parser's verify hook; replaced createMcpExpressApp with the same host validation inline).
- Config: `RING_ACCESS_TOKEN`, `RING_API_BASE`, `RING_HMAC_KEY`, `RING_POINT_DEVICES` (`pt_uw_hub=<device id>`), `RING_SANDBOX`.
- `delete_my_data` deletes the user's arrivals. `test/points.test.ts` covers client, presence rule, signature, the full two-person flow over the webhook.

## Left to do
1. `test/points.test.ts` passes (5/5) and typecheck is clean. Run the full `npm test` once more after the merge.
2. Merge with main: another session ("Delivery and robotic fulfillment support") is adding Amazon Hub delivery in the same files (views.ts `handoff`/`delivery`, service.ts, server.ts, schemas.ts). When delivery is chosen, `meetup` is empty, so `meetup.point` must be null for delivery deals too.
3. Done: `npm run ring:probe` (real Playground call: devices + history, prints the RING_POINT_DEVICES line) and `npm run ring:simulate` (signed Ring v1.1 webhook to the local server, labelled demo).
4. Done: card panel in `src/apps/view.ts` (Meet at a PairUp Point, arrival chips, I'm here), bundles rebuilt. Not yet checked visually in a browser; rebuild after the merge (build-info.json fingerprint).
5. Done: offline planner phrases ("I'm here" → check_in_at_point, "meet at a PairUp Point" → choose_meetup_point). Still to do: one sentence about points in the server instructions (server.ts).
6. Docs: TOOL_CONTRACT.md (3 tools, webhook, retention), skills/pairup/SKILL.md, README, `public/privacy.html` (Ring: type and time only, 24 h; arrivals 30 days), DEMO_SCRIPT.md Ring beat, SUBMISSION.md Ring track text + Ring product feedback, AWARD_GAPS.md.
7. Part 1 of the task (Devpost rules into docs/HACKATHON_RULES.md) is not done: Claude in Chrome was not connected and devpost.com returns 403 to fetches. Needs the user's Chrome. Also fix the Bee wording: the Bee track needs live data recorded through a Bee device or an Apple Watch running Bee software; the replay file and the iOS Shortcut path don't qualify.

## For the user
- Video needs real Ring in the loop: sign in to the Playground, generate a token, set `RING_ACCESS_TOKEN`, `RING_SANDBOX=true`, `RING_POINT_DEVICES=pt_uw_hub=<simulated device id>`, run a Motion live-view simulation, then say "I'm here".
- Do not push to main or deploy without asking.
