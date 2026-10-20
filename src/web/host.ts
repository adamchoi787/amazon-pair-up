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
  frame.title = "PairUp card";
  frame.setAttribute("sandbox", "allow-scripts allow-forms");
  frame.style.height = "0px";
  container.classList.add("loading");
  container.append(frame);

  const context = { theme: themeNow(), displayMode: "inline", platform: "web", locale: navigator.language } as const;
  const bridge = new AppBridge(null, { name: "PairUp", version: "1.0.0" }, { serverTools: {}, logging: {}, openLinks: {} }, { hostContext: context });
  bridge.oncalltool = async (params) => {
    const r = await mcp.call(params.name, (params.arguments ?? {}) as Record<string, unknown>);
    onToolCall(params.name, r);
    return r;
  };
  // The view links only to Amazon (search fallback, Trade-In); anything else is refused.
  bridge.onopenlink = async ({ url }) => {
    const ok = URL.canParse(url) && new URL(url).protocol === "https:" && new URL(url).hostname === "www.amazon.com";
    if (ok) window.open(url, "_blank", "noopener,noreferrer");
    return ok ? {} : { isError: true };
  };
  bridge.onsizechange = ({ height }) => {
    if (height) {
      frame.style.height = `${Math.ceil(height)}px`;
      container.classList.remove("loading");
      // The first real size replaces the skeleton, and the card rises in.
      for (const s of container.querySelectorAll(":scope > .skeleton")) s.remove();
      frame.classList.add("ready");
    }
    onResize?.();
  };
  let readyTimer: ReturnType<typeof setTimeout>;
  const ready = new Promise<void>((resolve, reject) => {
    bridge.oninitialized = () => resolve();
    readyTimer = setTimeout(() => reject(new Error("The offer card did not load")), 8_000);
  });

  try {
  await bridge.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
  frame.srcdoc = html;
  await ready;
  await bridge.sendToolInput({ arguments: input });
  await bridge.sendToolResult(result);
  } catch (error) {
    void bridge.close().catch(() => undefined);
    frame.remove();
    for (const s of container.querySelectorAll(":scope > .skeleton")) s.remove();
    throw error;
  } finally { clearTimeout(readyTimer!); }

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
