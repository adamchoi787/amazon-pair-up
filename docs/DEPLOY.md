# Deploying the MCP server

Alexa+ needs a **public HTTPS URL** that serves Streamable HTTP at `/mcp`, and it
expects round trips **under 500 ms**. There are two paths:

| | When | Cost | URL |
|---|---|---|---|
| **A. Cloudflare quick tunnel** | Today, for testing in the Alexa+ simulator from a laptop | Free | Changes every run |
| **B. AWS Lightsail container** | Stable demo URL for the video and judges (AWS Builder) | About $7/month (nano) | Stable `*.amazonlightsail.com` |

Both paths run the same server. Check any deployment with:

```bash
npm run smoke -- https://<your-host>/mcp
```

---

## A. Cloudflare quick tunnel (local machine)

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

## B. AWS Lightsail container service

Prerequisites: AWS CLI v2 configured with `aws configure`, Docker, and the
`lightsailctl` plugin (`brew install aws/tap/lightsailctl`).

```bash
# 1. Create the service once (nano = 0.25 vCPU / 512 MB)
aws lightsail create-container-service --service-name voice-market --power nano --scale 1

# 2. Build and push the image. Apple Silicon must build for amd64.
docker build --platform linux/amd64 -t voice-market:latest .
aws lightsail push-container-image --service-name voice-market --label app --image voice-market:latest

# 3. Find the public hostname and put it in deploy/lightsail/containers.json → ALLOWED_HOSTS
aws lightsail get-container-services --service-name voice-market --query 'containerServices[0].url'

# 4. Deploy
aws lightsail create-container-service-deployment --service-name voice-market \
  --containers file://deploy/lightsail/containers.json \
  --public-endpoint file://deploy/lightsail/public-endpoint.json
```

Notes:
- The image name in `containers.json` (`:voice-market.app.latest`) refers to the image
  pushed in step 2. If the push prints a different name, use that one.
- **Data:** with no `DATABASE_URL`, the container uses embedded PGlite, which is wiped on every
  redeploy and re-seeded by `SEED_ON_START`. That's fine for demos. For data that has to
  persist, set `DATABASE_URL` to the hosted Postgres from teammate B.
- **Bedrock:** set `AI_MODE=bedrock` and `BEDROCK_INTENT_MODEL_ID`, and give the service AWS
  credentials with `bedrock:InvokeModel`. Lightsail containers have no IAM role, so pass an
  access key for a least-privilege IAM user as environment variables. **Never commit it.**
- Secrets such as `MCP_API_KEY` and AWS keys go in the deployment's environment, not in git.

## Configuration reference

All settings are environment variables; see [.env.example](../.env.example).
The container defaults are `HOST=0.0.0.0`, `PORT=3000` and `SEED_ON_START=true`.

## Latency

Every MCP call writes a log line like `[mcp] tools/call find_matches 200 7ms`.
In mock mode, tool calls take under 10 ms. With Bedrock, each embedding call adds network
time, so check the logs after switching and keep calls well under 500 ms.
