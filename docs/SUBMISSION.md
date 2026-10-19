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
sellers directly. Both sides just talk: "Sell my TI-84 for $20, I'll take
anything above $15" or "I need a graphing calculator today, max $18". Our
self-hosted MCP server (spec 2025-11-25, Streamable HTTP) turns speech into
structured listings and buy intents with Amazon Bedrock. It pairs each buyer
with the best-fitting seller using hybrid search: pgvector semantic similarity,
Postgres full-text search, and hard constraints on condition, quantity and
price feasibility. It then negotiates a price inside limits each side set
privately. Alexa+ presents the deal and each person confirms with one word.
Private limits never leave the server.

Because posting, pairing and negotiating take a single sentence, anything
people have and others need becomes worth trading, from used textbooks to a $2
pack of tissues.

With Bee connected, real-world context such as "exam tomorrow,
calculator broke" becomes a proactive buy intent, so Alexa can suggest a deal
before the user asks.
