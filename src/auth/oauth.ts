import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { promisify } from "node:util";
import express, { type Request, type Response, type Router } from "express";
import { loginMethods, type Config } from "../config.js";
import type { Db } from "../db/client.js";
import { ensureUser } from "../market/service.js";

// OAuth 2.1 authorization server + protected resource metadata, for Alexa+
// account linking and for any spec-compliant MCP client (Claude, ChatGPT,
// Cursor, a Strands agent):
//   - RFC 9728 metadata at /.well-known/oauth-protected-resource
//   - RFC 8414 metadata at /.well-known/oauth-authorization-server (S256 listed)
//   - authorization code grant with PKCE S256, `resource` checked when sent
//   - a refresh token with every access token (rotated on use)
//   - RFC 7009 revocation at /oauth/revoke (a refresh token takes its whole grant)
//   - bearer tokens only in the Authorization header
// Clients:
//   - the PairUp web app: built in, public (PKCE, no secret), redirects
//     only to this server's own /app/
//   - Alexa+ account linking: confidential, when OAUTH_CLIENT_ID,
//     OAUTH_CLIENT_SECRET and OAUTH_REDIRECT_URIS are set
//   - Client ID Metadata Documents (MCP 2025-11-25): the client_id is an HTTPS
//     URL serving the client's metadata as JSON; fetched, validated and cached
//   - RFC 7591 dynamic registration at /oauth/register: public clients only,
//     https or loopback redirect URIs, rate limited per IP
// Third-party clients get a consent screen naming them before sign-in.
// Who the user is: Login with Amazon (LWA_CLIENT_ID / LWA_CLIENT_SECRET), the
// user id being the Amazon account's user_id. A name + passcode sign-in exists
// for local development and the labelled judge demo (DEMO_MODE=true); the first
// sign-in with a name sets its passcode, so nobody can take over a name.

export const SCOPE = "marketplace";
const CODE_TTL_S = 600;
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 24 * 3600;
const PENDING_TTL_S = 600;

type AuthConfig = Pick<
  Config,
  | "publicBaseUrl" | "oauthClientId" | "oauthClientSecret" | "oauthRedirectUris"
  | "lwaClientId" | "lwaClientSecret" | "demoMode" | "demoLoginPasscode" | "dcrPerHour"
>;

export interface OAuthOptions {
  /** Outbound HTTP (client metadata documents, Login with Amazon). Tests pass a mock. */
  fetch?: typeof fetch;
}

/** The PairUp web app's client id (public client, PKCE only). */
export const WEB_CLIENT_ID = "pairup-web";

interface OAuthClient {
  id: string;
  /** Present for confidential clients only. */
  secret?: string;
  redirectUris: string[];
  /** web and alexa are first party; metadata (CIMD) and registered (DCR) get a consent screen. */
  kind: "web" | "alexa" | "metadata" | "registered";
  /** Shown on the consent screen. */
  name: string;
}

export const webRedirectUri = (cfg: Pick<Config, "publicBaseUrl">) => `${cfg.publicBaseUrl}/app/`;
const amazonRedirectUri = (cfg: AuthConfig) => `${cfg.publicBaseUrl}/oauth/amazon/callback`;

export const LWA = {
  authorize: "https://www.amazon.com/ap/oa",
  token: "https://api.amazon.com/auth/o2/token",
  profile: "https://api.amazon.com/user/profile",
};

