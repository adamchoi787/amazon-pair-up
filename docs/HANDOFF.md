# Team handoff

**Deadline:** Fri Oct 23, 12:00pm PDT = **Sat Oct 24, 3:00am HKT**.
**Our target:** submitted by **Fri Oct 23, 9:00pm HKT**. The last hours are buffer, not build time.

## Ground rules

1. `main` must always run: `npm test` passes and `npm run smoke` works.
2. One branch per task: `a/alexa-connect`, `b/hybrid-tuning`, `c/bedrock-intent`… Small PRs, merged the same day.
3. **The tool contract is frozen** ([TOOL_CONTRACT.md](TOOL_CONTRACT.md)). Changing a tool name or argument? Post in the group chat first. A changes `src/mcp/server.ts` and the doc together.
4. Never return a counterparty's `min_price` / `max_price`. All output goes through `src/market/views.ts`. The tests check for leaks.
5. Everyone writes in [FRICTION_LOG.md](FRICTION_LOG.md) **as it happens** (worth up to +10% of the judging score).
6. Don't use "Carousell" or other third-party brands in the video or UI.

## Setup for everyone (5 min)

```bash
git clone <repo-url> && cd voice-market-mcp
npm install
npm run reset && npm test
npm start            # leave running
npm run smoke        # in a second terminal → "Smoke test passed."
```

Open http://127.0.0.1:3000/ to watch the dashboard update while smoke runs.

---

## A: Integration, Alexa+, demo (owner: Adam)

Files: `src/app.ts`, `src/mcp/server.ts`, `scripts/smoke.ts`, `docs/DEMO_SCRIPT.md`

- [ ] **Today:** find out whether we can connect a custom MCP server to Alexa+ (developer preview / office hours / docs in the hackathon Resources). Log every step in the friction log.
- [ ] Deploy to AWS with HTTPS. Options: AgentCore Runtime, App Runner, or Lambda + Function URL. Set `HOST=0.0.0.0`, `ALLOWED_HOSTS=<your domain>`, `MCP_API_KEY`. Use a hosted Postgres with pgvector through `DATABASE_URL`.
- [ ] Identity: replace the `X-User-Id` header with whatever Alexa+ gives us (account linking / OAuth). Until then, use `user_id` arguments.
- [ ] **Fallback path, decide by Tue night:** if real Alexa+ isn't available, build a "simulated Alexa+" web page with push-to-talk voice in and out, plus an agent (Bedrock) that calls **our real MCP server**. That's allowed by the rules and still shows the MCP server working.
- [ ] Tune the tool descriptions and `say` lines so Alexa sounds natural.
- [ ] Record the video (under 3 minutes, English) on Thu.

## B: Marketplace engine

Files: `src/market/*`, `src/db/*`

- [ ] Hosted Postgres + pgvector (RDS/Aurora gives AWS Builder points; Neon/Supabase is faster to set up). Add an HNSW index on `listings.embedding` once the dimension is final.
- [ ] Tune `WEIGHTS` and `MATCH_THRESHOLD` in `matching.ts` using Bedrock embeddings and C's seed data. Example: "graphing calculator" shouldn't rank a non-graphing Casio close to a TI-84.
- [ ] Negotiation upgrades (keep it deterministic and tested): multi-quantity (tissues × 3), "ask the seller" when `auto_accept=false`, prevent duplicate proposed deals for the same listing.
- [ ] Deadline handling: drop or flag listings whose `availability` can't meet `needed_by`.
- [ ] Optional: `cancel_listing`, `list_my_listings` tools (agree on them with A first).

## C: Intent, data, dashboard, Bee

Files: `src/ai/*`, `data/seed-listings.json`, `public/index.html`

- [ ] Get Bedrock access in the AWS account (Titan Text Embeddings V2 + one LLM). Run with `AI_MODE=bedrock` and set `BEDROCK_INTENT_MODEL_ID`. Check that `npm run smoke` still passes.
- [ ] Grow the seed data to ~150–200 realistic listings, new and used, from several sellers: campus life, electronics, textbooks, plenty of $1–$5 items for the long-tail story. Add distractors near the demo items.
- [ ] Dashboard polish for the video: highlight the newest deal, show "saved $3 vs asking", and show the 🔒 private limits clearly.
- [ ] **Bee go/no-go by Wed:** does anyone have a Bee device or the Bee Apple Watch app? If yes: read real Bee data with the Bee CLI or MCP, then call `create_buy_intent` with `source: "bee_context"` and `raw_request` set to the context. If no: Bee goes on a roadmap slide.
- [ ] Gather the friction logs and product feedback into the submission (see [SUBMISSION.md](SUBMISSION.md)).

---

## Day-by-day (HKT)

| Day | A | B | C |
|---|---|---|---|
| **Sun 18** | Alexa+ access research; AWS account | Read code, plan Postgres hosting | Bedrock access request; seed data |
| **Mon 19** | Deploy to AWS with HTTPS | Hosted DB, HNSW index | Bedrock mode working |
| **Tue 20** | Alexa+ connected, **or** start the simulator (decide tonight) | Matching tuned on real embeddings | 150+ listings |
| **Wed 21** | Full voice demo end to end | Multi-quantity, edge cases | Dashboard polish; Bee go/no-go |
| **Thu 22** | **Feature freeze 12:00.** Record video | Bug fixes only | Description, feedback, friction log |
| **Fri 23** | Upload video, submit by 21:00 | Final checks | Final checks |

## Daily sync (10 min, 22:00 HKT)

What's merged · what's blocked · does the TI-84 demo still run on the deployed server?
