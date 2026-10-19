import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { oauthRouter, sendUnauthorized, userForAccessToken } from "./auth/oauth.js";
import type { Config } from "./config.js";
import { dashboard, type Deps } from "./market/service.js";
import { createMcpServer } from "./mcp/server.js";

// Streamable HTTP, stateless: a fresh McpServer +
// transport per request. Stateless suits Lambda / AgentCore / App Runner and
// needs no sticky sessions. Protocol version negotiated by the SDK (2025-11-25).

export function createApp(deps: Deps, cfg: Config) {
  const app = createMcpExpressApp({
    host: cfg.host,
    allowedHosts: cfg.allowedHosts.length ? cfg.allowedHosts : undefined,
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, ai: deps.ai.mode, auth: cfg.authMode });
  });

  if (cfg.authMode === "oauth") app.use(oauthRouter(deps.db, cfg));

  // One log line per MCP call, to watch the Alexa+ latency budget (< 500 ms round trip).
  app.use("/mcp", (req, res, next) => {
    const start = performance.now();
    res.on("finish", () => {
      const body = req.body as { method?: string; params?: { name?: string } } | undefined;
      const what = [body?.method, body?.params?.name].filter(Boolean).join(" ") || req.method;
      console.log(`[mcp] ${what} ${res.statusCode} ${Math.round(performance.now() - start)}ms`);
    });
    next();
  });

  // MCP spec 2025-11-25: servers must reject requests with an invalid Origin (DNS rebinding).
  // Alexa+ calls server-to-server without an Origin; browsers must be explicitly allowed.
  app.use("/mcp", (req, res, next) => {
    const origin = req.header("origin");
    if (origin && !cfg.allowedOrigins.includes(origin)) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Origin not allowed" }, id: null });
      return;
    }
    next();
  });

  app.post("/mcp", async (req, res) => {
    let userId: string | undefined;
    if (cfg.authMode === "oauth") {
      // Identity comes only from the linked account's access token.
      const linked = await userForAccessToken(deps.db, req.headers.authorization);
      if (!linked) {
        sendUnauthorized(res, cfg);
        return;
      }
      userId = linked;
    } else {
      if (cfg.mcpApiKey && req.headers.authorization !== `Bearer ${cfg.mcpApiKey}`) {
        res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
        return;
      }
      userId = req.header("x-user-id") || undefined; // local dev only
    }
    const server = createMcpServer(deps, { userId });
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

  // Stateless server: no standalone SSE stream or session teardown.
  const notAllowed: express.RequestHandler = (_req, res) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  // Live dashboard for the demo. Private limits are never included.
  app.get("/api/dashboard", async (_req, res) => {
    res.json(await dashboard(deps.db));
  });
  app.use(express.static("public"));

  return app;
}
