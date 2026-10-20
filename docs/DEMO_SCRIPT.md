# PairUp demo: 2 minutes 55 seconds

The video follows one day on the University of Washington campus. Record with two browser profiles (seller and buyer, plus a helper for the service beat) so each screen shows only its owner's private limits. Caption the web app **Alexa+ experience** and the seed market **demo data**.

## Before recording

1. Use a scratch local or staging market for rehearsals (`PGLITE_DIR`, `npm run reset`). Keep the shared production database for the final take.
2. Run the release you will submit. For a hosted URL, run `npm run check:release` first and make one real Bedrock request.
3. Sign in as three people: a seller, a buyer and a helper. Rehearse the judge sign-in in a fresh browser.
4. Pick a future weekday for the service beat and say the date out loud. For the lunch suggestion, record on a weekday between 10:45 and 12:45 Pacific after `npm run seed -- --lifestyle`.
5. Post the waiting event-help request before recording the helper's arrival.

## Recording beats

| Time | Show | Say |
|---|---|---|
| 0:00–0:12 | A UW student with an exam tomorrow; two signed-in screens | “Someone on campus has the calculator you need. PairUp finds them in one sentence.” |
| 0:12–0:30 | Seller: “Sell my TI-84 for $20. I'll take anything above $15.” | “The seller sets a private minimum once. Only their own screen shows it.” |
| 0:30–0:48 | Buyer: “I need a graphing calculator today, max $18.” The card shows $18 and the Hub Counter | “The buyer's budget is their offer. A fixed rule in our open-source pairing-core settles it inside the seller's limit.” |
| 0:48–1:05 | Buyer says yes; seller sees the agreed deal; buyer asks “where do we meet?” | “Both said yes. They pay at the hand-off.” |
| 1:05–1:30 | A Saturday 2-6pm event request waiting since yesterday; a Sunday-only helper stays unmatched; a weekend helper posts and is paired at once | “The whole work window has to fit the helper's hours, and one helper's bookings never overlap.” |
| 1:30–1:45 | The card: $10/hr × 4 hours = $40, Saturday in Pacific time, waiting for the helper; the helper confirms | “Rate, total, time and whose yes is missing, at a glance.” |
| 1:45–2:10 | Late morning: the For you strip offers the usual lunch run (the HUB → McCarty Hall, about $4). Then the Bee replay suggests a graphing calculator, and the `/watch/` view shows the same suggestion with Yes / No | “PairUp learns your routines and hears what you need. Every suggestion waits for your yes.” Caption: **demo replay**, **watch preview** |
| 2:10–2:35 | Architecture slide plus a real MCP request and result | “Alexa+ or any agent → MCP tools → hybrid search → pairing-core in WebAssembly → a transaction → a card. Amazon Bedrock embeds and understands each request.” |
| 2:35–2:55 | The pairing-core repo and the scheduling and privacy tests running; end on the app | “The price rule is open source for any agent to reuse. Next stop: a pilot with UW students. PairUp: say it, and it's paired.” |

### Ring track cut (separate video, about one minute)

| Show | Say |
|---|---|
| The confirmed TI-84 deal; the buyer taps **Meet at a PairUp Point**; the card names the HUB north entrance point | “Rather not meet a stranger anywhere? Pick a PairUp Point: one Ring doorbell, no staff.” |
| The Ring Developer Playground: run a Motion live-view simulation on the simulated device. Terminal: `npm run ring:probe` lists the device and the new event | “PairUp reads the point's Ring Event History through the Ring Partner API.” Caption: **Ring Playground** |
| The seller says “I'm here”: the chip turns to *here, Ring confirmed*. The buyer says “I'm here”, then `npm run ring:simulate` sends a signed doorbell press | “Ring confirms each arrival. Only the time of the press is kept.” Caption: **simulated webhook** |
| The card: **Both here. Go ahead with the hand-off.** | “Both here, hand-off confirmed. Safe meet-ups with no staff.” |

## Notes

- Show the Bee replay and watch preview as captioned demo beats. The Bee track needs live data recorded through a Bee device or an Apple Watch running Bee software; the replay file and the iOS Shortcut path are demo aids. The Alexa+ track needs no hardware.
- The Ring cut needs a Ring Playground token (valid 30 minutes): set `RING_ACCESS_TOKEN`, `RING_SANDBOX=true`, `RING_POINT_DEVICES=pt_uw_hub=<device id>` and `RING_HMAC_KEY` before recording.
- The dashboard's learning chart runs on the simulated market; caption it **simulation** if shown.
- Keep private limits, tokens and deployment secrets off screen.
