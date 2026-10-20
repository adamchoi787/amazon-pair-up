import { refreshSuggestions, showDevices } from "./lifestyle-ui.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Auth, type AppConfig } from "./auth.js";
import { renderView, themeNow, type ViewHandle } from "./host.js";
import { Mcp, resultData } from "./mcp.js";
import { canListen, canSpeak, listen, speak, stopSpeaking } from "./voice.js";

// AmazonPairUp web app. It is an MCP host, like Alexa+: it discovers the
// server's tools, runs them over Streamable HTTP with the user's credentials,
// and renders their MCP Apps views. The reasoning step (Bedrock tool use, or
// the offline planner) runs on the server at /api/agent.

type Block =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }
  | { toolResult: { toolUseId: string; content: { json: Record<string, unknown> }[]; status: "success" | "error" } };
interface Message { role: "user" | "assistant"; content: Block[] }
interface Turn { message: { role: "assistant"; content: Block[] }; stop: "tool_use" | "end_turn"; mode: "bedrock" | "offline" }
interface DealLite { deal_id: string; title: string; price: number; currency: string; status: string; waiting_for_you: boolean }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const WRITES = new Set(["post_offer", "post_request", "negotiate", "confirm_deal", "decline_deal", "withdraw_post", "accept_suggestion", "dismiss_suggestion", "report_user", "rate_deal"]);
const MAX_STEPS = 6;

let auth: Auth;
let mcp: Mcp;
const messages: Message[] = [];
let busy = false;
let voiceOn = readPref("voice", canSpeak);
const seenWaiting = new Set<string>();
let inboxPrimed = false;
const panels: Partial<Record<"deals" | "posts", ViewHandle>> = {};

// ---------- boot ----------

async function boot() {
  const config = (await (await fetch("/api/app-config")).json()) as AppConfig;
  auth = new Auth(config);
  const error = await auth.completeSignIn().catch(() => "Sign-in failed. Please try again.");
  if (!auth.signedIn) return showSignIn(error);
  await start();
}

function showSignIn(error: string | null) {
  $("signin").hidden = false;
  $("app").hidden = true;
  $("signin-error").textContent = error ?? "";
  const oauth = auth.config.auth === "oauth";
  $("signin-oauth").hidden = !oauth;
  $("signin-local").hidden = oauth;
  $("signin-oauth").onclick = () => void auth.startSignIn();
  $("signin-local").onsubmit = (e) => {
    e.preventDefault();
    const name = $<HTMLInputElement>("signin-name").value.trim();
    if (!name) return;
    auth.signInLocally(name);
    void start();
  };
}

async function start() {
  $("signin").hidden = true;
  $("app").hidden = false;
  mcp = new Mcp(auth);
  try {
    await mcp.connect();
  } catch {
    auth.signOut();
    return showSignIn("Please sign in again.");
  }
  const me = await auth.fetch("/api/me").then((r) => (r.ok ? r.json() : null)).catch(() => null) as { name?: string } | null;
  if (me?.name) auth.rememberName(me.name);
  $("who").textContent = auth.name;
  const health = await fetch("/health").then((r) => r.json()).catch(() => ({})) as { agent?: string };
  $("mode").textContent = health.agent === "bedrock" ? "Amazon Bedrock" : "Offline assistant";

  bindComposer();
  bindTabs();
  $("signout").onclick = () => { auth.signOut(); location.replace("/app/"); };
  updateVoiceToggle();
  $("voice").onclick = () => { voiceOn = !voiceOn; writePref("voice", voiceOn); if (!voiceOn) stopSpeaking(); updateVoiceToggle(); };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => (document.documentElement.dataset.scheme = themeNow()));

  greet();
  await refreshInbox();
  await refreshSuggestions(mcp);
  setInterval(() => { if (document.visibilityState === "visible") void refreshInbox(); }, 20_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refreshInbox(); });
}

// ---------- conversation ----------

function greet() {
  const first = auth.name ? auth.name.split(" ")[0] : "";
  addBubble("assistant", `Hi${first ? ` ${first}` : ""}! Tell me what you need, what you're selling or what you can do for people, and I'll pair you with someone nearby.`);
  const chips = $("suggestions");
  chips.replaceChildren();
  for (const s of [
    "Sell my TI-84 for $20, I'll take anything above $15",
    "I need a graphing calculator today, max $18",
    "Find someone to pick up my lunch from LG7 canteen to Hall 5 by 12:30, $5",
    "Get me a helper for the event on Saturday 2-6pm, budget $10/hr",
    "Any news on my deals?",
  ]) {
    const b = el("button", "chip", s);
    b.type = "button";
    b.onclick = () => void ask(s);
    chips.append(b);
  }
}

