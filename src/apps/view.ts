import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";

// The VoiceMarket MCP Apps view. One view for every tool; the layout follows
// the shape of the tool result:
//   deal     an offer (or a new post), with Confirm / Decline when it waits for this user
//   options  other listings for a request, with "Get this one"
//   deals    the user's deals, those waiting for their yes first
//   posts    the user's items and requests, with "Take down"
// Rendered by any MCP Apps host. Data comes from the tool result's
// structuredContent; actions call the server's tools through the host.

type View = "deal" | "options" | "deals" | "posts";
const viewFor = (d: Data): View => (d.matches ? "options" : d.deals ? "deals" : d.listings || d.requests ? "posts" : "deal");

interface Deal {
  deal_id: string; listing_id: string; title: string; condition: string; your_role: "buyer" | "seller" | "observer";
  counterpart: string | null; price: number; ask_price: number; saved_vs_ask: number; currency: string;
  status: "proposed" | "confirmed" | "declined" | "replaced" | "expired" | "withdrawn";
  waiting_for: ("buyer" | "seller")[]; waiting_for_you: boolean;
  meetup: { place: string | null; availability: string | null }; on_hold_until: string | null;
}
interface Listing {
  listing_id: string; title: string; condition: string; ask_price: number; currency: string; location: string | null;
  status: string; within_budget_at_ask?: boolean; your_min_price?: number;
}
interface Intent { intent_id: string; need: string; status: string; your_max_price?: number; currency: string }
type Data = Record<string, unknown> & {
  say?: string; deal?: Deal | null; next_deal?: Deal | null; deals?: Deal[]; listing?: Listing; intent?: Intent;
  intent_id?: string; matches?: Listing[]; alternatives?: Listing[]; listings?: Listing[]; requests?: Intent[]; waiting_buyers?: number;
};

const app = new App({ name: "VoiceMarket", version: "1.0.0" }, {}, { autoResize: true });
const root = document.getElementById("root")!;
let data: Data | null = null;
let busy = false;
let note = "";

// ---------- tiny DOM helpers (text only, never HTML from data) ----------

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string>> = {}, ...kids: (Node | string | null | false | undefined)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v != null) el.setAttribute(k, v);
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}

