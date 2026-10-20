import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import type { Server } from "node:http";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import express from "express";
import { createMockAi } from "../src/ai/mock.js";
import { createApp } from "../src/app.js";
import { LWA, oauthRouter, userForAccessToken } from "../src/auth/oauth.js";
import { config, loginMethods } from "../src/config.js";
import { openDb, type Db } from "../src/db/client.js";

// Account linking as Alexa+ performs it: metadata discovery, authorization code
// with PKCE S256, token exchange, Bearer calls to /mcp, refresh rotation and
// revocation. This server runs the labelled judge demo sign-in (name + passcode).
// A second server further down runs Login with Amazon for third-party MCP
// clients (Client ID Metadata Documents and dynamic registration), with every
// outbound HTTP call mocked.

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
    lwaClientId: "", lwaClientSecret: "", demoMode: true, demoLoginPasscode: "",
  };
  const app = createApp({ db, ai: createMockAi(64), cfg: { matchThreshold: 0.35 } }, cfg);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  await startServer2();
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

const passcodeFor = (name: string) => `pass-${name.toLowerCase()}`;

/** Signs in to the demo as `name` and returns the authorization code from the redirect. */
async function signIn(name: string, challenge: string) {
  const form = authorizeParams(challenge, { method: "demo", display_name: name, passcode: passcodeFor(name) });
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
    headers: auth ? { Authorization: auth } : {},
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
  assert.equal(as.client_id_metadata_document_supported, true);
  assert.equal(as.registration_endpoint, `${PUBLIC}/oauth/register`);
  assert.equal(as.revocation_endpoint, `${PUBLIC}/oauth/revoke`);
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
  const html = await ok.text();
  assert.match(html, /Link AmazonPairUp to Alexa/);
  assert.match(html, /Demo sign-in for judges/, "the name sign-in is labelled as the demo");
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
    name: "post_offer",
    arguments: { user_id: "u_someone_else", title: "Desk fan", ask_price: 10, min_price: 7 },
  });
  const { offer: listing } = JSON.parse((res.content as { text: string }[])[0].text);
  const { rows } = await db.query<{ seller_id: string }>(`SELECT seller_id FROM listings WHERE id = $1`, [listing.offer_id]);
  assert.equal(rows[0].seller_id, "u_mei");
  await client.close();
});

test("nobody can sign in as someone else by typing their name", async () => {
  const { challenge } = pkce();
  await signIn("Rosa", challenge);
  for (const name of ["Rosa", "rosa", "ROSA!"]) {
    const form = authorizeParams(challenge, { method: "demo", display_name: name, passcode: "not-rosas-passcode" });
    const res = await fetch(`${base}/oauth/authorize`, { method: "POST", body: form, redirect: "manual" });
    assert.equal(res.status, 401, `${name} with the wrong passcode gets no code`);
    assert.equal(res.headers.get("location"), null);
  }
  const bare = await fetch(`${base}/oauth/authorize`, { method: "POST", body: authorizeParams(challenge, { display_name: "Rosa" }), redirect: "manual" });
  assert.equal(bare.status, 400, "a bare name signs nobody in");

  for (let i = 0; i < 10; i++) {
    await fetch(`${base}/oauth/authorize`, { method: "POST", body: authorizeParams(challenge, { method: "demo", display_name: "Rosa", passcode: `guess-${i}-x` }) });
  }
  const locked = await fetch(`${base}/oauth/authorize`, {
    method: "POST", body: authorizeParams(challenge, { method: "demo", display_name: "Rosa", passcode: passcodeFor("Rosa") }), redirect: "manual",
  });
  assert.equal(locked.status, 429, "guessing a passcode is throttled per name");
});

