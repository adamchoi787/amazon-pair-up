import { randomUUID } from "node:crypto";
import {
  isText, isToolResult, isToolUse, lastUserText, isExplicitYes,
  type AgentMessage, type Block, type ToolResultBlock,
} from "./types.js";

// Deterministic assistant for running without AWS. Same contract as the Bedrock
// step: look at the conversation, then either request MCP tool calls or reply.
// It understands the core voice flows: selling an item, offering a service,
// asking for an item or for help, yes/no on an offer, more options, news,
// listing and withdrawing posts, and short follow-ups when a price or budget
// was missing.

type Json = Record<string, unknown>;
type Step = { content: Block[]; stop: "tool_use" | "end_turn" };

const reply = (text: string): Step => ({ content: [{ text }], stop: "end_turn" });
const call = (name: string, input: Json, text?: string): Step => ({
  content: [...(text ? [{ text }] : []), { toolUse: { toolUseId: `t_${randomUUID().slice(0, 12)}`, name, input } }],
  stop: "tool_use",
});

/** Several read-only tools in one step; their spoken lines are joined. */
const callAll = (names: string[]): Step => ({
  content: names.map((name) => ({ toolUse: { toolUseId: `t_${randomUUID().slice(0, 12)}`, name, input: {} } })),
  stop: "tool_use",
});

const HELP =
  "You can say things like: sell my TI-84 for 20 dollars, I'll take anything above 15. Or: I need a graphing calculator, maximum 18 dollars. " +
  "Or: find someone to pick up my lunch from LG7 to Hall 5 by 12:30, 5 dollars. Or: I can do lunch runs on campus for 4 dollars a run.";

const MONEY = String.raw`(?:hk)?\$?\s*(\d+(?:\.\d{1,2})?)`;
const MIN = String.raw`\b(?:above|over|at least|down to|as low as|minimum(?: of)?|min|no less than|lowest(?: is)?)\s+(?:of\s+)?${MONEY}`;
const HOURLY = /\/\s*h(?:ou)?r\b|\bper hour\b|\ban hour\b|\bhourly\b/i;
const PLACE = /\b(?:on|at|near|around)\s+((?:[A-Z][\w-]*\s)?campus|[\w-]+(?:\s[\w-]+)?\s(?:campus|station|library|hall))\b/i;
const amount = (re: RegExp, text: string) => {
  const m = text.match(re);
  return m ? Number(m[1]) : undefined;
};
const anyAmount = (text: string) => amount(new RegExp(MONEY, "i"), text);
// "iPhone" and "eBook" keep their own casing.
const capitalize = (s: string) => (/^[a-z][A-Z]/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1));

const CONDITIONS: [RegExp, string][] = [
  [/\bbrand[- ]new\b|\bsealed\b|\bunopened\b/i, "new"],
  [/\blike[- ]new\b|\bmint\b/i, "like_new"],
  [/\bgood condition\b|\bworks (perfectly|fine|great)\b/i, "good"],
  [/\b(fair|worn|scratched)\b/i, "fair"],
  [/\bfor parts\b|\bbroken\b/i, "for_parts"],
];

/** One planning step. */
export function planOffline(messages: AgentMessage[]): Step {
  const last = messages[messages.length - 1];
  const results = last.content.filter(isToolResult);
  return results.length ? afterTools(messages, results) : onUtterance(messages, lastUserText(messages).trim());
}

// ---------- after tool results ----------

function afterTools(messages: AgentMessage[], results: ToolResultBlock[]): Step {
  const r = results[results.length - 1].toolResult;
  const data = resultJson(r);
  const tool = toolNameFor(messages, r.toolUseId);

  if (tool === "list_my_posts" && r.status !== "error" && WITHDRAW.test(lastUserText(messages))) {
    const post = pickPost(lastUserText(messages), data);
    if (post) return call("withdraw_post", { post_id: post.id });
    return reply(`Which one should I take down? ${String(data.say ?? "")}`);
  }
  if (results.length > 1) return reply(spokenLines(messages, results) || "Done.");
  return reply(String(data.say ?? "Done."));
}

/** Each result's 'say', leaving out "nothing to suggest" when something else was said. */
export function spokenLines(messages: AgentMessage[], results: ToolResultBlock[]) {
  const lines = results.map((b) => ({ tool: toolNameFor(messages, b.toolResult.toolUseId), data: resultJson(b.toolResult) }));
  const said = lines.filter((l) => !(l.tool === "get_suggestions" && Array.isArray(l.data.suggestions) && !l.data.suggestions.length));
  return (said.length ? said : lines).map((l) => String(l.data.say ?? "")).filter(Boolean).join(" ");
}

