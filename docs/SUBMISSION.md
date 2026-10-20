# Devpost submission checklist

Deadline **Oct 23, 12:00pm PDT (Oct 24, 3:00am HKT)**. Submit by Fri 21:00 HKT.

## Required
- [ ] **Track:** Alexa+ · **Mini challenge:** AWS Builder
- [ ] **Text description:** what it does and how it works (draft below)
- [ ] **Repo:** public with the MIT `LICENSE` (already included). This avoids collaborator invitations expiring.
      If we go private instead, add only the reviewers named in the official list on the Devpost page, and check any extra name with the hackathon manager first.
- [ ] Repo **actually calls the MCP SDK in code** (`src/mcp/server.ts`, `src/app.ts`)
- [ ] **Demo video** under 3 minutes, YouTube/Vimeo, public, English
- [ ] **Product feedback** for every tool: Alexa+, MCP SDK, Bedrock, AWS hosting service, Bee (if used). For each: what we used it for, what worked, what needs work, onboarding, would we use it again. **Describe AWS services and how we used them here** (AWS Builder).
- [ ] Mention that the project was started during the hackathon window

## Optional (do it)
- [ ] **Friction log** from [FRICTION_LOG.md](FRICTION_LOG.md) (up to +10%)
- [ ] Feature requests (critical / important / nice-to-have)

## Description draft

**AmazonPairUp** is an agentic C2C marketplace for Alexa+ that pairs buyers and
sellers directly, for things and for services. People just talk: "Sell my TI-84
for $20, I'll take anything above $15", "Find someone to pick up my lunch from
LG7 canteen to Hall 5 by 12:30, $5", or "Get me a helper for the event on
Saturday 2-6pm, budget $10 an hour".

Our self-hosted MCP server (spec 2025-11-25, Streamable HTTP) turns speech into
structured offers and requests with Amazon Bedrock: the item or the task, the
budget, a flat fee or an hourly rate, the pickup and drop-off, the time window
and the hours. One pairing engine serves both kinds. It pairs each request with
the best-fitting offer using hybrid search (pgvector semantic similarity and
Postgres full-text search) under hard constraints on kind, price unit,
condition, quantity, deadline and price feasibility, then settles the price
with one deterministic rule inside limits each side set privately: the asking
price, or a lower budget as an offer the seller's minimum accepts. No agent
haggles, and the seller's minimum never shows through a deal. Alexa+ presents the deal with an MCP Apps
card and each person confirms with one word. Private limits never leave the
server.

Because posting, pairing and settling take a single sentence, small things
become worth doing: a $2 pack of tissues, a $4 lunch run by a student already
walking past the canteen, four hours of help at a club event. The fee goes to
the person who does the work, and a runner's offer stays open to take the next
job.

With Bee connected, real-world context such as "exam tomorrow,
calculator broke" becomes a proactive request, so Alexa can suggest a deal
before the user asks.
