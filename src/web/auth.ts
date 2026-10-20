// Sign-in for the web app.
//   oauth: OAuth 2.1 authorization code + PKCE (S256) as a public client; the
//          access token is short-lived and the refresh token rotates on use.
//   none:  local development; the user picks a name, sent as X-User-Id.
// A device slot (the ?device= query parameter) keeps its own session, so one
// browser can run several signed-in devices side by side (the demo page).

export type AppConfig =
  | { auth: "oauth"; clientId: string; redirectUri: string; authorizeUrl: string; tokenUrl: string; resource: string }
  | { auth: "none" };

interface Tokens { access: string; refresh: string; expiresAt: number }
interface Session { name: string; tokens?: Tokens; userId?: string }

const store = {
  get<T>(k: string, s: Storage = localStorage): T | null {
    try { return JSON.parse(s.getItem(k) ?? "null") as T | null; } catch { return null; }
  },
  set(k: string, v: unknown, s: Storage = localStorage) {
    try { s.setItem(k, JSON.stringify(v)); } catch { /* private mode: session lasts for this page only */ }
  },
  del(k: string, s: Storage = localStorage) {
    try { s.removeItem(k); } catch { /* ignore */ }
  },
};

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export class Auth {
  private readonly key: string;
  private readonly pendingKey: string;
  private session: Session | null;
  private refreshing: Promise<boolean> | null = null;

  constructor(readonly config: AppConfig, readonly slot = "") {
    this.key = slot ? `pairup.session.${slot}` : "pairup.session";
    this.pendingKey = slot ? `pairup.pkce.${slot}` : "pairup.pkce";
    this.session = store.get<Session>(this.key);
  }

  /** The device slot an OAuth redirect comes back to: it rides in the state parameter. */
  static slotFromRedirect(): string | null {
    const state = new URLSearchParams(location.search).get("state");
    return state?.includes(".") ? state.split(".")[0] : null;
  }

  get signedIn() { return !!this.session && (this.config.auth === "none" ? !!this.session.userId : !!this.session.tokens); }
  get name() { return this.session?.name ?? ""; }

  /** Local development only. */
  signInLocally(name: string) {
    const clean = name.trim().slice(0, 40);
    const userId = `u_${clean.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
    this.session = { name: clean, userId };
    store.set(this.key, this.session);
  }

  /** OAuth: go to the sign-in page. */
  async startSignIn() {
    if (this.config.auth !== "oauth") return;
    const verifier = random(48);
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const state = this.slot ? `${this.slot}.${random(16)}` : random(16);
    store.set(this.pendingKey, { verifier, state }, sessionStorage);
    const url = new URL(this.config.authorizeUrl);
    url.search = new URLSearchParams({
      response_type: "code", client_id: this.config.clientId, redirect_uri: this.config.redirectUri,
      code_challenge: challenge, code_challenge_method: "S256", state, scope: "marketplace", resource: this.config.resource,
    }).toString();
    location.assign(url.toString());
  }

  /** OAuth: finish sign-in when the page loads with ?code=…&state=…. Returns an error message, if any. */
  async completeSignIn(): Promise<string | null> {
    if (this.config.auth !== "oauth") return null;
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (!code) return null;
    history.replaceState(null, "", this.slot ? `${location.pathname}?device=${encodeURIComponent(this.slot)}` : location.pathname);
    const pending = store.get<{ verifier: string; state: string }>(this.pendingKey, sessionStorage);
    store.del(this.pendingKey, sessionStorage);
    if (!pending || params.get("state") !== pending.state) return "Sign-in expired. Please try again.";
    const res = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: this.config.redirectUri,
        client_id: this.config.clientId, code_verifier: pending.verifier, resource: this.config.resource,
      }),
    });
    if (!res.ok) return "Sign-in failed. Please try again.";
    this.saveTokens(await res.json());
    return null;
  }

  private saveTokens(t: { access_token: string; refresh_token: string; expires_in: number }) {
    this.session = {
      name: this.session?.name ?? "",
      tokens: { access: t.access_token, refresh: t.refresh_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 },
    };
    store.set(this.key, this.session);
  }

  /** Remember the display name the server knows us by (OAuth gives us only tokens). */
  rememberName(name: string) {
    if (!this.session || !name || this.config.auth === "none") return;
    this.session.name = name;
    store.set(this.key, this.session);
  }

  private async refresh(): Promise<boolean> {
    const config = this.config;
    if (config.auth !== "oauth" || !this.session?.tokens) return false;
    this.refreshing ??= (async () => {
      const res = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.session!.tokens!.refresh, client_id: config.clientId }),
      }).catch(() => null);
      if (!res?.ok) {
        this.signOut();
        return false;
      }
      this.saveTokens(await res.json());
      return true;
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  /** Headers that identify the user, refreshing the access token first when it is about to expire. */
  async headers(): Promise<Record<string, string>> {
    if (this.config.auth === "none") {
      return this.session?.userId ? { "X-User-Id": this.session.userId, "X-User-Name": encodeURIComponent(this.session.name) } : {};
    }
    if (this.session?.tokens && Date.now() > this.session.tokens.expiresAt) await this.refresh();
    return this.session?.tokens ? { Authorization: `Bearer ${this.session.tokens.access}` } : {};
  }

  /** fetch() that carries the user's identity and retries once after a token refresh. */
  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const send = async () => {
      const headers = new Headers(init.headers);
      for (const [k, v] of Object.entries(await this.headers())) headers.set(k, v);
      return fetch(input, { ...init, headers });
    };
    const res = await send();
    if (res.status === 401 && (await this.refresh())) return send();
    return res;
  };

  signOut() {
    this.session = null;
    store.del(this.key);
  }
}