// ---------- on the user's words ----------

const DECLINE = /^\s*(no|nope|nah|decline|pass|not (that|this)( one)?|cancel (it|that|the deal))\b/i;
export const WITHDRAW = /\b(take down|remove|withdraw|delete|cancel)\b.*\b(listing|offer|request|post|my|the)\b/i;
const MY_POSTS = /\b(what am i (selling|offering|looking for)|my (listings|offers|posts|requests|items)|what (have|did) i (list|post|offer)(ed)?)\b/i;
const STATUS = /\b(news|status|my (deals?|jobs?)|any (offers|deals|buyers|sellers|jobs|updates)|meet-?up|did (anyone|someone|anybody)|has (anyone|anybody)|who (bought|is buying)|inbox|what'?s new)\b/i;
const SUGGEST = /\b(anything i (need|should get)|what do you suggest|any (suggestions|ideas)|suggest something|what might i need|for me today)\b/i;
const ROUTINES = /\b(what do you know about me|my (routines|habits)|what have you (learned|noticed))\b/i;
const FORGET = /\b(forget (it|that|this)|don'?t (suggest|ask) (that|this|it) again|never suggest|stop suggesting)\b/i;
const MORE = /\b((more|other) (options|ones|choices)|what else|anything else|show me (more|others|alternatives)|alternatives)\b/i;
const SELL = /\b(sell|selling|list my|get rid of)\b/i;
// "I can do lunch runs on campus", "I'm free on Saturday to help at events"
const OFFER = /\b(?:i can|i could|i'?m (?:available|free|happy)\b.*?\bto|i offer|offering)\s+\S/i;
const BUY = /\b(need|want|looking for|buy|find( me)?|get me|hire|book|is anyone selling|does anyone have)\b/i;

function onUtterance(messages: AgentMessage[], text: string): Step {
  if (!text) return reply(HELP);

  // Follow-ups to a question the assistant just asked.
  const asked = previousAssistantText(messages);
  const askedPrice = asked.match(/How much do you want for "(.+)"\?/);
  if (askedPrice && anyAmount(text) !== undefined) return sell(`sell my ${askedPrice[1]} for $${anyAmount(text)}. ${text}`);
  const askedRate = asked.match(/How much do you charge for "(.+)"\?/);
  if (askedRate && anyAmount(text) !== undefined) return offerService(`I can do ${askedRate[1]} for $${anyAmount(text)}. ${text}`);
  const budgetFor = pendingBudgetRequest(messages);
  if (budgetFor && anyAmount(text) !== undefined && !SELL.test(text)) {
    return call("post_request", { raw_request: budgetFor, max_price: anyAmount(text) });
  }

  // The price check asked "is $1 right?": a yes posts it anyway, a number replaces it.
  const check = pendingPriceCheck(messages);
  if (check) {
    const corrected = anyAmount(text);
    if (corrected !== undefined) {
      return call(check.tool, { ...check.input, [check.field]: corrected, confirm_price: undefined });
    }
    if (isExplicitYes(text)) return call(check.tool, { ...check.input, confirm_price: true });
    if (DECLINE.test(text)) return reply("Okay, I've left it. Tell me the price whenever you're ready.");
  }

  // "The seller can't go that low. It's $20. Want it at that price?": a yes buys at the asking price.
  const atAsk = pendingAskingPrice(messages);
  if (atAsk && isExplicitYes(text)) return call("negotiate", atAsk);
  if (atAsk && DECLINE.test(text)) return reply("Okay. I'll keep looking.");

  // "Want me to ask now?" after a suggestion: yes posts it, a number sets the budget, no or forget skips it.
  const suggestion = pendingSuggestion(messages);
  if (suggestion) {
    const budget = anyAmount(text);
    if (FORGET.test(text)) return call("dismiss_suggestion", { suggestion_id: suggestion.id, forget: true });
    if (DECLINE.test(text)) return call("dismiss_suggestion", { suggestion_id: suggestion.id });
    if (budget !== undefined && !SELL.test(text)) return call("accept_suggestion", { suggestion_id: suggestion.id, max_price: budget });
    if (isExplicitYes(text)) {
      return suggestion.needsBudget ? reply("Sure. What's the most you'd pay? I keep that private.") : call("accept_suggestion", { suggestion_id: suggestion.id });
    }
  }
  if (ROUTINES.test(text)) return call("get_my_routines", {});
  if (SUGGEST.test(text)) return call("get_suggestions", {});

  if (DECLINE.test(text)) {
    const deal = latestOpenDeal(messages, false);
    return deal ? call("decline_deal", { deal_id: deal }) : reply("Okay. What would you like to do instead?");
  }
  if (isExplicitYes(text)) {
    const deal = latestOpenDeal(messages, true);
    return deal ? call("confirm_deal", { deal_id: deal }) : call("get_deal_status", {});
  }
  if (WITHDRAW.test(text) || MY_POSTS.test(text)) return call("list_my_posts", {});
  // "Any news?" also checks what the user may need.
  if (STATUS.test(text)) return callAll(["get_deal_status", "get_suggestions"]);
  if (MORE.test(text)) {
    const request = latestRequest(messages);
    return request ? call("find_matches", { request_id: request, limit: 4 }) : reply("What are you looking for?");
  }
  if (SELL.test(text)) return sell(text);
  if (OFFER.test(text)) return offerService(text);
  if (BUY.test(text)) return call("post_request", { raw_request: text });
  return reply(HELP);
}

function sell(text: string): Step {
  const title = text
    .match(new RegExp(String.raw`\b(?:sell(?:ing)?|list|get rid of)\s+(?:(?:my|a|an|the|some|this|these|our)\s+)?(.+?)(?=\s+for\s+${MONEY}|\s*[,.;!?]|\s+(?:i'?ll|i will|anything|at least|minimum)\b|$)`, "i"))?.[1]
    ?.trim();
  if (!title) return reply("What would you like to sell?");
  const ask = amount(new RegExp(String.raw`\bfor\s+${MONEY}`, "i"), text);
  if (ask === undefined) return reply(`How much do you want for "${title}"?`);
  const min = amount(new RegExp(MIN, "i"), text);
  const location = text.match(PLACE)?.[1];
  const condition = CONDITIONS.find(([re]) => re.test(text))?.[1];
  return call("post_offer", {
    title: capitalize(title),
    ask_price: ask,
    ...(min !== undefined && min <= ask ? { min_price: min } : {}),
    ...(location ? { location } : {}),
    ...(condition ? { condition } : {}),
  });
}

/** "I can do lunch runs around campus for $4 a run, at least $3." */
function offerService(text: string): Step {
  const task = text
    .match(new RegExp(String.raw`\b(?:i can|i could|i'?m (?:available|free|happy)\b.*?\bto|i offer|offering(?: to)?)\s+(?:do\s+)?(.+?)(?=\s+for\s+${MONEY}|\s*[,.;!?]|\s+(?:at least|minimum|min)\b|$)`, "i"))?.[1]
    ?.trim();
  if (!task) return reply("What can you do for people?");
  const ask = amount(new RegExp(String.raw`\bfor\s+${MONEY}`, "i"), text) ?? anyAmount(text);
  if (ask === undefined) return reply(`How much do you charge for "${task}"?`);
  const min = amount(new RegExp(MIN, "i"), text);
  const location = text.match(PLACE)?.[1];
  return call("post_offer", {
    kind: "service",
    title: capitalize(task),
    price_unit: HOURLY.test(text) ? "hour" : "job",
    ask_price: ask,
    ...(min !== undefined && min <= ask ? { min_price: min } : {}),
    ...(location ? { location } : {}),
  });
}

// ---------- reading the conversation ----------

function resultJson(r: ToolResultBlock["toolResult"]): Json {
  for (const c of r.content) {
    if ("json" in c) return c.json;
    try {
      return JSON.parse(c.text) as Json;
    } catch {
      return { say: c.text };
    }
  }
  return {};
}

function toolUseFor(messages: AgentMessage[], toolUseId: string) {
  for (const m of messages) for (const b of m.content) if (isToolUse(b) && b.toolUse.toolUseId === toolUseId) return b.toolUse;
  return undefined;
}

const toolNameFor = (messages: AgentMessage[], toolUseId: string) => toolUseFor(messages, toolUseId)?.name;

function previousAssistantText(messages: AgentMessage[]) {
  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i].content.filter(isText).map((b) => b.text).join(" ");
  }
  return "";
}

/** Tool results newest first, paired with the tool that produced them. */
function* resultsNewestFirst(messages: AgentMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const blocks = messages[i].content.filter(isToolResult);
    for (let j = blocks.length - 1; j >= 0; j--) {
      const r = blocks[j].toolResult;
      const use = toolUseFor(messages, r.toolUseId);
      yield { tool: use?.name, input: use?.input ?? {}, status: r.status ?? "success", data: resultJson(r) };
    }
  }
}

