import { existsSync, readFileSync, statSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RESOURCE_MIME_TYPE, registerAppResource } from "@modelcontextprotocol/ext-apps/server";

// MCP Apps views (ui:// resources). Hosts that support MCP Apps (Alexa+, the
// VoiceMarket web app, Claude, ChatGPT, VS Code…) render them inline next to
// the tool result; others use the structured data and the spoken 'say'.
// Source: src/apps/. Built single-file HTML: public/mcp-apps/ (npm run build:web).

// One view for every tool: it picks its layout (deal card, options carousel,
// deals list, posts list) from the shape of the result, so a host fetches it once.
export const VIEWS = {
  market: {
    uri: "ui://voicemarket/market.html",
    title: "VoiceMarket",
    description: "Offers with price, savings, counterpart and meet-up (Confirm / Decline), other options, the user's deals and posts.",
  },
} as const;

export type ViewName = keyof typeof VIEWS;

// Cached, and re-read when the built file changes (so a rebuild needs no restart).
const html = new Map<ViewName, { mtime: number; text: string }>();
function load(view: ViewName) {
  const file = new URL(`../../public/mcp-apps/${view}.html`, import.meta.url);
  if (!existsSync(file)) return `<!doctype html><meta charset="utf-8"><p>This view isn't built yet. Run <code>npm run build:web</code>.</p>`;
  const mtime = statSync(file).mtimeMs;
  const hit = html.get(view);
  if (hit?.mtime === mtime) return hit.text;
  const text = readFileSync(file, "utf8");
  html.set(view, { mtime, text });
  return text;
}

export function registerViews(server: McpServer) {
  for (const [name, view] of Object.entries(VIEWS) as [ViewName, (typeof VIEWS)[ViewName]][]) {
    registerAppResource(server, view.title, view.uri, { description: view.description }, async () => ({
      contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: load(name) }],
    }));
  }
}