function addBubble(role: "user" | "assistant" | "note", text: string, parent: HTMLElement = $("log")) {
  const b = el("div", `bubble ${role}`, text);
  parent.append(b);
  scrollDown();
  return b;
}

function scrollDown() {
  const log = $("log");
  requestAnimationFrame(() => log.scrollTo({ top: log.scrollHeight, behavior: "smooth" }));
}

async function ask(text: string) {
  text = text.trim();
  if (!text || busy) return;
  if ($("panel-assistant").hidden) void openTab("assistant");
  busy = true;
  setBusy(true);
  stopSpeaking();
  $("suggestions").replaceChildren();
  addBubble("user", text);
  const turnEl = el("div", "turn");
  $("log").append(turnEl);
  const reply = addBubble("assistant", "…", turnEl);
  reply.classList.add("pending");
  messages.push({ role: "user", content: [{ text }] });

  let finalText = "";
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await auth.fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: recent(messages) }),
      });
      if (!res.ok) throw new Error(res.status === 401 ? "signed-out" : "agent");
      const turn = (await res.json()) as Turn;
      messages.push(turn.message);
      const texts = turn.message.content.flatMap((b) => ("text" in b ? [b.text] : []));
      const uses = turn.message.content.flatMap((b) => ("toolUse" in b ? [b.toolUse] : []));
      if (turn.stop === "end_turn" || !uses.length) {
        finalText = texts.join(" ");
        break;
      }
      const results: Block[] = [];
      for (const use of uses) {
        const r = await mcp.call(use.name, use.input).catch(() => errorResult("That didn't go through. Please try again."));
        markSeen(r);
        const uri = mcp.viewFor(use.name);
        if (uri && !r.isError) await addView(turnEl, uri, use.input, r);
        results.push({ toolResult: { toolUseId: use.toolUseId, content: [{ json: resultData(r) }], status: r.isError ? "error" : "success" } });
        if (WRITES.has(use.name)) void refreshInbox();
      }
      messages.push({ role: "user", content: results });
    }
    if (!finalText) finalText = "Done.";
  } catch (err) {
    if ((err as Error).message === "signed-out") {
      auth.signOut();
      return showSignIn("Your session ended. Please sign in again.");
    }
    finalText = "Sorry, I couldn't reach the assistant. Please try again in a moment.";
    // Keep the history valid: drop the unanswered turn.
    while (messages.length && messages[messages.length - 1].role === "user") messages.pop();
  } finally {
    busy = false;
    setBusy(false);
  }
  reply.textContent = finalText;
  reply.classList.remove("pending");
  turnEl.prepend(reply);
  if (voiceOn) speak(finalText);
  scrollDown();
}

/** The last stretch of conversation, starting at something the user said. */
function recent(all: Message[]) {
  if (all.length <= 24) return all;
  let i = all.length - 24;
  while (i < all.length && !(all[i].role === "user" && all[i].content.some((b) => "text" in b))) i++;
  return all.slice(i);
}

function errorResult(say: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ say }) }] };
}

async function addView(parent: HTMLElement, uri: string, input: Record<string, unknown>, result: CallToolResult) {
  const box = el("div", "card-slot");
  parent.append(box);
  try {
    return await renderView(mcp, box, uri, input, result, onCardAction, scrollDown);
  } catch {
    box.remove();
    return undefined;
  } finally {
    scrollDown();
  }
}

/** Offers that appear in this conversation are already in front of the user. */
function markSeen(r: CallToolResult) {
  const data = resultData(r) as { deal?: { deal_id?: string } | null; next_deal?: { deal_id?: string } | null };
  for (const d of [data.deal, data.next_deal]) if (d?.deal_id) seenWaiting.add(d.deal_id);
}

/** A button inside a card called a tool: say the result and refresh what changed. */
function onCardAction(name: string, r: CallToolResult) {
  markSeen(r);
  const say = String(resultData(r).say ?? "");
  if (voiceOn && say) speak(say);
  if (WRITES.has(name)) { void refreshInbox(); void refreshSuggestions(mcp); }
}

// ---------- inbox: offers that arrive while you're away ----------

async function refreshInbox() {
  const r = await mcp.call("get_deal_status", {}).catch(() => null);
  if (!r || r.isError) return;
  const deals = ((resultData(r).deals as DealLite[] | undefined) ?? []);
  const waiting = deals.filter((d) => d.status === "proposed" && d.waiting_for_you);
  const badge = $("deals-badge");
  badge.textContent = String(waiting.length);
  badge.hidden = waiting.length === 0;

  const fresh = waiting.filter((d) => !seenWaiting.has(d.deal_id));
  for (const d of waiting) seenWaiting.add(d.deal_id);
  if (fresh.length && (inboxPrimed || !messages.length)) announce(fresh, inboxPrimed);
  inboxPrimed = true;
  if (panels.deals) await panels.deals.update(r);
}

