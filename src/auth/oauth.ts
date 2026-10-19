import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { ensureUser } from "../market/service.js";

// Minimal OAuth 2.1 authorization server + protected
// resource metadata for Alexa+ account linking, following the Alexa+ MCP
// add-on checklist:
//   - RFC 9728 metadata at /.well-known/oauth-protected-resource
//   - RFC 8414 metadata at /.well-known/oauth-authorization-server (S256 listed)
//   - authorization code grant with PKCE S256, `resource` checked when sent
//   - a refresh token with every access token (rotated on use)
//   - bearer tokens only in the Authorization header
// Pre-registered clients, no dynamic registration:
//   - the AmazonPairUp web app: a public client (PKCE, no secret) whose only
//     redirect URI is this server's own /app/
//   - Alexa+ account linking: a confidential client, when OAUTH_CLIENT_ID,
//     OAUTH_CLIENT_SECRET and OAUTH_REDIRECT_URIS are set
// The sign-in page is a name-based login (plus an optional shared passcode).
// Swap in a real identity provider before running at scale.

export const SCOPE = "marketplace";
const CODE_TTL_S = 600;
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 24 * 3600;

type AuthConfig = Pick<
  Config,
  "publicBaseUrl" | "oauthClientId" | "oauthClientSecret" | "oauthRedirectUris" | "demoLoginPasscode"
>;

/** The AmazonPairUp web app's client id (public client, PKCE only). */
export const WEB_CLIENT_ID = "amazonpairup-web";

interface OAuthClient {
  id: string;
  /** Present for confidential clients only. */
  secret?: string;
  redirectUris: string[];
  /** Shown on the sign-in page. */
  purpose: "web" | "alexa";
}

export const webRedirectUri = (cfg: Pick<Config, "publicBaseUrl">) => `${cfg.publicBaseUrl}/app/`;

function registeredClients(cfg: AuthConfig): OAuthClient[] {
  const clients: OAuthClient[] = [{ id: WEB_CLIENT_ID, redirectUris: [webRedirectUri(cfg)], purpose: "web" }];
  if (cfg.oauthClientId && cfg.oauthClientSecret) {
    clients.push({ id: cfg.oauthClientId, secret: cfg.oauthClientSecret, redirectUris: cfg.oauthRedirectUris, purpose: "alexa" });
  }
  return clients;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newSecret = () => randomBytes(32).toString("base64url");
const pkceS256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const resourceUrl = (cfg: AuthConfig) => `${cfg.publicBaseUrl}/mcp`;
export const resourceMetadataUrl = (cfg: AuthConfig) => `${cfg.publicBaseUrl}/.well-known/oauth-protected-resource`;

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

export function oauthRouter(db: Db, cfg: AuthConfig): Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false }));
  const clients = registeredClients(cfg);
  const findClient = (id: string | undefined) => clients.find((c) => c.id === id);

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
    res.json({
      issuer: cfg.publicBaseUrl,
      authorization_endpoint: `${cfg.publicBaseUrl}/oauth/authorize`,
      token_endpoint: `${cfg.publicBaseUrl}/oauth/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
      scopes_supported: [SCOPE],
    });
  });

  // ---- Authorization endpoint ----

  /** Validates an authorization request. Returns an error message for the user, or the parsed request. */
  function parseAuthorizeRequest(q: Record<string, unknown>) {
    const get = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : undefined);
    const req = {
      clientId: get("client_id"),
      redirectUri: get("redirect_uri"),
      responseType: get("response_type"),
      state: get("state"),
      codeChallenge: get("code_challenge"),
      codeChallengeMethod: get("code_challenge_method"),
      scope: get("scope") ?? SCOPE,
      resource: get("resource"),
    };
    // Errors before the redirect URI is trusted are shown on the page, never redirected.
    const client = findClient(req.clientId);
    if (!client) return { error: "Unknown client." };
    if (!req.redirectUri || !client.redirectUris.includes(req.redirectUri)) return { error: "Redirect URI not registered." };
    if (req.responseType !== "code") return { error: "Only response_type=code is supported.", req };
    if (!req.codeChallenge || req.codeChallengeMethod !== "S256") return { error: "PKCE with S256 is required.", req };
    if (req.resource && req.resource !== resourceUrl(cfg)) return { error: "Unknown resource.", req };
    if (req.scope.split(" ").some((s) => s !== SCOPE)) return { error: "Unsupported scope.", req };
    return { req, client };
  }

  router.get("/oauth/authorize", (req, res) => {
    const parsed = parseAuthorizeRequest(req.query);
    if (parsed.error) {
      res.status(400).type("html").send(page("Can't link account", `<p>${esc(parsed.error)}</p>`));
      return;
    }
    res.type("html").send(signInPage(req.query as Record<string, string>, parsed.client!.purpose, !!cfg.demoLoginPasscode));
  });

  router.post("/oauth/authorize", async (req, res) => {
    const parsed = parseAuthorizeRequest(req.body);
    if (parsed.error || !parsed.req) {
      res.status(400).type("html").send(page("Can't link account", `<p>${esc(parsed.error ?? "Invalid request.")}</p>`));
      return;
    }
    const r = parsed.req;
    const purpose = parsed.client!.purpose;
    const name = String(req.body.display_name ?? "").trim().slice(0, 40);
    if (!name) {
      res.status(400).type("html").send(signInPage(req.body, purpose, !!cfg.demoLoginPasscode, "Enter your name."));
      return;
    }
    if (cfg.demoLoginPasscode && !safeEqual(String(req.body.passcode ?? ""), cfg.demoLoginPasscode)) {
      res.status(401).type("html").send(signInPage(req.body, purpose, true, "Wrong passcode."));
      return;
    }

    const userId = `u_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
    await ensureUser(db, userId, name);
    const code = newSecret();
    await db.query(
      `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + make_interval(secs => $8))`,
      [sha256(code), r.clientId, userId, r.redirectUri, r.codeChallenge, r.scope, r.resource ?? null, CODE_TTL_S],
    );
    const to = new URL(r.redirectUri!);
    to.searchParams.set("code", code);
    if (r.state) to.searchParams.set("state", r.state);
    res.redirect(302, to.toString());
  });

  // ---- Token endpoint ----

  router.post("/oauth/token", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const fail = (status: number, error: string, description?: string) =>
      res.status(status).json({ error, ...(description ? { error_description: description } : {}) });

    // Confidential clients must present their secret; public clients must not
    // present one (they are protected by PKCE and a same-origin redirect URI).
    const creds = clientCredentials(req);
    const client = findClient(creds?.id);
    if (!creds || !client) return fail(401, "invalid_client");
    const authenticated = client.secret
      ? creds.secret !== undefined && safeEqual(creds.secret, client.secret)
      : creds.secret === undefined;
    if (!authenticated) return fail(401, "invalid_client");

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
      return res.json(await issueTokens(db, client.id, c.user_id, c.scope));
    }

    if (grant === "refresh_token") {
      const token = req.body.refresh_token as string | undefined;
      if (!token) return fail(400, "invalid_request");
      // Rotate: revoke the presented refresh token and issue a new pair.
      const { rows } = await db.query<{ user_id: string; scope: string }>(
        `UPDATE oauth_tokens SET revoked = TRUE
         WHERE token_hash = $1 AND kind = 'refresh' AND client_id = $2 AND NOT revoked AND expires_at > now()
         RETURNING user_id, scope`,
        [sha256(token), client.id],
      );
      if (!rows[0]) return fail(400, "invalid_grant");
      return res.json(await issueTokens(db, client.id, rows[0].user_id, rows[0].scope));
    }

    return fail(400, "unsupported_grant_type");
  });

  return router;
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