const money = (n: number, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const pretty = (s: string) => s.replace(/_/g, " ");
const POST_STATUS: Record<string, string> = {
  active: "For sale", pending: "Offer pending", sold: "Sold", withdrawn: "Taken down",
  open: "Looking", matched: "Offer pending", fulfilled: "Bought", cancelled: "Cancelled",
};
/** Inline views stay short (Alexa+ design guide: 3–5 items); the rest live in the app's lists. */
const INLINE_MAX = 5;

function chip(text: string, tone: "accent" | "good" | "muted" | "warn" = "muted") {
  return h("span", { class: `chip ${tone}` }, text);
}

function statusChip(d: Deal) {
  if (d.status === "proposed") return d.waiting_for_you ? chip("Waiting for your yes", "accent") : chip(`Waiting for the ${d.waiting_for.join(" and ")}`, "muted");
  if (d.status === "confirmed") return chip("Confirmed", "good");
  if (d.status === "expired") return chip("Expired", "warn");
  if (d.status === "replaced") return chip("Replaced", "muted");
  if (d.status === "withdrawn") return chip("Taken down", "warn");
  return chip("Cancelled", "muted");
}

function button(label: string, kind: "primary" | "secondary" | "danger", onClick: () => void) {
  const b = h("button", { class: kind, type: "button" }, label) as HTMLButtonElement;
  b.disabled = busy;
  b.addEventListener("click", onClick);
  return b;
}

// ---------- actions (tool calls go through the host) ----------

async function act(name: string, args: Record<string, unknown>, after?: (result: Data) => void) {
  if (busy) return;
  busy = true;
  note = "";
  render();
  try {
    const res = await app.callServerTool({ name, arguments: args });
    const result = (res.structuredContent ?? {}) as Data;
    note = res.isError ? errorSay(res) : String(result.say ?? "");
    if (!res.isError) after?.(result);
  } catch {
    note = "That didn't go through. Please try again.";
  } finally {
    busy = false;
    render();
  }
}

function errorSay(res: { content?: unknown }) {
  const text = (res.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text;
  try {
    return String((JSON.parse(text ?? "{}") as { say?: string }).say ?? "Something went wrong.");
  } catch {
    return text ?? "Something went wrong.";
  }
}

// ---------- views ----------

function dealCard(d: Deal, compact = false) {
  const buyer = d.your_role === "buyer";
  const savings = buyer && d.saved_vs_ask > 0 ? `You save ${money(d.saved_vs_ask, d.currency)} on the ${money(d.ask_price, d.currency)} ask` :
    !buyer && d.saved_vs_ask > 0 ? `Asked ${money(d.ask_price, d.currency)}, agreed inside your limit` : `At the asking price`;
  const meet = [d.meetup.place, d.meetup.availability].filter(Boolean).join(" · ");
  const actions = d.status === "proposed" && d.waiting_for_you
    ? h("div", { class: "actions" },
        button(`Confirm ${money(d.price, d.currency)}`, "primary", () => act("confirm_deal", { deal_id: d.deal_id }, (r) => { if (r.deal) replaceDeal(r.deal); })),
        button("Decline", "secondary", () => act("decline_deal", { deal_id: d.deal_id }, (r) => {
          replaceDeal({ ...d, status: "declined", waiting_for: [], waiting_for_you: false });
          if (r.next_deal && data) data = { ...data, deal: r.next_deal, next_deal: null };
        })))
    : null;
  return h("article", { class: compact ? "card compact" : "card" },
    h("div", { class: "row" }, statusChip(d), d.counterpart ? h("span", { class: "muted" }, `${buyer ? "From" : "To"} ${d.counterpart}`) : null),
    h("h2", {}, d.title),
    h("div", { class: "price" }, money(d.price, d.currency)),
    h("p", { class: "muted" }, savings),
    meet ? h("p", { class: "meet" }, h("span", { class: "label" }, "Meet-up"), meet) : null,
    d.status === "proposed" && d.on_hold_until ? h("p", { class: "muted small" }, `On hold until ${when(d.on_hold_until)}`) : null,
    actions,
  );
}

function replaceDeal(next: Deal) {
  if (!data) return;
  if (data.deal?.deal_id === next.deal_id || data.next_deal?.deal_id === next.deal_id) data = { ...data, deal: next, next_deal: null };
  if (data.deals) data = { ...data, deals: data.deals.map((x) => (x.deal_id === next.deal_id ? next : x)) };
}

function listingCard(l: Listing, intentId?: string) {
  return h("article", { class: "card option" },
    h("div", { class: "row" }, chip(pretty(l.condition)), l.within_budget_at_ask ? chip("In budget", "good") : null),
    h("h3", {}, l.title),
    h("div", { class: "price small-price" }, money(l.ask_price, l.currency)),
    l.location ? h("p", { class: "muted small" }, l.location) : null,
    intentId ? button("Get this one", "secondary", () => act("negotiate", { intent_id: intentId, listing_id: l.listing_id }, (r) => {
      if (data) data = { ...data, deal: r.deal ?? null, matches: data.matches?.filter((m) => m.listing_id !== l.listing_id) };
    })) : null,
  );
}

function renderDeal(d: Data) {
  const deal = d.deal ?? d.next_deal ?? null;
  const parts: (Node | null)[] = [];
  if (deal) parts.push(dealCard(deal));
  else if (d.listing) {
    parts.push(h("article", { class: "card" },
      h("div", { class: "row" }, chip("Listed", "accent"), d.waiting_buyers ? h("span", { class: "muted" }, `${d.waiting_buyers} buyer${d.waiting_buyers > 1 ? "s" : ""} looking`) : null),
      h("h2", {}, d.listing.title),
      h("div", { class: "price" }, money(d.listing.ask_price, d.listing.currency)),
      d.listing.your_min_price != null ? h("p", { class: "muted" }, `Private minimum ${money(d.listing.your_min_price, d.listing.currency)} · buyers never see it`) : null,
      h("p", { class: "muted small" }, "You'll be paired with the next buyer who asks."),
    ));
  } else if (d.intent) {
    parts.push(h("article", { class: "card" },
      h("div", { class: "row" }, chip("Looking", "accent")),
      h("h2", {}, d.intent.need),
      d.intent.your_max_price != null ? h("p", { class: "muted" }, `Up to ${money(d.intent.your_max_price, d.intent.currency)} · sellers never see it`) : null,
      h("p", { class: "muted small" }, "You'll be paired as soon as a seller lists one."),
    ));
  }
  // Alternatives matter while the user is still deciding.
  const alts = !deal || deal.status === "proposed" ? d.alternatives ?? [] : [];
  if (alts.length && d.intent) {
    parts.push(h("h4", {}, deal ? "Other options" : "Close matches"));
    parts.push(h("div", { class: "carousel" }, ...alts.map((l) => listingCard(l, d.intent!.intent_id))));
  }
  return parts;
}

function renderOptions(d: Data) {
  const matches = d.matches ?? [];
  if (d.deal) return [dealCard(d.deal), ...(matches.length ? [h("h4", {}, "Other options"), h("div", { class: "carousel" }, ...matches.map((l) => listingCard(l, d.intent_id)))] : [])];
  if (!matches.length) return [h("p", { class: "muted" }, "No other options right now.")];
  return [h("div", { class: "carousel" }, ...matches.map((l) => listingCard(l, d.intent_id)))];
}

function renderDeals(d: Data) {
  const deals = d.deals ?? [];
  if (!deals.length) return [h("p", { class: "muted" }, "No deals yet.")];
  const shown = deals.slice(0, INLINE_MAX).map((x) => dealCard(x, true));
  return deals.length > INLINE_MAX ? [...shown, h("p", { class: "more" }, `And ${deals.length - INLINE_MAX} more`)] : shown;
}

const confirming = new Set<string>();
function renderPosts(d: Data) {
  const live = (s: string) => ["active", "pending", "open", "matched"].includes(s);
  const order = (s: string) => (live(s) ? 0 : 1);
  const row = (id: string, label: string, sub: string, status: string) => {
    const armed = confirming.has(id);
    return h("article", { class: "card compact" },
      h("div", { class: "row" }, chip(POST_STATUS[status] ?? pretty(status), live(status) ? "accent" : "muted")),
      h("h3", {}, label),
      h("p", { class: "muted small" }, sub),
      live(status) ? h("div", { class: "actions" }, button(armed ? "Tap again to take it down" : "Take down", armed ? "danger" : "secondary", () => {
        if (!armed) { confirming.add(id); render(); return; }
        confirming.delete(id);
        void act("withdraw_post", { post_id: id }, (r) => {
          if (!data) return;
          const status = String(r.status);
          data = {
            ...data,
            listings: data.listings?.map((l) => (l.listing_id === id ? { ...l, status } : l)),
            requests: data.requests?.map((i) => (i.intent_id === id ? { ...i, status } : i)),
          };
        });
      })) : null,
    );
  };
  const items = [
    ...[...(d.listings ?? [])].sort((a, b) => order(a.status) - order(b.status))
      .map((l) => row(l.listing_id, l.title, `Selling · ${money(l.ask_price, l.currency)}`, l.status)),
    ...[...(d.requests ?? [])].sort((a, b) => order(a.status) - order(b.status))
      .map((i) => row(i.intent_id, i.need, `Buying${i.your_max_price != null ? ` · up to ${money(i.your_max_price, i.currency)}` : ""}`, i.status)),
  ];
  if (!items.length) return [h("p", { class: "muted" }, "Nothing listed or requested yet.")];
  return items.length > INLINE_MAX ? [...items.slice(0, INLINE_MAX), h("p", { class: "more" }, `And ${items.length - INLINE_MAX} more`)] : items;
}

function render() {
  root.replaceChildren();
  if (!data) {
    root.append(h("p", { class: "muted" }, "Loading…"));
    return;
  }
  const view = viewFor(data);
  const parts = view === "options" ? renderOptions(data) : view === "deals" ? renderDeals(data) : view === "posts" ? renderPosts(data) : renderDeal(data);
  root.append(...parts.filter(Boolean) as Node[]);
  if (note) root.append(h("p", { class: "note", role: "status" }, note));
}

function applyTheme(ctx?: McpUiHostContext) {
  const theme = ctx?.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
}

app.ontoolresult = (result) => {
  data = (result.structuredContent ?? null) as Data | null;
  render();
};
app.onhostcontextchanged = (ctx) => applyTheme({ ...app.getHostContext(), ...ctx });

render();
await app.connect();
applyTheme(app.getHostContext());