function builtInClients(cfg: AuthConfig): OAuthClient[] {
  const clients: OAuthClient[] = [{ id: WEB_CLIENT_ID, redirectUris: [webRedirectUri(cfg)], kind: "web", name: "PairUp" }];
  if (cfg.oauthClientId && cfg.oauthClientSecret) {
    clients.push({ id: cfg.oauthClientId, secret: cfg.oauthClientSecret, redirectUris: cfg.oauthRedirectUris, kind: "alexa", name: "Alexa" });
  }
  return clients;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newSecret = () => randomBytes(32).toString("base64url");
const pkceS256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const resourceUrl = (cfg: Pick<Config, "publicBaseUrl">) => `${cfg.publicBaseUrl}/mcp`;
export const resourceMetadataUrl = (cfg: Pick<Config, "publicBaseUrl">) => `${cfg.publicBaseUrl}/.well-known/oauth-protected-resource`;

/** Resolve a Bearer token to a user id, or null if missing, unknown, expired or revoked. */
export async function userForAccessToken(db: Db, authorization: string | undefined) {
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return null;
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM oauth_tokens
     WHERE token_hash = $1 AND kind = 'access' AND NOT revoked AND expires_at > now()`,
    [sha256(token)],
  );
  return rows[0]?.user_id ?? null;
}

// ---- Redirect URIs ----

const LOOPBACK_HOSTS = ["127.0.0.1", "[::1]", "localhost"];
const isLoopback = (u: URL) => u.protocol === "http:" && LOOPBACK_HOSTS.includes(u.hostname);

/** Third-party redirect URIs must be https, or http on a loopback address (native apps, RFC 8252). */
export function redirectUriProblem(uri: unknown): string | null {
  if (typeof uri !== "string" || uri.length > 2000) return "Redirect URIs must be strings.";
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return `Not a URL: ${uri}`;
  }
  if (u.hash || uri.includes("#")) return "Redirect URIs can't have a fragment.";
  if (u.protocol !== "https:" && !isLoopback(u)) return "Redirect URIs must use https, or http on a loopback address.";
  return null;
}

/** Exact match, except that a loopback redirect may use any port (RFC 8252 §7.3). */
function redirectAllowed(registered: string[], requested: string) {
  if (registered.includes(requested)) return true;
  let req: URL;
  try {
    req = new URL(requested);
  } catch {
    return false;
  }
  if (!isLoopback(req)) return false;
  return registered.some((r) => {
    const reg = new URL(r);
    return isLoopback(reg) && reg.hostname === req.hostname && reg.pathname === req.pathname && reg.search === req.search;
  });
}

// ---- Client ID Metadata Documents ----

const METADATA_MAX_BYTES = 5 * 1024;
const METADATA_TIMEOUT_MS = 5000;

/** Why a client_id can't be a metadata document URL, or null if it can. */
export function metadataClientIdProblem(id: string): string | null {
  if (id.length > 2000) return "Client ID is too long.";
  let u: URL;
  try {
    u = new URL(id);
  } catch {
    return "Client ID is not a URL.";
  }
  if (u.protocol !== "https:") return "Client ID URLs must use https.";
  if (u.username || u.password) return "Client ID URLs can't carry credentials.";
  if (u.hash || id.includes("#")) return "Client ID URLs can't have a fragment.";
  if (u.pathname === "/" || u.pathname === "") return "Client ID URLs must have a path.";
  if (id.split("?")[0].split("/").some((seg) => seg === "." || seg === "..")) return "Client ID URLs can't have dot segments.";
  return null;
}

// Metadata documents are fetched from addresses the client picks, so the default
// fetcher refuses private, loopback and link-local addresses (SSRF).
const privateAddresses = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) privateAddresses.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 127], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  privateAddresses.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(ip: string) {
  const family = isIP(ip);
  if (!family) return false;
  return !privateAddresses.check(ip, family === 6 ? "ipv6" : "ipv4");
}

const publicOnlyFetch: typeof fetch = async (input, init) => {
  const host = new URL(String(input)).hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (!addresses.length || !addresses.every(isPublicAddress)) throw new Error("client metadata host is not public");
  return fetch(input, init);
};

async function readLimited(res: globalThis.Response, maxBytes: number) {
  if (Number(res.headers.get("content-length") ?? 0) > maxBytes) throw new Error("document too large");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("document too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Validates a fetched metadata document against the URL it came from. */
export function clientFromMetadata(id: string, doc: unknown): OAuthClient | string {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return "The client's metadata is not a JSON object.";
  const d = doc as Record<string, unknown>;
  if (d.client_id !== id) return "The client's metadata names a different client_id.";
  if ("client_secret" in d || "client_secret_expires_at" in d) return "Client metadata documents can't carry a secret.";
  if (d.token_endpoint_auth_method !== undefined && d.token_endpoint_auth_method !== "none") {
    return "Only public clients (token_endpoint_auth_method none) are supported.";
  }
  if (!Array.isArray(d.redirect_uris) || !d.redirect_uris.length || d.redirect_uris.length > 10) return "The client's metadata needs redirect_uris.";
  for (const uri of d.redirect_uris) {
    const problem = redirectUriProblem(uri);
    if (problem) return problem;
  }
  if (Array.isArray(d.grant_types) && d.grant_types.some((g) => g !== "authorization_code" && g !== "refresh_token")) {
    return "Unsupported grant type in the client's metadata.";
  }
  return { id, redirectUris: d.redirect_uris as string[], kind: "metadata", name: cleanName(d.client_name) || new URL(id).hostname };
}

function cacheSeconds(cacheControl: string | null) {
  const maxAge = Number(cacheControl?.match(/max-age=(\d+)/)?.[1] ?? 300);
  if (/no-store|no-cache/.test(cacheControl ?? "")) return 60;
  return Math.min(Math.max(maxAge, 60), 24 * 3600);
}

/** A client-supplied name, safe to show: no control characters, at most 80 characters. */
function cleanName(name: unknown) {
  return typeof name === "string" ? name.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 80) : "";
}

// ---- Small fixed-window limiter (per process) ----

function limiter(max: number, windowMs: number) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    /** Counts one hit; false once the key is over the limit. */
    hit(key: string) {
      const now = Date.now();
      if (windows.size > 10_000) for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k);
      const w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        windows.set(key, { start: now, count: 1 });
        return true;
      }
      return ++w.count <= max;
    },
    blocked(key: string) {
      const w = windows.get(key);
      return !!w && Date.now() - w.start < windowMs && w.count >= max;
    },
    clear(key: string) {
      windows.delete(key);
    },
  };
}

// ---- The router ----

interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scope: string;
  resource?: string;
}

export function oauthRouter(db: Db, cfg: AuthConfig, opts: OAuthOptions = {}): Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));
  const httpFetch = opts.fetch ?? fetch;
  const metadataFetch = opts.fetch ?? publicOnlyFetch;
  const builtIn = builtInClients(cfg);
  const methods = loginMethods(cfg);
  const metadataCache = new Map<string, { client: OAuthClient; expires: number }>();
  const registrations = limiter(cfg.dcrPerHour, 3600_000);
  const passcodeFailures = limiter(10, 15 * 60_000);

  async function fetchMetadataClient(id: string): Promise<OAuthClient | string> {
    const cached = metadataCache.get(id);
    if (cached && cached.expires > Date.now()) return cached.client;
    let res: globalThis.Response;
    let doc: unknown;
    try {
      res = await metadataFetch(id, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) });
      if (!res.ok) return `Couldn't load the client's metadata (HTTP ${res.status}).`;
      doc = JSON.parse(await readLimited(res, METADATA_MAX_BYTES));
    } catch {
      return "Couldn't load the client's metadata.";
    }
    const client = clientFromMetadata(id, doc);
    if (typeof client === "string") return client;
    if (metadataCache.size > 1000) metadataCache.clear();
    metadataCache.set(id, { client, expires: Date.now() + cacheSeconds(res.headers.get("cache-control")) * 1000 });
    return client;
  }

  /**
   * Finds a client. At the token and revocation endpoints a metadata-document
   * client is known to be public from its URL alone: its code is bound to that
   * client_id and to PKCE, so its document is not fetched again.
   */
  async function resolveClient(id: string | undefined, atTokenEndpoint = false): Promise<OAuthClient | string> {
    if (!id) return "Unknown client.";
    const known = builtIn.find((c) => c.id === id);
    if (known) return known;
    if (id.startsWith("https://")) {
      const problem = metadataClientIdProblem(id);
      if (problem) return problem;
      if (atTokenEndpoint) return { id, redirectUris: [], kind: "metadata", name: new URL(id).hostname };
      return fetchMetadataClient(id);
    }
    if (id.startsWith("dcr_")) {
      const { rows } = await db.query<{ client_name: string | null; redirect_uris: string[] }>(
        `SELECT client_name, redirect_uris FROM oauth_clients WHERE client_id = $1`,
        [id],
      );
      if (rows[0]) return { id, redirectUris: rows[0].redirect_uris, kind: "registered", name: rows[0].client_name || "An unnamed app" };
    }
    return "Unknown client.";
  }

  const protectedResource = {
    resource: resourceUrl(cfg),
    authorization_servers: [cfg.publicBaseUrl],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
  };
  router.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (_req, res) => {
    res.json(protectedResource);
  });

  router.get("/.well-known/oauth-authorization-server", (_req, res) => {
    const authMethods = ["client_secret_basic", "client_secret_post", "none"];
    res.json({
      issuer: cfg.publicBaseUrl,
      authorization_endpoint: `${cfg.publicBaseUrl}/oauth/authorize`,
      token_endpoint: `${cfg.publicBaseUrl}/oauth/token`,
      revocation_endpoint: `${cfg.publicBaseUrl}/oauth/revoke`,
      ...(cfg.dcrPerHour > 0 ? { registration_endpoint: `${cfg.publicBaseUrl}/oauth/register` } : {}),
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: authMethods,
      revocation_endpoint_auth_methods_supported: authMethods,
      scopes_supported: [SCOPE],
    });
  });

  // ---- Dynamic client registration (RFC 7591) ----

  if (cfg.dcrPerHour > 0) {
    router.post("/oauth/register", express.json({ limit: "16kb" }), async (req, res) => {
      res.set("Cache-Control", "no-store");
      const fail = (error: string, description: string) => res.status(400).json({ error, error_description: description });
      // Keyed by the connecting address (behind the CDN, the edge location).
      if (!registrations.hit(req.ip ?? "unknown")) {
        return res.status(429).set("Retry-After", "3600").json({ error: "too_many_requests", error_description: "Too many registrations. Try again later." });
      }
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) return fail("invalid_client_metadata", "Send client metadata as a JSON object.");
      const uris = body.redirect_uris;
      if (!Array.isArray(uris) || !uris.length || uris.length > 10) return fail("invalid_redirect_uri", "Send 1 to 10 redirect_uris.");
      for (const uri of uris) {
        const problem = redirectUriProblem(uri);
        if (problem) return fail("invalid_redirect_uri", problem);
      }
      if (body.grant_types !== undefined && (!Array.isArray(body.grant_types) || body.grant_types.some((g: unknown) => g !== "authorization_code" && g !== "refresh_token"))) {
        return fail("invalid_client_metadata", "Supported grant_types: authorization_code, refresh_token.");
      }
      if (body.response_types !== undefined && (!Array.isArray(body.response_types) || body.response_types.some((t: unknown) => t !== "code"))) {
        return fail("invalid_client_metadata", "Supported response_types: code.");
      }
      // Every registered client is public (PKCE S256, no secret). A client that
      // asked for a secret method is told so in the response (RFC 7591 §3.2.1).
      const clientId = `dcr_${randomBytes(18).toString("base64url")}`;
      const name = cleanName(body.client_name);
      await db.query(`INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES ($1, $2, $3)`, [clientId, name || null, JSON.stringify(uris)]);
      res.status(201).json({
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        ...(name ? { client_name: name } : {}),
        redirect_uris: uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        scope: SCOPE,
      });
    });
  }

  // ---- Authorization endpoint ----

  /** Validates an authorization request. Returns an error message for the user, or the parsed request. */
  async function parseAuthorizeRequest(q: Record<string, unknown>): Promise<{ error: string } | { req: AuthorizeRequest; client: OAuthClient }> {
    const get = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : undefined);
    // Errors before the redirect URI is trusted are shown on the page, never redirected.
    const client = await resolveClient(get("client_id"));
    if (typeof client === "string") return { error: client };
    const redirectUri = get("redirect_uri");
    if (!redirectUri || !redirectAllowed(client.redirectUris, redirectUri)) return { error: "Redirect URI not registered." };
    const codeChallenge = get("code_challenge");
    const scope = get("scope") ?? SCOPE;
    const resource = get("resource");
    if (get("response_type") !== "code") return { error: "Only response_type=code is supported." };
    if (!codeChallenge || get("code_challenge_method") !== "S256") return { error: "PKCE with S256 is required." };
    if (resource && resource !== resourceUrl(cfg)) return { error: "Unknown resource." };
    if (scope.split(" ").some((s) => s !== SCOPE)) return { error: "Unsupported scope." };
    const req: AuthorizeRequest = { clientId: client.id, redirectUri, state: get("state"), codeChallenge, scope, resource };
    return { req, client };
  }

  const errorPage = (res: Response, status: number, message: string) =>
    res.status(status).type("html").send(page("Can't sign in", `<p>${esc(message)}</p>`));

  router.get("/oauth/authorize", async (req, res) => {
    const parsed = await parseAuthorizeRequest(req.query);
    if ("error" in parsed) return errorPage(res, 400, parsed.error);
    res.type("html").send(consentPage(req.query as Record<string, string>, parsed.client, methods, !!cfg.demoLoginPasscode));
  });

  /** Issues a single-use code and sends the browser back to the client. */
  async function finishAuthorization(res: Response, r: AuthorizeRequest, userId: string) {
    const code = newSecret();
    await db.query(
      `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8))`,
      [sha256(code), r.clientId, userId, r.redirectUri, r.codeChallenge, r.scope, r.resource ?? null, CODE_TTL_S],
    );
    redirectBack(res, r, { code });
  }

  function redirectBack(res: Response, r: AuthorizeRequest, params: Record<string, string>) {
    const to = new URL(r.redirectUri);
    for (const [k, v] of Object.entries(params)) to.searchParams.set(k, v);
    if (r.state) to.searchParams.set("state", r.state);
    to.searchParams.set("iss", cfg.publicBaseUrl); // RFC 9207
    res.redirect(302, to.toString());
  }

  router.post("/oauth/authorize", async (req, res) => {
    const parsed = await parseAuthorizeRequest(req.body);
    if ("error" in parsed) return errorPage(res, 400, parsed.error);
    const r = parsed.req;
    const method = req.body.method;

    if (method === "deny") return redirectBack(res, r, { error: "access_denied" });

    if (method === "amazon" && methods.includes("amazon")) {
      const state = newSecret();
      await db.query(`DELETE FROM oauth_pending WHERE expires_at < now()`);
      await db.query(
        `INSERT INTO oauth_pending (state_hash, request, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))`,
        [sha256(state), JSON.stringify(r), PENDING_TTL_S],
      );
      // The state is also kept in a cookie, so the callback only completes in the
      // browser that started it (no login CSRF).
      const secure = cfg.publicBaseUrl.startsWith("https:") ? "; Secure" : "";
      res.set("Set-Cookie", `pairup_lwa=${state}; Path=/oauth/amazon; Max-Age=${PENDING_TTL_S}; HttpOnly; SameSite=Lax${secure}`);
      const to = new URL(LWA.authorize);
      to.search = new URLSearchParams({
        client_id: cfg.lwaClientId, scope: "profile", response_type: "code", redirect_uri: amazonRedirectUri(cfg), state,
      }).toString();
      return res.redirect(302, to.toString());
    }

    if (method === "demo" && methods.includes("demo")) {
      const retry = (status: number, error: string) =>
        res.status(status).type("html").send(consentPage(req.body, parsed.client, methods, !!cfg.demoLoginPasscode, error));
      const name = String(req.body.display_name ?? "").trim().slice(0, 40);
      const passcode = String(req.body.passcode ?? "");
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      if (!slug) return retry(400, "Enter your name, using letters or numbers.");
      if (passcode.length < 6 || passcode.length > 200) return retry(400, "Use a passcode of at least 6 characters.");
      if (cfg.demoLoginPasscode && !safeEqual(String(req.body.event_code ?? ""), cfg.demoLoginPasscode)) return retry(401, "Wrong demo access code.");
      const userId = `u_${slug}`;
      if (passcodeFailures.blocked(userId)) return retry(429, "Too many wrong passcodes for this name. Try again in 15 minutes.");
      if (!(await checkPasscode(db, userId, name, passcode))) {
        passcodeFailures.hit(userId);
        return retry(401, "That name is taken and the passcode doesn't match. Use your own passcode, or pick another name.");
      }
      passcodeFailures.clear(userId);
      return finishAuthorization(res, r, userId);
    }

    return errorPage(res, 400, "Choose a way to sign in.");
  });

  // ---- Login with Amazon ----

  router.get("/oauth/amazon/callback", async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const cookie = readCookie(req, "pairup_lwa");
    res.set("Set-Cookie", "pairup_lwa=; Path=/oauth/amazon; Max-Age=0; HttpOnly; SameSite=Lax");
    if (!state || !cookie || !safeEqual(state, cookie)) return errorPage(res, 400, "This sign-in link has expired. Start again from the app.");
    const { rows } = await db.query<{ request: AuthorizeRequest; expired: boolean }>(
      `DELETE FROM oauth_pending WHERE state_hash = $1 RETURNING request, expires_at < now() AS expired`,
      [sha256(state)],
    );
    const pending = rows[0];
    if (!pending || pending.expired) return errorPage(res, 400, "This sign-in link has expired. Start again from the app.");
    const r = pending.request;
    if (typeof req.query.error === "string") return redirectBack(res, r, { error: "access_denied" });
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) return errorPage(res, 400, "Amazon didn't return a sign-in code.");

    let profile: { user_id?: unknown; name?: unknown };
    try {
      const tokenRes = await httpFetch(LWA.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code", code, redirect_uri: amazonRedirectUri(cfg),
          client_id: cfg.lwaClientId, client_secret: cfg.lwaClientSecret,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const tokens = (await tokenRes.json()) as { access_token?: unknown };
      if (!tokenRes.ok || typeof tokens.access_token !== "string") throw new Error(`LWA token HTTP ${tokenRes.status}`);
      const profileRes = await httpFetch(LWA.profile, {
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!profileRes.ok) throw new Error(`LWA profile HTTP ${profileRes.status}`);
      profile = (await profileRes.json()) as typeof profile;
    } catch {
      return errorPage(res, 502, "Couldn't sign in with Amazon. Please try again.");
    }
    const userId = typeof profile.user_id === "string" ? profile.user_id.trim() : "";
    if (!userId || userId.length > 128) return errorPage(res, 502, "Couldn't sign in with Amazon. Please try again.");
    // Others see this name on deals, so only the first name is used.
    const name = cleanName(profile.name).split(/\s+/)[0]?.slice(0, 40) || "Amazon customer";
    await ensureUser(db, userId, name);
    return finishAuthorization(res, r, userId);
  });

  // ---- Token endpoint ----

  /** Confidential clients must present their secret; public clients must not present one. */
  async function authenticateClient(req: Request) {
    const creds = clientCredentials(req);
    if (!creds) return null;
    const client = await resolveClient(creds.id, true);
    if (typeof client === "string") return null;
    const ok = client.secret
      ? creds.secret !== undefined && safeEqual(creds.secret, client.secret)
      : creds.secret === undefined;
    return ok ? client : null;
  }

  router.post("/oauth/token", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const fail = (status: number, error: string, description?: string) =>
      res.status(status).json({ error, ...(description ? { error_description: description } : {}) });

    const client = await authenticateClient(req);
    if (!client) return fail(401, "invalid_client");

    const grant = req.body.grant_type;
    if (grant === "authorization_code") {
      const { code, redirect_uri, code_verifier, resource } = req.body as Record<string, string | undefined>;
      if (!code || !code_verifier) return fail(400, "invalid_request");
      // Single use: delete and read in one statement.
      const { rows } = await db.query<{
        client_id: string; user_id: string; redirect_uri: string; code_challenge: string;
        scope: string; resource: string | null; expired: boolean;
      }>(
        `DELETE FROM oauth_codes WHERE code_hash = $1
         RETURNING client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at < now() AS expired`,
        [sha256(code)],
      );
      const c = rows[0];
      if (!c || c.expired || c.client_id !== client.id) return fail(400, "invalid_grant");
      if (redirect_uri !== c.redirect_uri) return fail(400, "invalid_grant", "redirect_uri mismatch");
      if (!safeEqual(pkceS256(code_verifier), c.code_challenge)) return fail(400, "invalid_grant", "PKCE verification failed");
      if (resource && resource !== resourceUrl(cfg)) return fail(400, "invalid_target");
      return res.json(await issueTokens(db, client.id, c.user_id, c.scope, newSecret()));
    }

    if (grant === "refresh_token") {
      const token = req.body.refresh_token as string | undefined;
      if (!token) return fail(400, "invalid_request");
      // Rotate: revoke the presented refresh token and issue a new pair in the same grant.
      const { rows } = await db.query<{ user_id: string; scope: string; grant_id: string | null }>(
        `UPDATE oauth_tokens SET revoked = TRUE
         WHERE token_hash = $1 AND kind = 'refresh' AND client_id = $2 AND NOT revoked AND expires_at > now()
         RETURNING user_id, scope, grant_id`,
        [sha256(token), client.id],
      );
      if (!rows[0]) return fail(400, "invalid_grant");
      return res.json(await issueTokens(db, client.id, rows[0].user_id, rows[0].scope, rows[0].grant_id ?? newSecret()));
    }

    return fail(400, "unsupported_grant_type");
  });

  // ---- Revocation (RFC 7009) ----

  router.post("/oauth/revoke", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const client = await authenticateClient(req);
    if (!client) return res.status(401).json({ error: "invalid_client" });
    const token = req.body.token;
    if (typeof token !== "string" || !token) return res.status(400).json({ error: "invalid_request" });
    // Only the client a token was issued to can revoke it. Unknown tokens get 200 too.
    const { rows } = await db.query<{ kind: string; grant_id: string | null }>(
      `SELECT kind, grant_id FROM oauth_tokens WHERE token_hash = $1 AND client_id = $2`,
      [sha256(token), client.id],
    );
    const t = rows[0];
    if (t?.kind === "refresh" && t.grant_id) {
      await db.query(`UPDATE oauth_tokens SET revoked = TRUE WHERE grant_id = $1`, [t.grant_id]);
    } else if (t) {
      await db.query(`UPDATE oauth_tokens SET revoked = TRUE WHERE token_hash = $1`, [sha256(token)]);
    }
    res.status(200).end();
  });

  return router;
}

/**
 * Demo sign-in: the first sign-in with a name sets its passcode; every later one
 * must match it. True when the passcode is right for this name.
 */
async function checkPasscode(db: Db, userId: string, name: string, passcode: string) {
  const salt = randomBytes(16);
  const hash = `${salt.toString("hex")}:${(await scryptAsync(passcode, salt, 32)).toString("hex")}`;
  await ensureUser(db, userId, name);
  await db.query(`INSERT INTO user_passcodes (user_id, passcode_hash) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [userId, hash]);
  const { rows } = await db.query<{ passcode_hash: string }>(`SELECT passcode_hash FROM user_passcodes WHERE user_id = $1`, [userId]);
  const [storedSalt, storedHash] = rows[0].passcode_hash.split(":");
  const candidate = await scryptAsync(passcode, Buffer.from(storedSalt, "hex"), 32);
  return timingSafeEqual(candidate, Buffer.from(storedHash, "hex"));
}

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