async function issueTokens(db: Db, clientId: string, userId: string, scope: string) {
  const access = newSecret();
  const refresh = newSecret();
  await db.query(
    `INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, scope, expires_at) VALUES
       ($1, 'access',  $3, $4, $5, now() + make_interval(secs => $6)),
       ($2, 'refresh', $3, $4, $5, now() + make_interval(secs => $7))`,
    [sha256(access), sha256(refresh), clientId, userId, scope, ACCESS_TTL_S, REFRESH_TTL_S],
  );
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}

/** 401 for /mcp without a valid token, pointing clients at the resource metadata. */
export function sendUnauthorized(res: Response, cfg: AuthConfig) {
  res
    .status(401)
    .set("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl(cfg)}", scope="${SCOPE}"`)
    .json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
}

// ---- HTML ----

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const OAUTH_FIELDS = ["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method", "scope", "resource"];

function signInPage(params: Record<string, string>, purpose: OAuthClient["purpose"], needsPasscode: boolean, error?: string) {
  const hidden = OAUTH_FIELDS.filter((k) => params[k] != null)
    .map((k) => `<input type="hidden" name="${k}" value="${esc(params[k])}">`)
    .join("");
  const [title, intro, button] = purpose === "alexa"
    ? ["Link AmazonPairUp to Alexa", "Sign in so Alexa can buy and sell for you.", "Link account"]
    : ["Sign in to AmazonPairUp", "Sign in to buy and sell with people nearby, by voice.", "Sign in"];
  return page(
    title,
    `<p>${intro} Your private price limits are never shown to other people.</p>
     ${error ? `<p class="err">${esc(error)}</p>` : ""}
     <form method="post" action="/oauth/authorize">
       ${hidden}
       <label>Your name<input name="display_name" value="${esc(params.display_name)}" autocomplete="name" required maxlength="40"></label>
       ${needsPasscode ? `<label>Demo passcode<input name="passcode" type="password" required></label>` : ""}
       <button type="submit">${button}</button>
     </form>
     <p class="muted">Signing in with a name you choose. Use the same name to get back to your posts and deals.</p>`,
  );
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{--bg:#f7f7f5;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#e4e4df;--accent:#0a7cff;--err:#c62828}
  @media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ededea;--muted:#9a9a94;--card:#1e1e1c;--line:#2e2e2b;--accent:#4da3ff;--err:#ff6b6b}}
  body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
  main{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px;max-width:380px;width:100%}
  h1{font-size:20px;margin:0 0 8px} label{display:block;margin:14px 0 0;font-size:14px}
  input{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
  button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
  .muted{color:var(--muted);font-size:13px} .err{color:var(--err)}
</style></head><body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
}
