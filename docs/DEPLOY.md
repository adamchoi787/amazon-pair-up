# Deploying PairUp

| Path | When | Cost | URL |
|---|---|---|---|
| **AWS (production)** | The live app for judges and users, through Nov 20 | About $18/month | `https://<id>.cloudfront.net/app/` |
| **AgentCore agent** | The Strands voice agent on Amazon Bedrock AgentCore Runtime, using the production MCP server | Pay per use | `InvokeAgentRuntime` |
| **Cloudflare quick tunnel** | Sharing a laptop server for a few minutes | Free | Changes every run |
| **AWS Lightsail container** | Older single-container path | About $7/month | `*.amazonlightsail.com` |

## AWS (production)

```
Browser / MCP clients (Alexa+, Claude, the web app)
        │ HTTPS (HTTP/3, HSTS and security headers)
   CloudFront ── adds X-Origin-Verify; the app rejects requests without it
        │
   EC2 t4g.small, Amazon Linux 2023, Node 22, systemd
     ├─ PairUp (MCP server, web app, agent) on port 8080
     ├─ embedded Postgres + pgvector on an encrypted gp3 volume, daily snapshots (7 kept)
     ├─ IAM role → Amazon Bedrock (Titan Text Embeddings V2, Amazon Nova Lite)
     ├─ CloudWatch agent → log group /amazonpairup/app (JSON lines, 30 days)
     └─ Systems Manager for deploys; no SSH, no key pair, IMDSv2 only
   CloudWatch: metric filters (MCP latency, tool failures, 5xx) → alarms → SNS email
```

Everything is in [deploy/aws/amazonpairup.yaml](../deploy/aws/amazonpairup.yaml) (CloudFormation).
No AWS access keys exist on the server: Bedrock, S3 and Parameter Store are reached
through the instance role. The origin, dashboard and sign-in secrets live in Parameter Store.

**Once:**

1. Install the AWS CLI (`winget install -e --id Amazon.AWSCLI` on Windows) and run
   `aws configure --profile amazonpairup` with an IAM user or SSO role that can create
   CloudFormation, EC2, IAM, S3, SSM, CloudFront and DLM resources. Region `us-east-1`.
2. In the Bedrock console (us-east-1) check that **Titan Text Embeddings V2** and
   **Amazon Nova Lite** are available.
3. Check Bedrock from your machine with the exact calls the server makes:
   ```bash
   AWS_PROFILE=amazonpairup AWS_REGION=us-east-1 npx tsx scripts/check-bedrock.ts
   ```