function announce(fresh: DealLite[], arrivedNow: boolean) {
  if (busy) return;
  const d = fresh[0];
  const price = new Intl.NumberFormat(undefined, { style: "currency", currency: d.currency, maximumFractionDigits: Number.isInteger(d.price) ? 0 : 2 }).format(d.price);
  const text = fresh.length === 1
    ? `${arrivedNow ? "New offer" : "Waiting for your yes"}: ${d.title} for ${price}.`
    : `${fresh.length} offers are waiting for your yes.`;
  const turnEl = el("div", "turn");
  $("log").append(turnEl);
  addBubble("assistant", text, turnEl);
  const uri = mcp.viewFor("get_deal_status");
  if (uri) {
    void mcp.call("get_deal_status", fresh.length === 1 ? { deal_id: d.deal_id } : {}).then((r) => {
      if (!r.isError) void addView(turnEl, fresh.length === 1 ? mcp.viewFor("confirm_deal") ?? uri : uri, {}, fresh.length === 1 ? asDealResult(r) : r);
    });
  }
  if (arrivedNow && voiceOn && document.visibilityState === "visible") speak(text);
}

/** Show a single deal from get_deal_status in the deal card. */
function asDealResult(r: CallToolResult): CallToolResult {
  const data = resultData(r) as { deals?: unknown[]; say?: string };
  const structured = { deal: data.deals?.[0] ?? null, say: data.say ?? "" };
  return { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured };
}

// ---------- tabs: assistant, deals, posts ----------

function bindTabs() {
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    tab.onclick = () => void openTab(tab.dataset.tab as "assistant" | "deals" | "posts" | "devices");
  }
}

async function openTab(name: "assistant" | "deals" | "posts" | "devices") {
  for (const t of document.querySelectorAll<HTMLButtonElement>("[data-tab]")) t.setAttribute("aria-selected", String(t.dataset.tab === name));
  for (const p of ["assistant", "deals", "posts", "devices"]) $(`panel-${p}`).hidden = p !== name;
  if (name === "assistant") return;
  if (name === "devices") return showDevices(auth);
  const tool = name === "deals" ? "get_deal_status" : "list_my_posts";
  const r = await mcp.call(tool, {});
  if (panels[name]) return panels[name]!.update(r);
  const uri = mcp.viewFor(tool);
  const box = $(`panel-${name}`);
  box.replaceChildren();
  if (uri) panels[name] = await renderView(mcp, box, uri, {}, r, (toolName, res) => {
    onCardAction(toolName, res);
    void mcp.call(tool, {}).then((fresh) => panels[name]?.update(fresh));
  });
}

// ---------- composer: talk or type ----------

function bindComposer() {
  const form = $<HTMLFormElement>("composer");
  const input = $<HTMLInputElement>("text");
  const mic = $<HTMLButtonElement>("mic");
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = "";
    void ask(text);
  };
  mic.hidden = !canListen;
  let session: ReturnType<typeof listen> | null = null;
  mic.onclick = async () => {
    if (session) return session.stop();
    if (busy) return;
    stopSpeaking();
    mic.classList.add("listening");
    mic.setAttribute("aria-label", "Stop listening");
    session = listen((partial) => (input.value = partial));
    try {
      const heard = await session.done;
      input.value = "";
      if (heard) await ask(heard);
    } catch {
      addBubble("note", "I couldn't use the microphone. You can type instead.");
    } finally {
      session = null;
      mic.classList.remove("listening");
      mic.setAttribute("aria-label", "Talk");
    }
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") stopSpeaking();
  });
}

function setBusy(on: boolean) {
  $("composer").classList.toggle("busy", on);
  $<HTMLButtonElement>("send").disabled = on;
}

function updateVoiceToggle() {
  const b = $<HTMLButtonElement>("voice");
  b.hidden = !canSpeak;
  b.setAttribute("aria-pressed", String(voiceOn));
  b.textContent = voiceOn ? "Voice on" : "Voice off";
}

function readPref(k: string, d: boolean) {
  try {
    const v = localStorage.getItem(`amazonpairup.${k}`);
    return v == null ? d : v === "1";
  } catch {
    return d;
  }
}
function writePref(k: string, v: boolean) {
  try { localStorage.setItem(`amazonpairup.${k}`, v ? "1" : "0"); } catch { /* not stored */ }
}

void boot();
