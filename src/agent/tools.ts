import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Deps } from "../market/service.js";
import { createMcpServer } from "../mcp/server.js";

// The agent sees exactly the tools an MCP host such as Alexa+ sees: names,
// descriptions and input schemas come from this server's own tools/list.
// `user_id` is dropped because the web app's calls carry the signed-in user.

export interface ToolSpec {
  toolSpec: { name: string; description: string; inputSchema: { json: Record<string, unknown> } };
}

let cached: Promise<ToolSpec[]> | undefined;

export function toolSpecs(deps: Deps): Promise<ToolSpec[]> {
  cached ??= (async () => {
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await createMcpServer(deps).connect(serverSide);
    const client = new Client({ name: "voicemarket-agent", version: "1.0.0" });
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    await client.close();
    return tools.map((t) => {
      const schema = structuredClone(t.inputSchema) as { properties?: Record<string, unknown>; required?: string[] };
      delete schema.properties?.user_id;
      if (schema.required) schema.required = schema.required.filter((r) => r !== "user_id");
      return { toolSpec: { name: t.name, description: t.description ?? t.title ?? t.name, inputSchema: { json: schema } } };
    });
  })();
  return cached;
}
