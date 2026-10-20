import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Auth } from "./auth.js";

// The browser is a real MCP client: initialize, tools/list, tools/call and
// resources/read over Streamable HTTP, with the signed-in user's credentials.

export class Mcp {
  private client = new Client({ name: "pairup-web", version: "1.0.0" });
  private reconnecting: Promise<void> | null = null;
  private tools = new Map<string, Tool>();
  private views = new Map<string, Promise<string>>();

  constructor(private auth: Auth) {}

  async connect() {
    await this.client.connect(new StreamableHTTPClientTransport(new URL("/mcp", location.origin), { fetch: this.auth.fetch }));
    for (const t of (await this.client.listTools()).tools) this.tools.set(t.name, t);
  }

  /** Sessions expire or disappear on deployment. Reinitialize once, keeping
   * the original retry key on writes. Other HTTP errors remain visible. */
  private async request<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const previous = this.client;
    try { return await fn(previous); }
    catch (error) {
      if (!(error instanceof StreamableHTTPError) || error.code !== 404) throw error;
      if (!this.reconnecting && this.client === previous) {
        this.reconnecting = (async () => {
          await previous.close();
          this.client = new Client({ name: "pairup-web", version: "1.0.0" });
          this.tools.clear();
          await this.connect();
        })().finally(() => { this.reconnecting = null; });
      }
      await this.reconnecting;
      return fn(this.client);
    }
  }

  close() { return this.client.close(); }

  /** The MCP Apps view a tool declares, if any. */
  viewFor(toolName: string): string | undefined {
    const meta = this.tools.get(toolName)?._meta as { ui?: { resourceUri?: string }; "ui/resourceUri"?: string } | undefined;
    return meta?.ui?.resourceUri ?? meta?.["ui/resourceUri"];
  }

  async call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const writes = new Set(["post_offer", "post_request", "negotiate", "confirm_deal", "decline_deal", "withdraw_post", "choose_handoff", "choose_meetup_point", "check_in_at_point", "accept_suggestion", "dismiss_suggestion", "report_user", "rate_deal", "add_context", "delete_my_data"]);
    const input = writes.has(name) ? { idempotency_key: crypto.randomUUID(), ...args } : args;
    return this.request(async (client) => await client.callTool({ name, arguments: input }) as CallToolResult);
  }

  /** A view's HTML (resources/read), fetched once per page load. */
  view(uri: string): Promise<string> {
    if (!this.views.has(uri)) {
      this.views.set(uri, this.request((client) => client.readResource({ uri })).then((r) => {
        const c = r.contents[0] as { text?: string } | undefined;
        if (!c?.text) throw new Error(`empty view ${uri}`);
        return c.text;
      }).catch((error) => { this.views.delete(uri); throw error; }));
    }
    return this.views.get(uri)!;
  }
}

/** What a tool result says, for speaking and for the agent. */
export function resultData(r: CallToolResult): Record<string, unknown> {
  if (r.structuredContent) return r.structuredContent as Record<string, unknown>;
  const text = r.content?.find((c) => c.type === "text")?.text;
  try {
    return JSON.parse(text ?? "{}") as Record<string, unknown>;
  } catch {
    return { say: text ?? "" };
  }
}
