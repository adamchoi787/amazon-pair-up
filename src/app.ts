import express from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import { dashboard, type Deps } from "./market/service.js";
import { createMcpServer } from "./mcp/server.js";

// Owner: A (integration). Streamable HTTP, stateless: a fresh McpServer +
// transport per request. Stateless suits Lambda / AgentCore / App Runner and
// needs no sticky sessions. Protocol version negotiated by the SDK (2025-11-25).

export function createApp(deps: Deps, cfg: Config) {
  const app = createMcpExpressApp({
    host: cfg.host,
    allowedHosts: cfg.allowedHosts.length ? cfg.allowedHosts : undefined,
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, ai: deps.ai.mode });
  });

  app.post("/mcp", async (req, res) => {
    if (cfg.mcpApiKey && req.headers.authorization !== `Bearer ${cfg.mcpApiKey}`) {
      res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
      return;
    }
    // TODO(A): replace X-User-Id with the identity Alexa+ provides (account linking / OAuth subject).
    const userId = req.header("x-user-id") || undefined;
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

  // Judge/demo dashboard (owner: C). Private limits are never included.
  app.get("/api/dashboard", async (_req, res) => {
    res.json(await dashboard(deps.db));
  });
  app.use(express.static("public"));

  return app;
}
