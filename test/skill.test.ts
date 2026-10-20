import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.js";
import type { Deps } from "../src/market/service.js";

const dir = path.resolve("skills/pairup");
const skill = readFileSync(path.join(dir, "SKILL.md"), "utf8").replaceAll("\r\n", "\n");
test("PairUp skill conforms to Agent Skills frontmatter and file references", () => {
  const front = skill.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(front);
  const meta = parse(front[1]);
  assert.equal(meta.name, path.basename(dir));
  assert.match(meta.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/); assert.ok(meta.name.length <= 64);
  assert.equal(typeof meta.description, "string"); assert.ok(meta.description.length > 0 && meta.description.length <= 1024);
  const allowed = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
  assert.deepEqual(Object.keys(meta).filter((k) => !allowed.has(k)), []);
  for (const value of Object.values(meta.metadata ?? {})) assert.equal(typeof value, "string");
  if (meta.compatibility) assert.ok(typeof meta.compatibility === "string" && meta.compatibility.length <= 500);
  for (const m of skill.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(https?:|#)/.test(m[1])) continue;
    assert.ok(existsSync(path.resolve(dir, m[1].split("#")[0])), `resolves ${m[1]}`);
  }
});
test("the installed skill names every public MCP tool", async () => {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({} as Deps);
  const client = new Client({ name: "skill-audit", version: "1" });
  try {
    await server.connect(a); await client.connect(b);
    for (const t of (await client.listTools()).tools) assert.ok(skill.includes(`\`${t.name}\``), t.name);
  } finally { await client.close(); await server.close(); }
});
