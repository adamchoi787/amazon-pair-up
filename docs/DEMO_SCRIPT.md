# Demo video script (under 3:00, English, no third-party brands or music)

Judges may stop at 3:00, so put the best material first.

| Time | Shot | Words |
|---|---|---|
| 0:00–0:15 | Title + one line | "AmazonPairUp: a voice-first marketplace on Alexa+ that pairs buyers and sellers directly, for things and for help. Say what you have, what you can do or what you need, and Alexa pairs you up, settles a fair price and closes the deal." |
| 0:15–0:30 | Problem | "Trading with another person means photos, forms and haggling, and getting a small job done means paying a platform on top. So small things rarely happen: the calculator next door, the lunch run two buildings over." |
| 0:30–1:15 | **Things** (split screen: two devices + live dashboard) | Seller: "Alexa, sell my TI-84 for $20. I'll accept anything above $15." · Buyer: "Alexa, I need a graphing calculator today, maximum $18." · Alexa: "Found it: TI-84 Plus graphing calculator for $18, $2 below asking. Meet-up: HKUST campus. Should I confirm it?" · "Yes." · Dashboard: deal confirmed, 🔒 limits never shown. |
| 1:15–1:55 | **Errands** (same two devices) | Runner: "Alexa, I can do lunch runs around campus for $4 a run, at least $3." · Hungry student: "Alexa, find someone to pick up my lunch from LG7 canteen to Hall 5 by 12:30, $5." · Alexa: "Found someone: Ken can do it for $4 … From LG7 canteen to Hall 5, by 12:30. Should I confirm?" · "Yes." · Runner's device: "New job … Want it?" · "Yes." · Card: pickup → drop-off, time, Booked. "The fee goes to the person who walks." |
| 1:55–2:10 | **One-time jobs** | "Alexa, get me a helper for the event on Saturday 2-6pm, budget $10 an hour." · Card: "$10 an hour, $40 for 4 hours." "Same engine, same private limits." |
| 2:10–2:40 | How it works | Architecture diagram: Alexa+ → MCP server (Streamable HTTP, spec 2025-11-25) → Bedrock intent extraction (item or task, fee or hourly rate, pickup, time) → pgvector hybrid search → pairing-core settlement (Rust → WebAssembly) → deal. Say it plainly: no agent haggling; one fixed rule settles every deal, and the seller's minimum never shows through the price. Flash the "$1 iPhone? Is $1 right?" check and the dashboard's learning panel (completion rate by day, learned vs control). |
| 2:40–2:55 | Bee and watch | Show the labelled demo replay, a calculator suggestion in For you, and /watch/ with Yes/No. Say “anything I need?” then “what do you know about me?” Show a learned lunch routine and Forget. Describe the replay as demo data. |
| 2:55–3:00 | Close | Impact line + team names. |

## Recording checklist
- [ ] Run `npm run reset` before each take (the TI-84 and the campus lunch runs are created live, so they stay out of the seed)
- [ ] Dashboard open, zoomed to 125%
- [ ] Deployed URL, not localhost, if possible
- [ ] Captions on the spoken lines

For the lifestyle beat, use a scratch database and `npm run seed -- --lifestyle`. Sign in as Tony locally. Lunch is due from 10:45 to 12:45 HKT on weekdays; record in that window or use the deterministic test fixture for a clearly labelled demonstration. See BEE.md for replay. Test the watch preview in the same browser after sign-in; Siri hardware validation is a separate step.
