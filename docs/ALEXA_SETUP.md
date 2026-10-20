# Connecting PairUp to Alexa+

Alexa+ talks to our server through an **MCP add-on** that you create and deploy
with the Alexa AI CLI. The steps below follow the official docs:

- [MCP Toolkit overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview.html)
- [MCP QuickStart](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-quickstart.html)
- [Set up your development environment](https://developer.amazon.com/docs/alexaplus/add-ons/set-up-your-development-environment)
- [Account linking for MCP add-ons](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-account-linking)
- [Test in the web simulator](https://developer.amazon.com/docs/alexaplus/add-ons/test-with-web-simulator)
- [Alexa AI CLI reference](https://developer.amazon.com/docs/alexaplus/add-ons/alexa-ai-cli-reference.html)

If a step here disagrees with those pages, the official docs win. Write down every
surprise in [FRICTION_LOG.md](FRICTION_LOG.md).

**Status:** the MCP Toolkit, CLI and web simulator are in preview with select
partners, so hackathon entrants demo through their own MCP client (Devpost FAQ).
Our demo runs on the PairUp web client; this guide is ready for when add-on
access opens.

## What the server already provides

| Alexa+ requirement | Where it lives |
|---|---|
| Streamable HTTP, MCP spec 2025-11-25 | `POST /mcp` ([src/app.ts](../src/app.ts)) |
| Public HTTPS URL | [DEPLOY.md](DEPLOY.md): tunnel today, Lightsail for the demo |
| Round trip under 500 ms | `[mcp] … NNms` log lines; under 10 ms in mock mode |
| Account linking (optional, but we need it to tell the buyer from the seller) | `AUTH_MODE=oauth` ([src/auth/oauth.ts](../src/auth/oauth.ts)), people sign in with Login with Amazon |
| Privacy policy and terms URLs (HTTPS) | `/privacy.html`, `/terms.html` |
| Icons at 72, 64, 88, 126, 180 and 241 px, plus a 600×900 carousel image | `/addon/icon-<size>.png`, `/addon/carousel-600x900.png` |

## Step 0: Access (blocking, do it first)

The CLI is installed from Amazon's private package registry. Your AWS account needs
permission to assume `arn:aws:iam::372468808636:role/AddOn3PDeveloperToolsRead`,
and the docs say to use "the AWS account you provided to the Alexa Solutions
Architect". For the hackathon, ask in the hackathon office hours or the Devpost
discussion how participants get that access.

You also need:
- A free Alexa developer account. Complete your Alexa app profile and set the marketplace and language to ones Alexa+ supports (en-US).
- **Node.js 24 or newer for the CLI.** Run `node --version`; this Mac currently has v22. The server itself runs on Node 22.
- AWS CLI v2 (`brew install awscli`).

## Step 1: Install the CLI

Follow "Set up your development environment". In short:

```bash
aws configure --profile alexa-ai-user
aws configure set profile.alexa-ai.role_arn arn:aws:iam::372468808636:role/AddOn3PDeveloperToolsRead
aws configure set profile.alexa-ai.source_profile alexa-ai-user
aws configure set profile.alexa-ai.region us-west-2
aws sts get-caller-identity --profile alexa-ai
aws codeartifact login --tool npm --domain alexa-ai --domain-owner 372468808636 \
  --repository npm-packages --region us-west-2 --namespace @alexa-ai --profile alexa-ai
npm install -g @alexa-ai/cli
alexa-ai --version
alexa-ai configure          # opens Login with Amazon
```

## Step 2: Run the server at a public HTTPS URL

Start with a tunnel; it's the fastest path ([DEPLOY.md](DEPLOY.md) section A). Run it with account linking on:

```bash
AUTH_MODE=oauth \
PUBLIC_BASE_URL=https://<host> \
ALLOWED_HOSTS=<host>,127.0.0.1,localhost \
OAUTH_CLIENT_ID=pairup-alexa \
OAUTH_CLIENT_SECRET=<long random string> \
OAUTH_REDIRECT_URIS=<filled in after step 4> \
LWA_CLIENT_ID=<security profile client ID> \
LWA_CLIENT_SECRET=<security profile client secret> \
DEMO_MODE=true \
DEMO_LOGIN_PASSCODE=<optional> \
npm start
```

To generate a client secret, run `openssl rand -base64 32`. Keep it out of git and the chat.
On the AWS deployment, `deploy/aws/deploy.sh` sets these for you
([DEPLOY.md](DEPLOY.md#sign-in)).

**Sign-in.** Our OAuth server signs people in with **Login with Amazon**:

1. In the [Login with Amazon console](https://developer.amazon.com/loginwithamazon/console/site/lwa/overview.html),
   create a security profile.
2. In its **Web Settings**, add the allowed return URL `https://<host>/oauth/amazon/callback`
   (`<PUBLIC_BASE_URL>/oauth/amazon/callback`).
3. Put its client ID and secret in `LWA_CLIENT_ID` and `LWA_CLIENT_SECRET`.

`DEMO_MODE=true` adds the judge demo sign-in, labelled "Demo sign-in for judges",
next to Login with Amazon. It takes a name and a passcode: the first sign-in with a
name sets its passcode, and later sign-ins with that name use it.
`DEMO_LOGIN_PASSCODE` is an optional access code every demo sign-in also enters.
A public server starts with Login with Amazon, `DEMO_MODE=true`, or both.

## Step 3: Create the add-on

```bash
mkdir -p ~/alexa-addons && cd ~/alexa-addons
alexa-ai new mcp --name "PairUp" --locale en-US --mcp-server-url "https://<host>/mcp"
```

Answer **yes** when it asks whether the add-on requires account linking. Keep the
generated add-on project **outside this repo**, or commit it only after checking
that it contains no secrets.

Fill in `addon-package/addon.json` with the listing text below. The image URLs
are on our server: `https://<host>/addon/icon-72.png` … `icon-241.png` and
`https://<host>/addon/carousel-600x900.png`.

## Step 4: Account linking

In the Developer Hub, copy the **Alexa redirect URIs**, put them in
`OAUTH_REDIRECT_URIS` (comma-separated), and restart the server. Then register
our OAuth client:

```bash
export ALEXA_CLIENT_SECRET='<same secret as OAUTH_CLIENT_SECRET>'
alexa-ai configure-account-linking --addon-id <addon-id> ...
```

The CLI reference lists a `--config-file` flag, and the account-linking guide shows
`--stage development --client-id`. Use whichever your installed version accepts
(`alexa-ai configure-account-linking --help`). The values it needs:

| Field | Value |
|---|---|
| Authorization URL | `https://<host>/oauth/authorize` |
| Token URL | `https://<host>/oauth/token` |
| Client ID | `OAUTH_CLIENT_ID` |
| Client secret | `OAUTH_CLIENT_SECRET` (masked prompt or `ALEXA_CLIENT_SECRET`, **never** a plain flag) |
| Scope | `marketplace` |
| Client authentication | HTTP Basic (`client_secret_post` also works) |
| PKCE | S256 |

Alexa discovers the rest from `https://<host>/.well-known/oauth-protected-resource`
and `https://<host>/.well-known/oauth-authorization-server`, which also list
`https://<host>/oauth/revoke` (RFC 7009 token revocation, for unlinking).

Alexa uses the pre-registered client above. Other MCP clients (Claude, ChatGPT,
Cursor) register themselves with a Client ID Metadata Document or at
`https://<host>/oauth/register` (RFC 7591), up to `DCR_PER_HOUR` registrations per
IP address per hour (default 20, `0` turns it off); see
[TOOL_CONTRACT.md](TOOL_CONTRACT.md#connecting-a-client).

## Step 5: Deploy and test

```bash
alexa-ai deploy
```

Open the [Alexa+ simulator](https://developer.amazon.com/alexa/console/ask/addons/simulator)
and choose the stage **development**. Use **Isolation** mode to test our tools directly,
and **Global** mode to check that Alexa+ routes marketplace requests to us. When asked,
link the account on our sign-in page: seller and buyer each sign in with their own
Amazon account, or with two names in the judge demo sign-in. You'll probably need
two Alexa accounts or two linking sessions; note what works in the friction log.

Test script:
1. "Sell my TI-84 graphing calculator for 20 dollars. I'll accept anything above 15."
2. *(buyer)* "I need a graphing calculator today, maximum 18 dollars."
3. Alexa offers it → expect **$18**, $2 below asking
4. "Yes, confirm it."

Watch the server logs (`[mcp] tools/call …`) and the dashboard at `https://<host>/dashboard/`.

You don't need `alexa-ai submit` (certification) for the hackathon; testing in the
development stage is enough for the demo.

---

## Listing text (respect the character limits)

**Name** (30 max): `PairUp`

**Short description** (123 max):
> Buy, sell and get help from people nearby, by voice. Alexa pairs you up and settles inside your private limits.

**Full description** (4000 max):
> PairUp pairs people who need something with people who have it or can do it: a used calculator, someone to pick up your lunch, a helper for your event. You use it just by talking.
>
> Selling: tell Alexa what you have, your asking price and, if you like, the lowest price you'd accept. Your minimum is never shown to buyers.
>
> Buying: tell Alexa what you need and the most you'd pay. PairUp finds the best seller by meaning and keywords, checks condition, quantity and price, and settles a fair price inside both people's limits in the same moment. If nobody has it yet, your request waits and Alexa pairs you as soon as someone lists one.
>
> Getting help: ask for someone to pick up your lunch, run an errand or help at your event, with a fee per job or an hourly rate. Alexa finds a person nearby who offers that kind of help, agrees the fee inside both limits, and tells you where and when.
>
> Offering help: say what you can do and your rate, like lunch runs around campus for $4. Alexa brings you jobs as people ask, and you say yes to each one.
>
> Each side says yes before a deal closes, and both get the meet-up details right away.
>
> Because it takes a single sentence, small things become worth doing: a $2 pack of tissues, a $4 lunch run.
>
> PairUp is a prototype built for the Amazon Developer Hackathon 2026. Payment happens in person at the meet-up.

**Example phrases** (3–4, 200 max each):
1. `Alexa, sell my TI-84 calculator for 20 dollars, I'll take anything above 15`
2. `Alexa, I need a graphing calculator today for under 18 dollars`
3. `Alexa, find someone to pick up my lunch from the canteen by 12:30, 5 dollars`
4. `Alexa, any jobs or deals for me?`

**Privacy policy URL:** `https://<host>/privacy.html`
**Terms of use URL:** `https://<host>/terms.html`
