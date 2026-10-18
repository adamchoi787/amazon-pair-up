# VoiceMarket — an agentic marketplace for Alexa+

> Buyers and sellers describe what they want out loud. Alexa+ finds the match,
> negotiates inside limits each side set privately, and asks for a final "yes".

**Track:** Alexa+ (self-hosted MCP server, spec 2025-11-25, Streamable HTTP)
**Mini challenge:** AWS Builder (Amazon Bedrock embeddings + intent extraction, AWS hosting)
**Optional:** Bee "Proactive Context Mode" (only with live Bee data)

## The idea in one minute

Selling a used calculator today means photos, forms, haggling in chat and
arranging a meet-up. Most people don't bother — and nobody would ever list a
$2 pack of tissues.

VoiceMarket removes all of that:

- **Seller:** "Alexa, sell my TI-84 for $20. I'll take anything above $15."
- **Buyer:** "Alexa, I need a graphing calculator today, max $18."
- **Alexa:** "I found a TI-84 on campus and got it down to $17. Confirm?" — "Yes." — Done.

Neither side ever sees the other's limit. Our MCP server does the
understanding, searching, matching and negotiating; Alexa+ is the voice and the
agent; the human only says yes or no.

## Run it (2 minutes, no database or AWS needed)

```bash
npm install
npm run reset        # create tables + load seed listings
npm start            # MCP server on http://127.0.0.1:3000/mcp, dashboard on http://127.0.0.1:3000/
npm run smoke        # (second terminal) plays the TI-84 demo over real MCP
npm test             # unit + end-to-end tests (in-memory Postgres + pgvector)
```

Local dev uses **PGlite** — real Postgres + **pgvector** embedded in Node,
stored in `.data/`. Set `DATABASE_URL` to switch to a hosted Postgres.
`AI_MODE=mock` (default) works offline; `AI_MODE=bedrock` uses Amazon Bedrock.
See [.env.example](.env.example).

## Architecture

```mermaid
flowchart TB
  U[Buyer / Seller] -- voice --> A[Alexa+<br/>interface + agent]
  A -- "MCP tools (Streamable HTTP)" --> S
  subgraph S["VoiceMarket MCP server"]
    I[Intent extraction<br/>Bedrock LLM] --> H[Hybrid search<br/>pgvector + full-text + constraints]
    H --> N[Negotiation engine<br/>deterministic, private limits]
    N --> D[Deal + confirmation]
  end
  S --> DB[(Postgres + pgvector<br/>users · listings · intents · deals · events)]
  B[Bee context<br/>optional] -. intent enrichment .-> I
```

Bee sits **beside** the flow, not in front of it. Everything works without it.

| Layer | Role |
|---|---|
| Alexa+ | Interface and agent: conversation, confirmation |
| MCP server (this repo) | Marketplace intelligence: intents, matching, negotiation, deals |
| Bee | Optional ambient context → proactive buy intents |

## MCP tools

| Tool | What it does |
|---|---|
| `create_listing` | Sell: item, public ask, **private minimum**, meet-up area |
| `create_buy_intent` | Buy: need + **private budget**; free text is parsed for missing fields |
| `find_matches` | Hybrid semantic + keyword search under hard constraints |
| `negotiate` | Settles a price inside both limits, creates a proposed deal |
| `confirm_deal` / `decline_deal` | Human-in-the-loop final decision |
| `get_deal_status` | Deals and meet-up details |

Full schemas and privacy rules: [docs/TOOL_CONTRACT.md](docs/TOOL_CONTRACT.md).

## Repo map

```
src/
  index.ts            entry point
  app.ts              HTTP: /mcp (Streamable HTTP), /health, /api/dashboard     [A]
  mcp/server.ts       MCP tool definitions                                       [A]
  market/service.ts   business operations behind each tool                       [B]
  market/matching.ts  hybrid pgvector + full-text search                         [B]
  market/negotiation.ts  deterministic price settlement                          [B]
  market/views.ts     the only place rows become output (privacy redaction)      [B]
  ai/                 mock + Bedrock embeddings and intent extraction            [C]
  db/                 PGlite / Postgres client and schema                        [B]
public/index.html     judge dashboard                                            [C]
data/seed-listings.json  seed marketplace                                        [C]
scripts/seed.ts, scripts/smoke.ts
docs/                 team handoff, contract, Alexa+ setup, deploy, demo script, submission, friction log
src/auth/oauth.ts     OAuth 2.1 account linking for Alexa+                       [A]
Dockerfile, deploy/   container image and Lightsail config                      [A]
```

## Team

See [docs/HANDOFF.md](docs/HANDOFF.md) for owners, tasks and the day-by-day plan.

## License

MIT — see [LICENSE](LICENSE).