4. Set up sign-in (see [Sign-in](#sign-in) below). The first deploy works with the
   judge demo sign-in alone, so you can add Login with Amazon after it prints the URL.

**Deploy (first time and every release):**

```bash
AWS_PROFILE=amazonpairup AWS_REGION=us-east-1 deploy/aws/deploy.sh
```

The script creates or updates the stack, uploads the committed code (`git HEAD`),
installs it on the instance through SSM, switches releases atomically, waits for
`/ready` (the app answers and its database is up), and prints the app URL. The first run takes about 10 minutes (CloudFront).
Settings: `AGENT_MODEL` / `INTENT_MODEL` (Bedrock model or inference profile ids,
default `us.amazon.nova-lite-v1:0`), `INSTANCE_TYPE`, `STACK`, `ALERT_EMAIL` (gets an
email when an alarm fires; confirm the subscription once).

### Sign-in

The deployed server runs `AUTH_MODE=oauth`. People and MCP clients sign in through
its OAuth 2.1 server ([src/auth/oauth.ts](../src/auth/oauth.ts)), which offers:

- **Login with Amazon**, the identity provider. The user id is the Amazon account's
  `user_id`; other people see the profile's first name.
- **The judge demo sign-in**, labelled "Demo sign-in for judges", with `DEMO_MODE=true`.
  It takes a name and a passcode: the first sign-in with a name sets that name's
  passcode, and later sign-ins with the name need it. Wrong guesses are throttled.
  `DEMO_LOGIN_PASSCODE` adds an access code every demo sign-in enters as well, for
  example one you hand to the judges.

A server on a public URL starts with Login with Amazon configured, `DEMO_MODE=true`,
or both. On `http://localhost` and `127.0.0.1` the demo sign-in is always on.

**Login with Amazon, once:**

1. Open the [Login with Amazon console](https://developer.amazon.com/loginwithamazon/console/site/lwa/overview.html)
   and create a security profile (name, description, privacy notice URL
   `https://<id>.cloudfront.net/privacy.html`).
2. Under the profile's **Web Settings**, add the allowed return URL
   `https://<id>.cloudfront.net/oauth/amazon/callback` (`<PUBLIC_BASE_URL>/oauth/amazon/callback`;
   the deploy script prints it).
3. Copy the client ID and client secret, and deploy with them in your environment:
   ```bash
   read -rs LWA_CLIENT_SECRET && export LWA_CLIENT_SECRET   # paste, then Enter
   AWS_PROFILE=amazonpairup AWS_REGION=us-east-1 LWA_CLIENT_ID=amzn1.application-oa2-client.… deploy/aws/deploy.sh
   ```

The script stores them as the SecureStrings `/amazonpairup/lwa-client-id` and
`/amazonpairup/lwa-client-secret` through a private temp file, so the secret stays
off command lines, and later deploys reuse them. The instance reads them from
Parameter Store when it installs a release.

**Which sign-in a deploy turns on:**

| Your environment / Parameter Store | Deployed sign-in |
|---|---|
| Login with Amazon stored | Login with Amazon |
| Login with Amazon stored, `DEMO_MODE=true` | Login with Amazon and the judge demo sign-in |
| No Login with Amazon stored | The judge demo sign-in (`DEMO_MODE=true` is written for you) |

`DEMO_LOGIN_PASSCODE` in your environment is stored as `/amazonpairup/demo-login-passcode`
and reused; delete that parameter to drop the access code.

**Other MCP clients.** Claude, ChatGPT, Cursor and other clients connect to `/mcp`
on their own, with a Client ID Metadata Document or by registering at
`POST /oauth/register` (RFC 7591). `DCR_PER_HOUR` (default 20) caps registrations
per IP address per hour, and `0` turns registration off. Tokens are revoked at
`POST /oauth/revoke` (RFC 7009). The full flow is in
[TOOL_CONTRACT.md](TOOL_CONTRACT.md#connecting-a-client).

**Operate:**

- Logs: CloudWatch Logs, group `/amazonpairup/app`. Each line is JSON with a
  `requestId` (also returned as the `X-Request-Id` header), so one call can be
  followed end to end. Logs Insights, slowest tool calls today:
  `fields Tool, ToolLatencyMs | filter msg = "tool" | sort ToolLatencyMs desc | limit 20`.
  On the instance: `tail -f /var/log/amazonpairup/app.log`.
- Metrics and alarms: namespace `PairUp/Logs` (`McpLatency`, `ToolFailures`,
  `ServerErrors`) from metric filters, and `PairUp` from the Embedded Metric
  Format lines (per-tool `ToolLatencyMs`, `ToolErrors`) where EMF is extracted.
  Alarms: tool failures (3 in 5 min), HTTP 5xx (5 in 5 min), MCP p95 latency above
  1.5 s for 15 min, plus the instance recovery alarm.
- Shutdown is graceful: on a restart the server stops taking connections and lets
  calls in flight finish (up to 10 s) before closing the database.
- Dashboard: `https://<id>.cloudfront.net/dashboard/#token=<value of /amazonpairup/dashboard-token>`.
- Rollback: the last three releases stay in `/opt/amazonpairup/releases`; point
  `/opt/amazonpairup/current` at one and `systemctl restart amazonpairup`.
- Tear down: `deploy/aws/teardown.sh` (asks for the stack name; lists leftover snapshots).

**Trade-offs:** one instance keeps the database consistent and costs little; an
instance failure is recovered automatically by the CloudWatch alarm, and the data
volume is snapshotted daily. CloudFront reaches the instance over HTTP on the AWS
network; with a custom domain, an ACM certificate on the origin makes that hop TLS
too. To scale out, move `DATABASE_URL` to RDS PostgreSQL with pgvector and run more
instances behind the same distribution.

Check any deployment with:

```bash
curl https://<id>.cloudfront.net/ready
curl https://<id>.cloudfront.net/.well-known/mcp/server-card.json
```

---

## AgentCore agent (Strands Agents on Amazon Bedrock AgentCore Runtime)

[agents/agentcore](../agents/agentcore) is a voice agent built with Strands Agents
that uses the production MCP server as its tools, packaged for AgentCore Runtime
(ARM64 container, `/invocations` and `/ping` on port 8080):

```bash
AWS_PROFILE=amazonpairup AWS_REGION=us-east-1 agents/agentcore/deploy.sh
PAIRUP_TOKEN=<access token> agents/agentcore/invoke.sh "I need a graphing calculator today, max 18 dollars"
```

The script needs Docker with buildx. It pushes the image to ECR, creates an
execution role limited to Bedrock model calls, ECR pulls and logs, and creates or
updates the runtime. Details: [agents/agentcore/README.md](../agents/agentcore/README.md).

---

## Cloudflare quick tunnel (local machine)

```bash
brew install cloudflared
npm start                                   # terminal 1
cloudflared tunnel --url http://127.0.0.1:3000   # terminal 2, prints https://<random>.trycloudflare.com
```

The server checks the `Host` header to protect against DNS rebinding, so it
rejects the tunnel hostname until you allow it. Restart with:

```bash
ALLOWED_HOSTS=<random>.trycloudflare.com,127.0.0.1,localhost npm start
```

Your MCP URL is `https://<random>.trycloudflare.com/mcp`. Your laptop has to stay
awake and the tunnel has to stay running.

## AWS Lightsail container service

Prerequisites: AWS CLI v2 configured with `aws configure`, Docker, and the
`lightsailctl` plugin (`brew install aws/tap/lightsailctl`).

```bash
# 1. Create the service once (nano = 0.25 vCPU / 512 MB)
aws lightsail create-container-service --service-name amazon-pairup --power nano --scale 1

# 2. Build and push the image. Apple Silicon must build for amd64.
docker build --platform linux/amd64 -t amazon-pairup:latest .
aws lightsail push-container-image --service-name amazon-pairup --label app --image amazon-pairup:latest

# 3. Find the public hostname and put it in deploy/lightsail/containers.json → ALLOWED_HOSTS
aws lightsail get-container-services --service-name amazon-pairup --query 'containerServices[0].url'

# 4. Deploy
aws lightsail create-container-service-deployment --service-name amazon-pairup \
  --containers file://deploy/lightsail/containers.json \
  --public-endpoint file://deploy/lightsail/public-endpoint.json
```

Notes:
- The image name in `containers.json` (`:amazon-pairup.app.latest`) refers to the image
  pushed in step 2. If the push prints a different name, use that one.
- **Data:** with no `DATABASE_URL`, the container uses embedded PGlite, which is wiped on every
  redeploy and re-seeded by `SEED_ON_START`. That's fine for demos. For data that has to
  persist, set `DATABASE_URL` to the hosted Postgres from teammate B.
- **Bedrock:** set `AI_MODE=bedrock` and `BEDROCK_INTENT_MODEL_ID`, and give the service AWS
  credentials with `bedrock:InvokeModel`. Lightsail containers have no IAM role, so pass an
  access key for a least-privilege IAM user as environment variables. **Never commit it.**
- Secrets such as `MCP_API_KEY` and AWS keys go in the deployment's environment, not in git.
- **Dashboard:** set `DASHBOARD_TOKEN` to a long random string to use `/api/dashboard` on a deployed server, and open the page as `https://<host>/dashboard/#token=<token>`. Without it, the dashboard is off whenever `AUTH_MODE=oauth`.
- **Web app:** served at `https://<host>/app/`. With `AUTH_MODE=oauth` and `PUBLIC_BASE_URL` set it signs people in as the built-in public client `pairup-web` (PKCE, redirect `<PUBLIC_BASE_URL>/app/`); the Alexa+ client variables are only needed for Alexa account linking.
- **Sign-in:** set `LWA_CLIENT_ID` and `LWA_CLIENT_SECRET` (Login with Amazon, allowed return URL `<PUBLIC_BASE_URL>/oauth/amazon/callback`), `DEMO_MODE=true` for the labelled judge demo sign-in, or both; see [Sign-in](#sign-in).
- **Assistant:** `AI_MODE=bedrock` with `BEDROCK_AGENT_MODEL_ID` (or `BEDROCK_INTENT_MODEL_ID`) runs the web app's assistant on Bedrock; otherwise the offline planner answers.
- **Policy:** `DEAL_HOLD_HOURS`, `POSTS_PER_HOUR`, `MAX_OPEN_REQUESTS` and `MCP_CALLS_PER_MINUTE` have production defaults; see [.env.example](../.env.example).

## Configuration reference

All settings are environment variables; see [.env.example](../.env.example).
The container defaults are `HOST=0.0.0.0`, `PORT=3000` and `SEED_ON_START=true`.

## Latency

Every MCP call writes a log line like `[mcp] tools/call find_matches 200 7ms`.
In mock mode, tool calls take under 10 ms. With Bedrock, each embedding call adds network
time, so check the logs after switching and keep calls well under 500 ms.

## Checking the submitted release

Build the browser surfaces before committing (`npm run build:web`). The AWS deploy
script ships git HEAD and supplies `RELEASE_REVISION` to the process. It now runs
this read-only check before reporting the release as successful:

```bash
npm run check:release -- --url https://YOUR-HOST --revision SUBMITTED_COMMIT --expect-ai bedrock --expect-auth oauth
```

The version, commit and UI fingerprint must match. A reachable app can still be
an older build. These checks establish release identity and readiness; separately
rehearse Login with Amazon/judge sign-in, make an actual Bedrock request, and
invoke AgentCore if claiming that separate runtime. Do not reset a shared market
for a video take. Scheduling schema changes are additive and applied on startup;
back up the database before deploying as usual. Legacy unparsed service windows
remain tentative until explicitly approved by the provider.