function clientCredentials(req: Request) {
  const basic = req.headers.authorization?.match(/^Basic\s+(\S+)$/i)?.[1];
  if (basic) {
    const decoded = Buffer.from(basic, "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i < 0) return null;
    return { id: decodeURIComponent(decoded.slice(0, i)), secret: decodeURIComponent(decoded.slice(i + 1)) };
  }
  const { client_id, client_secret } = req.body ?? {};
  if (typeof client_id !== "string") return null;
  return { id: client_id, secret: typeof client_secret === "string" ? client_secret : undefined };
}

async function issueTokens(db: Db, clientId: string, userId: string, scope: string, grantId: string) {
  const access = newSecret();
  const refresh = newSecret();
  await db.query(
    `INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, scope, expires_at, grant_id) VALUES
       ($1, 'access',  $3, $4, $5, now() + make_interval(secs => $6), $8),
       ($2, 'refresh', $3, $4, $5, now() + make_interval(secs => $7), $8)`,
    [sha256(access), sha256(refresh), clientId, userId, scope, ACCESS_TTL_S, REFRESH_TTL_S, grantId],
  );
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}

/** 401 for /mcp without a valid token, pointing clients at the resource metadata. */
export function sendUnauthorized(res: Response, cfg: Pick<Config, "publicBaseUrl">) {
  res
    .status(401)
    .set("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl(cfg)}", scope="${SCOPE}"`)
    .json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
}

// ---- HTML ----

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const OAUTH_FIELDS = ["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method", "scope", "resource"];

function consentPage(
  params: Record<string, string>,
  client: OAuthClient,
  methods: ("amazon" | "demo")[],
  needsEventCode: boolean,
  error?: string,
) {
  const hidden = OAUTH_FIELDS.filter((k) => params[k] != null)
    .map((k) => `<input type="hidden" name="${k}" value="${esc(params[k])}">`)
    .join("");
  const thirdParty = client.kind === "metadata" || client.kind === "registered";
  const title = client.kind === "alexa" ? "Link PairUp to Alexa"
    : thirdParty ? `Allow ${client.name} to use PairUp?`
    : "Sign in to PairUp";
  const intro = client.kind === "alexa" ? "<p>Sign in so Alexa can buy, sell and find help for you.</p>"
    : thirdParty ? consentDetails(client, params.redirect_uri)
    : "<p>Sign in to buy, sell and get help from people nearby, by voice.</p>";

  const amazon = methods.includes("amazon")
    ? `<form method="post" action="/oauth/authorize">${hidden}<button type="submit" name="method" value="amazon" class="amazon">Continue with Amazon</button></form>`
    : "";
  const demo = methods.includes("demo")
    ? `<form method="post" action="/oauth/authorize" class="demo">
         ${hidden}<input type="hidden" name="method" value="demo">
         <p class="badge">Demo sign-in for judges</p>
         <p class="muted">Pick a name and a passcode. The first sign-in with a name sets its passcode; use the same pair to get back to your posts and deals.</p>
         <label>Your name<input name="display_name" value="${esc(params.display_name)}" autocomplete="username" required maxlength="40"></label>
         <label>Passcode<input name="passcode" type="password" autocomplete="current-password" required minlength="6"></label>
         ${needsEventCode ? `<label>Demo access code<input name="event_code" type="password" required></label>` : ""}
         <button type="submit">Sign in to the demo</button>
       </form>`
    : "";
  const cancel = thirdParty
    ? `<form method="post" action="/oauth/authorize">${hidden}<button type="submit" name="method" value="deny" class="secondary">Cancel</button></form>`
    : "";
  return page(
    title,
    `${intro}
     ${error ? `<p class="err">${esc(error)}</p>` : ""}
     ${amazon}${demo}${cancel}
     <p class="muted">Your private price limits are never shown to other people.</p>`,
  );
}

function consentDetails(client: OAuthClient, redirectUri: string) {
  const identity = client.kind === "metadata"
    ? `Published by <strong>${esc(new URL(client.id).hostname)}</strong>`
    : "This app registered itself; its name is not verified";
  return `<p><strong>${esc(client.name)}</strong> wants to use your PairUp account.</p>
    <ul>
      <li>${identity}.</li>
      <li>After you sign in, you go back to <strong>${esc(new URL(redirectUri).host)}</strong>.</li>
      <li>It can post offers and requests for you, show your matches and deals, and confirm a deal when you say yes.</li>
    </ul>
    <p class="muted">Only continue if you started this from ${esc(client.name)}.</p>`;
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{--bg:#f7f7f5;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#e4e4df;--accent:#0a7cff;--amazon:#ffd814;--err:#c62828;--badge:#fff4d6}
  @media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ededea;--muted:#9a9a94;--card:#1e1e1c;--line:#2e2e2b;--accent:#4da3ff;--err:#ff6b6b;--badge:#3a3215}}
  body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
  main{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px;max-width:400px;width:100%;box-sizing:border-box}
  h1{font-size:20px;margin:0 0 8px} label{display:block;margin:14px 0 0;font-size:14px} ul{padding-left:20px} li{margin:4px 0}
  input{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
  button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
  button.amazon{background:var(--amazon);color:#0f1111} button.secondary{background:transparent;color:var(--fg);border:1px solid var(--line);margin-top:10px}
  .demo{margin-top:20px;padding-top:4px;border-top:1px solid var(--line)} .badge{display:inline-block;background:var(--badge);border-radius:6px;padding:2px 8px;font-size:13px;font-weight:600;margin:12px 0 0}
  .muted{color:var(--muted);font-size:13px} .err{color:var(--err)}
</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}