/** If the last thing that happened was a request rejected for lack of a budget, its words. */
function pendingBudgetRequest(messages: AgentMessage[]) {
  for (const r of resultsNewestFirst(messages)) {
    if (r.tool === "post_request" && r.status === "error" && /most you'd pay/.test(String(r.data.say))) {
      for (const m of messages) for (const b of m.content) if (isToolUse(b) && b.toolUse.name === "post_request") {
        const raw = b.toolUse.input.raw_request;
        if (typeof raw === "string") return raw;
      }
    }
    return undefined;
  }
  return undefined;
}

/** If the newest result is a price check, the call it questioned and the field to correct. */
function pendingPriceCheck(messages: AgentMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const b of messages[i].content) {
      if (!isToolResult(b)) continue;
      const data = resultJson(b.toolResult);
      if (b.toolResult.status !== "error" || data.code !== "confirm_price") return undefined;
      for (const m of messages) for (const u of m.content) {
        if (isToolUse(u) && u.toolUse.toolUseId === b.toolResult.toolUseId) {
          return { tool: u.toolUse.name, input: u.toolUse.input, field: String(data.field) };
        }
      }
      return undefined;
    }
  }
  return undefined;
}

/** If the newest result offered the asking price after a no, the negotiate call a yes makes. */
function pendingAskingPrice(messages: AgentMessage[]) {
  for (const r of resultsNewestFirst(messages)) {
    const d = r.data as { deal?: unknown; say?: unknown; request?: { request_id?: string }; alternatives?: { offer_id: string; ask_price: number }[] };
    if (r.status === "error" || d.deal || !/Want (it at that price|them at that rate)\?/.test(String(d.say))) return undefined;
    if (r.tool === "post_request" && d.request?.request_id && d.alternatives?.[0]) {
      return { request_id: d.request.request_id, offer_id: d.alternatives[0].offer_id, max_price: d.alternatives[0].ask_price };
    }
    const ask = amount(new RegExp(String.raw`\b(?:It's|charge)\s+${MONEY}`, "i"), String(d.say));
    if (r.tool === "negotiate" && ask !== undefined) return { request_id: r.input.request_id, offer_id: r.input.offer_id, max_price: ask };
    return undefined;
  }
  return undefined;
}

