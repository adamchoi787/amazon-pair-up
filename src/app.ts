import { timingSafeEqual } from "node:crypto";
import compression from "compression";
import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { agentMode, handleAgentTurn } from "./agent/index.js";
import { oauthRouter, sendUnauthorized, userForAccessToken, WEB_CLIENT_ID, webRedirectUri } from "./auth/oauth.js";
import type { Config } from "./config.js";
import { rateLimit } from "./http/rateLimit.js";
import { dashboard, type Deps } from "./market/service.js";
import { createMcpServer } from "./mcp/server.js";

// HTTP surface:
//   /mcp            Streamable HTTP, stateless (a fresh McpServer + transport per
//                   request), protocol 2025-11-25. Alexa+ and the web app both call it.
//   /api/agent      one reasoning step for the web app's assistant (Bedrock tool use,
//                   or the offline planner); the web app runs the tools itself over /mcp
//   /app/           the AmazonPairUp web app
//   /dashboard/     operations view (see DASHBOARD_TOKEN)
// Stateless suits Lambda / AgentCore / App Runner and needs no sticky sessions.

/** Authenticated (with a user unless it's an anonymous local-dev call), or rejected. */
type Caller = { ok: true; userId?: string } | { ok: false };

export function createApp(deps: Deps, cfg: Config) {
  const app = createMcpExpressApp({
    host: cfg.host,
    allowedHosts: cfg.allowedHosts.length ? cfg.allowedHosts : undefined,
  });

  // Stateless MCP responses end once the result is written, so compressing them
  // only shrinks the transfer (the MCP Apps view is ~0.5 MB of HTML, ~4× smaller gzipped).
  app.use(compression({ threshold: 1024 }));

  if (cfg.originSecret) {
    app.use((req, res, next) => {
      if (req.path === "/health" || sameSecret(req.header("x-origin-verify") ?? "", cfg.originSecret)) return next();
      res.status(403).json({ error: "forbidden" });
    });
  }

  app.get("/health", (_req, res) => {
    res.json({ ok: true, ai: deps.ai.mode, auth: cfg.authMode, agent: agentMode(cfg) });
  });

  // What the web app needs to sign in: the auth mode and, with OAuth, its client.
  app.get("/api/app-config", (_req, res) => {
    res.json(
      cfg.authMode === "oauth"
        ? { auth: "oauth", clientId: WEB_CLIENT_ID, redirectUri: webRedirectUri(cfg), authorizeUrl: `${cfg.publicBaseUrl}/oauth/authorize`, tokenUrl: `${cfg.publicBaseUrl}/oauth/token`, resource: `${cfg.publicBaseUrl}/mcp` }
        : { auth: "none" },
    );
  });

  if (cfg.authMode === "oauth") app.use(oauthRouter(deps.db, cfg));

  /** Who is calling: the OAuth subject, or in local development the X-User-Id header. */
  async function caller(req: express.Request): Promise<Caller> {
    if (cfg.authMode === "oauth") {
      const linked = await userForAccessToken(deps.db, req.headers.authorization);
      return linked ? { ok: true, userId: linked } : { ok: false };
    }
    if (cfg.mcpApiKey && !sameSecret(req.headers.authorization ?? "", `Bearer ${cfg.mcpApiKey}`)) return { ok: false };
    return { ok: true, userId: req.header("x-user-id")?.trim().slice(0, 128) || undefined };
  }

  // MCP spec 2025-11-25: servers must reject requests with an invalid Origin (DNS rebinding).
  // Alexa+ calls server-to-server without an Origin. Browsers may call from this
  // server's own origin (the web app) or from ALLOWED_ORIGINS.
  const checkOrigin: express.RequestHandler = (req, res, next) => {
    const origin = req.header("origin");
    if (origin && !cfg.allowedOrigins.includes(origin) && !sameOrigin(origin, req.header("host"))) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Origin not allowed" }, id: null });
      return;
    }
    next();
  };

  // One log line per call, to watch the Alexa+ latency budget (< 500 ms round trip).
  const timing = (label: string): express.RequestHandler => (req, res, next) => {
    const start = performance.now();
    res.on("finish", () => {
      const body = req.body as { method?: string; params?: { name?: string } } | undefined;
      const what = [body?.method, body?.params?.name].filter(Boolean).join(" ") || req.method;
      console.log(`[${label}] ${what} ${res.statusCode} ${Math.round(performance.now() - start)}ms`);
    });
    next();
  };

  app.use("/mcp", timing("mcp"), checkOrigin, rateLimit(cfg.mcpCallsPerMinute));
  app.use("/api/agent", timing("agent"), checkOrigin, rateLimit(cfg.mcpCallsPerMinute));

  app.post("/mcp", async (req, res) => {
    const who = await caller(req);
    if (!who.ok) return unauthorized(res);
    // In local development a call without X-User-Id is allowed; tools then ask for user_id.
    const server = createMcpServer(deps, { userId: who.userId });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request failed", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
      }
    }
  });

  function unauthorized(res: express.Response) {
    if (cfg.authMode === "oauth") return sendUnauthorized(res, cfg);
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
  }

  // Stateless server: no standalone SSE stream or session teardown.
  const notAllowed: express.RequestHandler = (_req, res) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  // Who the web app is signed in as.
  app.get("/api/me", checkOrigin, async (req, res) => {
    const who = await caller(req);
    if (!who.ok || !who.userId) return unauthorized(res);
    // Local development has no sign-in page, so the app tells us the name it picked.
    const localName = cfg.authMode === "none" ? decodeName(req.header("x-user-name")) : undefined;
    if (localName) {
      await deps.db.query(
        `INSERT INTO users (id, display_name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [who.userId, localName],
      );
    }
    const { rows } = await deps.db.query<{ display_name: string }>(`SELECT display_name FROM users WHERE id = $1`, [who.userId]);
    res.set("Cache-Control", "no-store").json({ userId: who.userId, name: rows[0]?.display_name ?? who.userId });
  });

  app.post("/api/agent", async (req, res) => {
    const who = await caller(req);
    if (!who.ok || !who.userId) return unauthorized(res);
    try {
      const turn = await handleAgentTurn(deps, cfg, req.body);
      res.set("Cache-Control", "no-store").json(turn);
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      if (status >= 500) console.error("[agent] failed", err);
      res.status(status).json({ error: status >= 500 ? "The assistant is unavailable right now." : (err as Error).message });
    }
  });

  // Live operations dashboard: every post and deal, without private limits.
  // Open in local development (AUTH_MODE=none); otherwise it needs DASHBOARD_TOKEN
  // as a Bearer token, and it is off when no token is configured.
  app.get("/api/dashboard", async (req, res) => {
    if (cfg.authMode !== "none" || cfg.dashboardToken) {
      const given = req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
      if (!cfg.dashboardToken || !sameSecret(given, cfg.dashboardToken)) {
        res.status(cfg.dashboardToken ? 401 : 404).json({ error: cfg.dashboardToken ? "unauthorized" : "not found" });
        return;
      }
    }
    res.set("Cache-Control", "no-store").json(await dashboard(deps.db));
  });

  app.use("/app", (_req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
    next();
  });
  app.get("/", (_req, res) => res.redirect(302, "/app/"));
  app.use(express.static("public"));

  return app;
}

function decodeName(raw: string | undefined) {
  try {
    return raw ? decodeURIComponent(raw).trim().slice(0, 40) || undefined : undefined;
  } catch {
    return undefined;
  }
}

function sameOrigin(origin: string, host: string | undefined) {
  try {
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
