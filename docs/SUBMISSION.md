# Devpost submission checklist

Deadline **Oct 23, 12:00pm PDT (Oct 24, 3:00am HKT)**. Submit by Fri 21:00 HKT.

## Required
- [ ] **Track:** Alexa+ · **Mini challenges:** AWS Builder, Open Source ([pairing-core](https://github.com/rairurairu/pairing-core))
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

**PairUp** is an agentic C2C marketplace for Alexa+ that pairs buyers and
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

## AWS section draft (AWS Builder)

PairUp runs on AWS end to end, and every AWS piece does real work in the
product:

- **Amazon Bedrock, Titan Text Embeddings V2.** Every offer, request and
  reference price is embedded (1024 dimensions) and stored in Postgres with
  pgvector. Pairing ranks candidates by semantic similarity plus full-text
  match, so "graphing calculator" finds a TI-84 and skips a scientific Casio.
- **Amazon Bedrock, Amazon Nova Lite.** Turns a spoken sentence into a
  structured request (kind, budget, flat fee or hourly rate, pickup, drop-off,
  time window, hours), and runs the web app's assistant through the Converse
  API with tool use over our own MCP tools. Output is validated field by field,
  with a local parser and an offline planner as fallbacks.
- **Strands Agents on Amazon Bedrock AgentCore Runtime.** A voice agent
  ([agents/agentcore](../agents/agentcore)) built with the Strands TypeScript SDK
  discovers its tools from our MCP server over Streamable HTTP and calls them
  with the user's own token. Hooks outside the model block `confirm_deal` until
  the user says yes and add an `idempotency_key` to every write. It is packaged
  for AgentCore Runtime (ARM64, `/invocations` and `/ping`) with one deploy script.
- **Hosting.** CloudFormation stack: CloudFront (HTTPS, HTTP/3, security
  headers) in front of a Graviton EC2 instance with an IAM role (no access
  keys), encrypted EBS with daily snapshots (Data Lifecycle Manager), automatic
  instance recovery, releases in S3, deploys and secrets through Systems Manager
  and Parameter Store.
- **CloudWatch.** JSON logs with a request id per call, metric filters for MCP
  latency, tool failures and 5xx, alarms to SNS email, and Embedded Metric
  Format lines for per-tool latency.
- **Development workflow.** Built with Claude Code.

## Product feedback drafts

Drafted from what we hit while building; edit each one so it matches your own
experience before submitting.

**MCP TypeScript SDK (+ MCP Apps extension).** Used for the server (Streamable
HTTP, stateless, protocol 2025-11-25), tool output schemas, prompts, the MCP
Apps view, and an in-process client for tests and the server card. Worked well:
`registerTool` with zod input and output schemas, `InMemoryTransport` for fast
end-to-end tests, and the Express helper with DNS-rebinding protection. Needs
work: there is no standard way to publish a server card or an idempotency
convention for write tools, so every server invents its own. Would use again: yes.

**Amazon Bedrock.** Used for Titan Text Embeddings V2 and Nova Lite (intent
extraction and tool use through Converse). Worked well: one IAM role on the
instance, no keys in the app; Converse tool use mapped directly onto MCP tool
schemas. Needs work: [your experience with model access and quotas on a new
account]. Would use again: yes.

**Strands Agents (TypeScript).** Used for the AgentCore voice agent. Worked
well: `McpClient` connected to our existing server with only a URL and headers,
and `BeforeToolCallEvent` made the "confirm only on a yes" rule a few lines of
code. Needs work: the stream event shape changed (`modelStreamUpdateEvent`
wrappers) and the AgentCore README example no longer compiles against it (see
friction log). Would use again: yes.

**Amazon Bedrock AgentCore Runtime (TypeScript SDK).** Used to host the Strands
agent. Worked well: `BedrockAgentCoreApp` gives the runtime contract, streaming
and session ids in one object. Needs work: local calls need two headers the
README never mentions (see friction log). [Add your deploy experience.]

**AWS hosting (CloudFormation, EC2, CloudFront, SSM, CloudWatch).** Worked well:
SSM deploys without SSH or key pairs; CloudFront in front of one instance gave
HTTPS and HTTP/3 with no certificate work. Needs work: DLM validation errors
surface only at stack creation and roll the whole stack back; the AWS CLI under
Git Bash rewrites parameter names (both in the friction log).

## Bee and watch draft

PairUp turns Bee to-dos and need snippets into prepared marketplace requests, with budgets learned from the user’s own history. A watch Shortcut sends speech to the server and reads the reply; the browser watch view shows one suggestion or waiting deal. The included Bee replay is demo data. Choose the Bee track only after checking its device requirements and validating a real Bee.

Bee product feedback to validate: the CLI stream, MCP data access and public todos API provide useful integration paths. Document actual live-device experience after testing; local replay alone does not establish hardware experience.