interface Sug { suggestion_id: string; request?: { max_price?: number | null } }

/** The suggestion the assistant just offered, when the newest result is one. */
function pendingSuggestion(messages: AgentMessage[]) {
  for (const r of resultsNewestFirst(messages)) {
    if (r.tool === "get_deal_status") continue;
    if (r.status === "error") {
      const d = r.data as { code?: string; suggestion_id?: string };
      return d.code === "need_budget" && d.suggestion_id ? { id: d.suggestion_id, needsBudget: true } : undefined;
    }
    const d = r.data as { suggestions?: Sug[]; suggestion?: Sug | null };
    const s = d.suggestion ?? (r.tool === "get_suggestions" ? d.suggestions?.[0] : undefined);
    return s ? { id: s.suggestion_id, needsBudget: s.request?.max_price == null } : undefined;
  }
  return undefined;
}

interface DealLike {deal_id?: string; status?: string; waiting_for_you?: boolean }

function latestOpenDeal(messages: AgentMessage[], mustAwaitUser: boolean) {
  for (const r of resultsNewestFirst(messages)) {
    const d = r.data as { deal?: DealLike | null; next_deal?: DealLike | null; deals?: DealLike[] };
    for (const deal of [d.next_deal, d.deal, ...(d.deals ?? [])]) {
      if (deal?.deal_id && deal.status === "proposed" && (!mustAwaitUser || deal.waiting_for_you)) return deal.deal_id;
    }
  }
  return undefined;
}

function latestRequest(messages: AgentMessage[]) {
  for (const r of resultsNewestFirst(messages)) {
    const d = r.data as { request?: { request_id?: string }; request_id?: string };
    const id = d.request?.request_id ?? d.request_id;
    if (id) return id;
  }
  return undefined;
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);

function pickPost(text: string, data: Json) {
  const said = words(text);
  const live = [
    ...((data.offers as { offer_id: string; title: string; status: string }[] | undefined) ?? [])
      .filter((o) => o.status === "active" || o.status === "pending").map((o) => ({ id: o.offer_id, label: o.title })),
    ...((data.requests as { request_id: string; need: string; status: string }[] | undefined) ?? [])
      .filter((r) => r.status === "open" || r.status === "matched").map((r) => ({ id: r.request_id, label: r.need })),
  ];
  const scored = live
    .map((p) => ({ ...p, score: [...words(p.label)].filter((w) => w.length > 1 && said.has(w)).length }))
    .sort((a, b) => b.score - a.score);
  if (live.length === 1) return live[0];
  return scored[0]?.score && scored[0].score > (scored[1]?.score ?? 0) ? scored[0] : undefined;
}
