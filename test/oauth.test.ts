import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMockAi } from "../src/ai/mock.js";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb, type Db } from "../src/db/client.js";

// Account linking as Alexa+ performs it: metadata discovery, authorization code
// with PKCE S256, token exchange, Bearer calls to /mcp, refresh rotation.

const PUBLIC = "https://market.example";
const CLIENT = { id: "alexa-client", secret: "s3cret" };
const REDIRECT = "https://alexa.example/link/callback";

let db: Db;
let server: Server;
let base: string;

before(async () => {
  db = await openDb({ databaseUrl: "", pgliteDir: "", embeddingDim: 64 }, { inMemory: true });
  const cfg = {
    ...config, host: "127.0.0.1", authMode: "oauth" as const, publicBaseUrl: PUBLIC,
    oauthClientId: CLIENT.id, oauthClientSecret: CLIENT.secret, oauthRedirectUris: [REDIRECT],
    demoLoginPasscode: "",
  };
  const app = createApp({ db, ai: createMockAi(64), cfg: { matchThreshold: 0.35 } }, cfg);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
after(async () => {
  server.close();
  await db.close();
});

const basic = `Basic ${Buffer.from(`${CLIENT.id}:${CLIENT.secret}`).toString("base64")}`;

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizeParams(challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({
    client_id: CLIENT.id, redirect_uri: REDIRECT, response_type: "code", state: "xyz",
    code_challenge: challenge, code_challenge_method: "S256", scope: "marketplace",
    resource: `${PUBLIC}/mcp`, ...extra,
  });
}

/** Signs in as `name` and returns the authorization code from the redirect. */
async function signIn(name: string, challenge: string) {
  const form = authorizeParams(challenge, { display_name: name });
  const res = await fetch(`${base}/oauth/authorize`, { method: "POST", body: form, redirect: "manual" });
  assert.equal(res.status, 302);
  const to = new URL(res.headers.get("location")!);
  assert.equal(`${to.origin}${to.pathname}`, REDIRECT);
  assert.equal(to.searchParams.get("state"), "xyz");
  return to.searchParams.get("code")!;
}

const token = (body: Record<string, string>, auth = basic) =>
  fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { Authorization: auth },
    body: new URLSearchParams(body),
  });

async function mcpAs(accessToken: string) {
  const client = new Client({ name: "alexa-test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    }),
  );
  return client;
}

test("publishes protected-resource and authorization-server metadata", async () => {
  const pr = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  assert.equal(pr.resource, `${PUBLIC}/mcp`);
  assert.deepEqual(pr.authorization_servers, [PUBLIC]);
  assert.deepEqual(pr.scopes_supported, ["marketplace"]);

  const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.equal(as.issuer, PUBLIC);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
  assert.ok(as.grant_types_supported.includes("refresh_token"));
});

test("/mcp without a token returns 401 pointing at the resource metadata", async () => {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /resource_metadata="https:\/\/market\.example\/\.well-known\/oauth-protected-resource"/);
});

test("authorize rejects unregistered redirect URIs and missing PKCE", async () => {
  const { challenge } = pkce();
  const bad = authorizeParams(challenge, { redirect_uri: "https://evil.example/cb" });
  assert.equal((await fetch(`${base}/oauth/authorize?${bad}`)).status, 400);
  const plain = authorizeParams(challenge, { code_challenge_method: "plain" });
  assert.equal((await fetch(`${base}/oauth/authorize?${plain}`)).status, 400);
  const ok = await fetch(`${base}/oauth/authorize?${authorizeParams(challenge)}`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Link VoiceMarket to Alexa/);
});

test("code exchange enforces PKCE, client secret and single use", async () => {
  const { verifier, challenge } = pkce();
  const code = await signIn("Priya", challenge);
  const wrongSecret = `Basic ${Buffer.from(`${CLIENT.id}:nope`).toString("base64")}`;
  assert.equal((await token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier }, wrongSecret)).status, 401);

  const code2 = await signIn("Priya", challenge);
  const badPkce = await token({ grant_type: "authorization_code", code: code2, redirect_uri: REDIRECT, code_verifier: "wrong" });
  assert.equal(badPkce.status, 400);
  assert.equal((await badPkce.json()).error, "invalid_grant");

  const code3 = await signIn("Priya", challenge);
  const good = await token({ grant_type: "authorization_code", code: code3, redirect_uri: REDIRECT, code_verifier: verifier, resource: `${PUBLIC}/mcp` });
  assert.equal(good.status, 200);
  const reuse = await token({ grant_type: "authorization_code", code: code3, redirect_uri: REDIRECT, code_verifier: verifier });
  assert.equal(reuse.status, 400, "codes are single use");
});

test("linked users act as themselves; user_id arguments cannot impersonate", async () => {
  const { verifier, challenge } = pkce();
  const code = await signIn("Mei", challenge);
  const tokens = await (await token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier })).json();
  assert.equal(tokens.token_type, "Bearer");
  assert.ok(tokens.refresh_token, "refresh token issued with every access token");

  const client = await mcpAs(tokens.access_token);
  const res = await client.callTool({
    name: "create_listing",
    arguments: { user_id: "u_someone_else", title: "Desk fan", ask_price: 10, min_price: 7 },
  });
  const { listing } = JSON.parse((res.content as { text: string }[])[0].text);
  const { rows } = await db.query<{ seller_id: string }>(`SELECT seller_id FROM listings WHERE id = $1`, [listing.listing_id]);
  assert.equal(rows[0].seller_id, "u_mei");
  await client.close();
});

test("refresh tokens rotate and old ones stop working", async () => {
  const { verifier, challenge } = pkce();
  const code = await signIn("Ken", challenge);
  const first = await (await token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier })).json();

  const second = await token({ grant_type: "refresh_token", refresh_token: first.refresh_token });
  assert.equal(second.status, 200);
  const rotated = await second.json();
  assert.notEqual(rotated.refresh_token, first.refresh_token);

  const replay = await token({ grant_type: "refresh_token", refresh_token: first.refresh_token });
  assert.equal(replay.status, 400, "used refresh token is revoked");

  const client = await mcpAs(rotated.access_token);
  assert.ok((await client.listTools()).tools.length > 0);
  await client.close();
});