test("the name sign-in is only for local development and the labelled demo", () => {
  const off = { lwaClientId: "", lwaClientSecret: "", demoMode: false };
  assert.deepEqual(loginMethods({ ...off, publicBaseUrl: "https://market.example" }), [], "a public host without Login with Amazon has no sign-in, so config refuses to start");
  assert.deepEqual(loginMethods({ ...off, publicBaseUrl: "http://localhost:3000" }), ["demo"]);
  assert.deepEqual(loginMethods({ ...off, publicBaseUrl: "https://market.example", demoMode: true }), ["demo"]);
  assert.deepEqual(loginMethods({ ...off, publicBaseUrl: "https://market.example", lwaClientId: "amzn1.application-oa2-client.x", lwaClientSecret: "s" }), ["amazon"]);
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

test("revocation (RFC 7009): an access token alone, or a refresh token with its whole grant", async () => {
  const { verifier, challenge } = pkce();
  const code = await signIn("Omar", challenge);
  const first = await (await token({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: verifier })).json();
  const me = (t: string) => fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${t}` } });
  const revoke = (body: Record<string, string>, auth = basic) =>
    fetch(`${base}/oauth/revoke`, { method: "POST", headers: auth ? { Authorization: auth } : {}, body: new URLSearchParams(body) });

  assert.equal((await revoke({ token: first.access_token }, "")).status, 401, "the client must authenticate");
  assert.equal((await revoke({ token: "never-issued" })).status, 200, "unknown tokens are not an error");

  assert.equal((await revoke({ token: first.access_token, token_type_hint: "access_token" })).status, 200);
  assert.equal((await me(first.access_token)).status, 401);
  const second = await (await token({ grant_type: "refresh_token", refresh_token: first.refresh_token })).json();
  assert.equal((await me(second.access_token)).status, 200, "revoking an access token leaves the refresh token");

  assert.equal((await revoke({ token: second.refresh_token })).status, 200);
  assert.equal((await me(second.access_token)).status, 401, "revoking a refresh token revokes its grant's access tokens");
  assert.equal((await token({ grant_type: "refresh_token", refresh_token: second.refresh_token })).status, 400);
});

test("the web app signs in as a public client: PKCE, its own origin, no secret", async () => {
  const cfg = await (await fetch(`${base}/api/app-config`)).json();
  assert.deepEqual(cfg, {
    auth: "oauth", clientId: "amazonpairup-web", redirectUri: `${PUBLIC}/app/`,
    authorizeUrl: `${PUBLIC}/oauth/authorize`, tokenUrl: `${PUBLIC}/oauth/token`, resource: `${PUBLIC}/mcp`,
  });

  const { verifier, challenge } = pkce();
  const params = { client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: "code", state: "w1", code_challenge: challenge, code_challenge_method: "S256", scope: "marketplace", resource: cfg.resource };
  const elsewhere = await fetch(`${base}/oauth/authorize?${new URLSearchParams({ ...params, redirect_uri: "https://evil.example/app/" })}`);
  assert.equal(elsewhere.status, 400, "the web client redirects only to this server's /app/");

  const res = await fetch(`${base}/oauth/authorize`, {
    method: "POST", body: new URLSearchParams({ ...params, method: "demo", display_name: "Priya", passcode: passcodeFor("Priya") }), redirect: "manual",
  });
  assert.equal(res.status, 302);
  const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
  const exchange = (extra: Record<string, string> = {}) => fetch(`${base}/oauth/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, code_verifier: verifier, client_id: cfg.clientId, ...extra }),
  });
  assert.equal((await exchange({ client_secret: "guess" })).status, 401, "a public client never authenticates with a secret");
  const ok = await exchange();
  assert.equal(ok.status, 200);
  const tokens = await ok.json();

  const me = await (await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${tokens.access_token}` } })).json();
  assert.deepEqual(me, { userId: "u_priya", name: "Priya" });

  const refreshed = await fetch(`${base}/oauth/token`, { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: cfg.clientId }) });
  assert.equal(refreshed.status, 200, "public clients refresh with rotation");
  const alexaWithoutSecret = await token({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: CLIENT.id }, "");
  assert.equal(alexaWithoutSecret.status, 401, "the confidential client still needs its secret");
});

// ---- Login with Amazon + third-party MCP clients (mocked outbound HTTP) ----

const PUBLIC2 = "https://pairup.example";
const AGENT_ID = "https://agent.example/oauth/client.json";
const AGENT_REDIRECT = "https://agent.example/callback";
const LWA_CLIENT = "amzn1.application-oa2-client.test";
let server2: Server;
let base2: string;
const fetched: string[] = [];

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const mockFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  fetched.push(url);
  if (url === AGENT_ID) {
    return json(
      { client_id: AGENT_ID, client_name: "Strands Test Agent", redirect_uris: [AGENT_REDIRECT, "http://127.0.0.1/callback"], token_endpoint_auth_method: "none" },
      200,
      { "Cache-Control": "max-age=600" },
    );
  }
  if (url === "https://other.example/client.json") return json({ client_id: "https://someone-else.example/client.json", redirect_uris: [AGENT_REDIRECT] });
  if (url === "https://secret.example/client.json") return json({ client_id: url, redirect_uris: [AGENT_REDIRECT], token_endpoint_auth_method: "client_secret_basic" });
  if (url === LWA.token) {
    const body = new URLSearchParams(String(init?.body));
    const ok = body.get("code") === "amzn-code" && body.get("client_id") === LWA_CLIENT && body.get("client_secret") === "lwa-secret"
      && body.get("redirect_uri") === `${PUBLIC2}/oauth/amazon/callback`;
    return ok ? json({ access_token: "lwa-access", token_type: "bearer" }) : json({ error: "invalid_grant" }, 400);
  }
  if (url === LWA.profile) {
    return new Headers(init?.headers).get("authorization") === "Bearer lwa-access"
      ? json({ user_id: "amzn1.account.TESTUSER", name: "Priya Shah", email: "priya@example.com" })
      : json({ error: "invalid_token" }, 401);
  }
  return new Response("not found", { status: 404 });
};

/** Started by the first before() hook, once the database is open. */
async function startServer2() {
  const cfg2 = {
    ...config, publicBaseUrl: PUBLIC2, oauthClientId: "", oauthClientSecret: "", oauthRedirectUris: [],
    lwaClientId: LWA_CLIENT, lwaClientSecret: "lwa-secret", demoMode: false, demoLoginPasscode: "", dcrPerHour: 5,
  };
  const app = express();
  app.use(oauthRouter(db, cfg2, { fetch: mockFetch }));
  app.get("/me", async (req, res) => {
    const userId = await userForAccessToken(db, req.headers.authorization);
    if (!userId) return void res.status(401).end();
    const { rows } = await db.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id = $1`, [userId]);
    res.json({ userId, name: rows[0]?.display_name });
  });
  await new Promise<void>((resolve) => {
    server2 = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server2.address();
  base2 = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}
after(() => {
  server2.close();
});

function clientParams(clientId: string, redirectUri: string, challenge: string) {
  return {
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", state: "s1",
    code_challenge: challenge, code_challenge_method: "S256", scope: "marketplace", resource: `${PUBLIC2}/mcp`,
  };
}

const authorize2 = (params: Record<string, string>) =>
  fetch(`${base2}/oauth/authorize`, { method: "POST", body: new URLSearchParams(params), redirect: "manual" });

/** Consents and signs in through (mocked) Login with Amazon; returns where the client is sent back to. */
async function signInWithAmazon(params: Record<string, string>) {
  const start = await authorize2({ ...params, method: "amazon" });
  assert.equal(start.status, 302);
  const lwa = new URL(start.headers.get("location")!);
  assert.equal(`${lwa.origin}${lwa.pathname}`, LWA.authorize);
  assert.equal(lwa.searchParams.get("client_id"), LWA_CLIENT);
  assert.equal(lwa.searchParams.get("redirect_uri"), `${PUBLIC2}/oauth/amazon/callback`);
  assert.equal(lwa.searchParams.get("scope"), "profile");
  const state = lwa.searchParams.get("state")!;
  const cookie = start.headers.get("set-cookie")!.split(";")[0];
  assert.equal(cookie, `pairup_lwa=${state}`);

  const back = await fetch(`${base2}/oauth/amazon/callback?${new URLSearchParams({ code: "amzn-code", state })}`, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(back.status, 302);
  return new URL(back.headers.get("location")!);
}

const token2 = (body: Record<string, string>) => fetch(`${base2}/oauth/token`, { method: "POST", body: new URLSearchParams(body) });

test("Client ID Metadata Documents: an unregistered agent connects with its URL as client_id", async () => {
  const { verifier, challenge } = pkce();
  const consent = await fetch(`${base2}/oauth/authorize?${new URLSearchParams(clientParams(AGENT_ID, AGENT_REDIRECT, challenge))}`);
  assert.equal(consent.status, 200);
  const html = await consent.text();
  assert.match(html, /Allow Strands Test Agent to use AmazonPairUp\?/, "the consent screen names the client");
  assert.match(html, /Published by <strong>agent\.example<\/strong>/);
  assert.match(html, /Continue with Amazon/);
  assert.doesNotMatch(html, /Demo sign-in/, "no name sign-in once Login with Amazon is on");

  const loopback = await fetch(`${base2}/oauth/authorize?${new URLSearchParams(clientParams(AGENT_ID, "http://127.0.0.1:53111/callback", challenge))}`);
  assert.equal(loopback.status, 200, "a loopback redirect may use any port");
  for (const [id, redirect, why] of [
    [AGENT_ID, "https://evil.example/callback", "redirect_uri not in the document"],
    ["https://other.example/client.json", AGENT_REDIRECT, "the document names another client_id"],
    ["https://secret.example/client.json", AGENT_REDIRECT, "only public clients"],
    ["http://agent.example/oauth/client.json", AGENT_REDIRECT, "https only"],
    ["https://agent.example/", AGENT_REDIRECT, "the URL needs a path"],
    ["https://missing.example/client.json", AGENT_REDIRECT, "no document"],
  ]) {
    assert.equal((await fetch(`${base2}/oauth/authorize?${new URLSearchParams(clientParams(id, redirect, challenge))}`)).status, 400, why);
  }
  assert.equal(fetched.filter((u) => u === AGENT_ID).length, 1, "the document is cached (Cache-Control max-age)");

  const to = await signInWithAmazon(clientParams(AGENT_ID, AGENT_REDIRECT, challenge));
  assert.equal(`${to.origin}${to.pathname}`, AGENT_REDIRECT);
  assert.equal(to.searchParams.get("state"), "s1");
  assert.equal(to.searchParams.get("iss"), PUBLIC2);
  const res = await token2({ grant_type: "authorization_code", code: to.searchParams.get("code")!, redirect_uri: AGENT_REDIRECT, code_verifier: verifier, client_id: AGENT_ID });
  assert.equal(res.status, 200);
  const tokens = await res.json();
  const me = await (await fetch(`${base2}/me`, { headers: { Authorization: `Bearer ${tokens.access_token}` } })).json();
  assert.deepEqual(me, { userId: "amzn1.account.TESTUSER", name: "Priya" }, "the user is the Amazon account; others see the first name");

  const refreshed = await token2({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: AGENT_ID });
  assert.equal(refreshed.status, 200);
});

test("Login with Amazon: the callback needs the browser that started it, and a typed name never signs in", async () => {
  const { challenge } = pkce();
  const params = clientParams(AGENT_ID, AGENT_REDIRECT, challenge);
  const start = await authorize2({ ...params, method: "amazon" });
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const noCookie = await fetch(`${base2}/oauth/amazon/callback?${new URLSearchParams({ code: "amzn-code", state })}`, { redirect: "manual" });
  assert.equal(noCookie.status, 400);
  const forged = await fetch(`${base2}/oauth/amazon/callback?${new URLSearchParams({ code: "amzn-code", state })}`, { headers: { Cookie: "pairup_lwa=forged" }, redirect: "manual" });
  assert.equal(forged.status, 400);

  for (const method of ["demo", ""]) {
    const typed = await authorize2({ ...params, method, display_name: "Priya", passcode: "whatever-it-is" });
    assert.equal(typed.status, 400, "typing a name is not a sign-in on a public server");
    assert.equal(typed.headers.get("location"), null);
  }

  const denied = await authorize2({ ...params, method: "deny" });
  const to = new URL(denied.headers.get("location")!);
  assert.equal(to.searchParams.get("error"), "access_denied");
  assert.equal(to.searchParams.get("code"), null);
});

test("dynamic client registration (RFC 7591): public clients, safe redirect URIs, rate limited", async () => {
  const register = (body: unknown) =>
    fetch(`${base2}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const res = await register({ client_name: "Cursor", redirect_uris: ["http://127.0.0.1/cb"], token_endpoint_auth_method: "client_secret_basic" });
  assert.equal(res.status, 201);
  const reg = await res.json();
  assert.match(reg.client_id, /^dcr_/);
  assert.equal(reg.token_endpoint_auth_method, "none", "registered clients are public");
  assert.equal(reg.client_secret, undefined);
  assert.deepEqual(reg.redirect_uris, ["http://127.0.0.1/cb"]);

  for (const uris of [["http://evil.example/cb"], ["javascript:alert(1)"], ["https://ok.example/cb#frag"], []]) {
    const bad = await register({ client_name: "Bad", redirect_uris: uris });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "invalid_redirect_uri");
  }

  const { verifier, challenge } = pkce();
  const redirect = "http://127.0.0.1:61000/cb";
  const consent = await (await fetch(`${base2}/oauth/authorize?${new URLSearchParams(clientParams(reg.client_id, redirect, challenge))}`)).text();
  assert.match(consent, /Allow Cursor to use AmazonPairUp\?/);
  assert.match(consent, /not verified/);

  const to = await signInWithAmazon(clientParams(reg.client_id, redirect, challenge));
  const withSecret = await token2({ grant_type: "authorization_code", code: to.searchParams.get("code")!, redirect_uri: redirect, code_verifier: verifier, client_id: reg.client_id, client_secret: "guess" });
  assert.equal(withSecret.status, 401, "a public client never authenticates with a secret");
  const to2 = await signInWithAmazon(clientParams(reg.client_id, redirect, challenge));
  const ok = await token2({ grant_type: "authorization_code", code: to2.searchParams.get("code")!, redirect_uri: redirect, code_verifier: verifier, client_id: reg.client_id });
  assert.equal(ok.status, 200);

  let status = 0;
  for (let i = 0; i < 6 && status !== 429; i++) status = (await register({ redirect_uris: ["https://ok.example/cb"] })).status;
  assert.equal(status, 429, "registrations are limited per address");
});
