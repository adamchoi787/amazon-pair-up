import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { log } from "../http/log.js";
import type { RequestContext } from "./server.js";

// Streamable HTTP in two modes on one endpoint:
//   - Stateless (as before): a request without Mcp-Session-Id gets a fresh
//     server and transport that end with the response. Tool calls work this way
//     from any client, on any instance, across restarts.
//   - Stateful: an initialize request gets an Mcp-Session-Id. With it the client
//     can open the GET SSE stream, subscribe to deals://me and posts://me, and
//     answer elicitation requests during a tool call. Sessions live in this
//     process; an unknown or expired id gets 404 and the client initializes again.
// MCP_SESSIONS=off keeps every request stateless.

export interface SessionSettings {
  enabled: boolean;
  /** A session with no request and no open stream for this long is closed. */
  idleMinutes: number;
  /** Beyond this many, initialize is answered statelessly (no session id). */
  max: number;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  userId?: string;
  lastSeen: number;
  /** Open GET streams; a session with one is never idle. */
  streams: number;
}

type CreateServer = (ctx: RequestContext) => McpServer;

const notFound = { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null };

export class McpSessions {
  private sessions = new Map<string, Session>();
  private sweeper: NodeJS.Timeout;

  constructor(private create: CreateServer, private opts: SessionSettings) {
    this.sweeper = setInterval(() => void this.closeIdle(), 60_000);
    this.sweeper.unref();
  }

  get size() {
    return this.sessions.size;
  }

  /** POST /mcp. */
  async post(req: Request, res: Response, userId: string | undefined) {
    const id = req.header("mcp-session-id");
    if (id) return this.forward(id, req, res, userId);
    if (this.opts.enabled && this.sessions.size < this.opts.max && isInitializeRequest(req.body)) return this.open(req, res, userId);
    return this.stateless(req, res, userId);
  }

  /** GET /mcp (the SSE stream for notifications) and DELETE /mcp (end the session). Both need a session. */
  async session(req: Request, res: Response, userId: string | undefined) {
    const id = req.header("mcp-session-id");
    if (!id) {
      res.status(405).set("Allow", "POST").json({
        jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed without a session: initialize first" }, id: null,
      });
      return;
    }
    return this.forward(id, req, res, userId);
  }

  private async forward(id: string, req: Request, res: Response, userId: string | undefined) {
    const s = this.sessions.get(id);
    // A session belongs to the user who opened it; anyone else is told it doesn't exist.
    if (!s || s.userId !== userId) {
      res.status(404).json(notFound);
      return;
    }
    s.lastSeen = Date.now();
    if (req.method === "GET") {
      s.streams++;
      res.on("close", () => {
        s.streams--;
        s.lastSeen = Date.now();
      });
    }
    await s.transport.handleRequest(req, res, req.body);
  }

  private async open(req: Request, res: Response, userId: string | undefined) {
    const server = this.create({ userId });
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        this.sessions.set(id, { transport, server, userId, lastSeen: Date.now(), streams: 0 });
      },
    });
    // Set before connect: the server chains its own cleanup after this.
    transport.onclose = () => {
      if (transport.sessionId) this.sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  private async stateless(req: Request, res: Response, userId: string | undefined) {
    const server = this.create({ userId, stateless: true });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  private async closeIdle() {
    const cutoff = Date.now() - this.opts.idleMinutes * 60_000;
    for (const [id, s] of this.sessions) {
      if (s.streams === 0 && s.lastSeen < cutoff) await this.close(id);
    }
  }

  private async close(id: string) {
    const s = this.sessions.get(id);
    this.sessions.delete(id);
    try {
      await s?.server.close();
    } catch (err) {
      log("warn", "closing an MCP session failed", { err });
    }
  }

  /** On shutdown: end every session, which also ends their open streams. */
  async closeAll() {
    clearInterval(this.sweeper);
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }
}
