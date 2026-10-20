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
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  return reply(String(data.say ?? "Done."));
}

// ---------- on the user's words ----------

const DECLINE = /^\s*(no|nope|nah|decline|pass|not (that|this)( one)?|cancel (it|that|the deal))\b/i;
export const WITHDRAW = /\b(take down|remove|withdraw|delete|cancel)\b.*\b(listing|offer|request|post|my|the)\b/i;
const MY_POSTS = /\b(what am i (selling|offering|looking for)|my (listings|offers|posts|requests|items)|what (have|did) i (list|post|offer)(ed)?)\b/i;
const STATUS = /\b(news|status|my (deals?|jobs?)|any (offers|deals|buyers|sellers|jobs|updates)|meet-?up|did (anyone|someone|anybody)|has (anyone|anybody)|who (bought|is buying)|inbox|what'?s new)\b/i;
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

  if (DECLINE.test(text)) {
    const deal = latestOpenDeal(messages, false);
    return deal ? call("decline_deal", { deal_id: deal }) : reply("Okay. What would you like to do instead?");
  }
  if (isExplicitYes(text)) {
    const deal = latestOpenDeal(messages, true);
    return deal ? call("confirm_deal", { deal_id: deal }) : call("get_deal_status", {});
  }
  if (WITHDRAW.test(text) || MY_POSTS.test(text)) return call("list_my_posts", {});
  if (STATUS.test(text)) return call("get_deal_status", {});
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

function toolNameFor(messages: AgentMessage[], toolUseId: string) {
  for (const m of messages) for (const b of m.content) if (isToolUse(b) && b.toolUse.toolUseId === toolUseId) return b.toolUse.name;
  return undefined;
}

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
      yield { tool: toolNameFor(messages, r.toolUseId), status: r.status ?? "success", data: resultJson(r) };
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

interface DealLike { deal_id?: string; status?: string; waiting_for_you?: boolean }

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
