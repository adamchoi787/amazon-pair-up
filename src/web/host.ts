import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Mcp } from "./mcp.js";

// MCP Apps host: renders a tool's ui:// view in a sandboxed iframe and bridges
// it to the MCP server. The iframe gets scripts only (no same-origin access,
// so it can't read this page's storage or tokens); every tool call it makes
// goes through onToolCall, so the app can speak results and refresh lists.

export interface ViewHandle {
  /** Push a newer result into an already rendered view. */
  update(result: CallToolResult): Promise<void>;
  remove(): void;
}

export function themeNow(): "light" | "dark" {
  const forced = document.documentElement.dataset.theme;
  if (forced === "light" || forced === "dark") return forced;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export async function renderView(
  mcp: Mcp,
  container: HTMLElement,
  uri: string,
  input: Record<string, unknown>,
  result: CallToolResult,
  onToolCall: (name: string, result: CallToolResult) => void,
  onResize?: () => void,
): Promise<ViewHandle> {
  const html = await mcp.view(uri);
  const frame = document.createElement("iframe");
  frame.className = "view";
  frame.title = "AmazonPairUp card";
  frame.setAttribute("sandbox", "allow-scripts allow-forms");
  frame.style.height = "0px";
  container.classList.add("loading");
  container.append(frame);

  const context = { theme: themeNow(), displayMode: "inline", platform: "web", locale: navigator.language } as const;
  const bridge = new AppBridge(null, { name: "AmazonPairUp", version: "1.0.0" }, { serverTools: {}, logging: {} }, { hostContext: context });
  bridge.oncalltool = async (params) => {
    const r = await mcp.call(params.name, (params.arguments ?? {}) as Record<string, unknown>);
    onToolCall(params.name, r);
    return r;
  };
  bridge.onsizechange = ({ height }) => {
    if (height) {
      frame.style.height = `${Math.ceil(height)}px`;
      container.classList.remove("loading");
    }
    onResize?.();
  };
  const ready = new Promise<void>((resolve) => {
    bridge.oninitialized = () => resolve();
  });

  await bridge.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
  frame.srcdoc = html;
  await ready;
  await bridge.sendToolInput({ arguments: input });
  await bridge.sendToolResult(result);

  const themeQuery = matchMedia("(prefers-color-scheme: dark)");
  const onTheme = () => bridge.setHostContext({ ...context, theme: themeNow() });
  themeQuery.addEventListener("change", onTheme);

  return {
    update: (r) => bridge.sendToolResult(r),
    remove: () => {
      themeQuery.removeEventListener("change", onTheme);
      void bridge.close().catch(() => undefined);
      frame.remove();
    },
  };
}
