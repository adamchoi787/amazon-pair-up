# PairUp — integrated 2 minute 55 second demo

Use one public English YouTube/Vimeo video under three minutes. Lead with Alexa+; show Ring inside the same video when entering Ring. Include Bee as a track only after real Bee-device/Bee-on-Watch data is available. The online sourcing result and options are in BEE_DATA_SOURCES.md. Until then the Bee beat is a labelled replay-tested supporting feature.

## Before recording

Follow RECORDING_CHECKLIST.md. Run the submitted release and its identity/evidence checks. Rehearse a fresh judge sign-in. Use a disposable database for repeated takes; reset/seed that database deliberately. `/app/demo.html` provides separate buyer/seller sessions, current UW users, scenario buttons and a script-hide control. Reloading screens retains posts and deals. Local name shortcuts work only with AUTH_MODE=none; prepare each device slot through a full-tab OAuth sign-in on a hosted build, then reload the embedded screens (RECORDING_CHECKLIST.md).

Record clean inserts of Ring Playground and successful AWS evidence before cutting the main take. Select a future service date and say Pacific time. All seed users, market posts, Hub locations/rates and references are demo data. The watch page is a browser preview; the actual Siri Shortcut runs on Apple Watch.

## Shot list

| Time | Show | Voiceover / meaning |
|---|---|---|
| 0:00–0:10 | UW exam need; two signed-in devices | “A calculator in the next dorm should take one sentence to find. PairUp connects people who need something with people who have it or can help.” |
| 0:10–0:26 | Sam: “Sell my TI-84 for $20. I'll take anything above $15.” His own listing shows the private minimum | “The seller delegates a limit once. Their agent keeps it private.” |
| 0:26–0:43 | Mei: “I need a graphing calculator in good condition near UW campus today, max $18.” Show TI-84 at $18 and demo Hub meeting point | “A standing need meets the seller. Our open Rust/WASM rule accepts the buyer's offer inside the seller's limit.” |
| 0:43–0:55 | Mei confirms; Sam receives the agreed deal | “People approve the deal and pay each other at hand-off.” Optional quick insert: a separate proposed deal's Hub delivery toggle, fee and total. Caption **demo delivery quote — no carrier booking**. |
| 0:55–1:20 | Choose PairUp Point. Insert official Ring Playground/device and ring:probe event. Show both people's check-ins, then Both here on the card/watch | “Ring presence events corroborate their arrival at one shared point. PairUp requests no video.” Caption **Ring Playground** or **Ring device**; separately label a local webhook sender **local simulated webhook**. |
| 1:20–1:45 | A waiting Saturday 2–6pm event-help request; eligible helper; rate $10/hr, total $40, time zone and helper's final yes | “The same contract books services. The full work window must fit, bookings cannot overlap, and tentative times wait for the helper.” |
| 1:45–2:10 | With qualifying Bee data: show actual device-recorded exam need → CLI/Skill/MCP → PairUp suggestion → budget and explicit yes → useful request. Otherwise show captioned replay and routine/watch feature | “Context prepares a request. The student decides whether to post it.” For replay use **synthetic Bee-format fixture / watch preview** and leave Bee track pending. |
| 2:10–2:35 | Runtime evidence report plus concise architecture: MCP → retrieval → pairing-core → transaction → card; successful Bedrock and optional AgentCore result | “Bedrock understands language and embeds needs. Strands uses the same tools through AgentCore. Code enforces prices, schedules and consent.” Show AgentCore as hosted only when its real invocation passed. |
| 2:35–2:55 | pairing-core repo, contributor/commit, tests; end on agreed deal | “We began with Carousell for agents, grew into C2C for products and services, then connected the hand-off and the context before it. The price primitive is open source. Next: an observed campus pilot.” |

The Ring footage must demonstrate an official simulator or device; the local HMAC sender alone covers rehearsal. All entered tracks need visible evidence within the first three minutes. Keep credential windows, real private context and unrelated people out of the recording. Use footage/music/trademarks only with the necessary rights. Describe the browser as a simulated Alexa+ experience and the Hub flow as a demo model.
