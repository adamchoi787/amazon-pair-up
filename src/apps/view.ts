import { App, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";

// The PairUp MCP Apps view. One view for every tool; the layout follows
// the shape of the tool result:
//   deal     an offer (or a new post), with Confirm / Decline when it waits for this user
//   options  other offers for a request, with "Get this one"
//   deals    the user's deals, those waiting for their yes first
//   posts    the user's offers and requests, with "Take down"
// Items and services share every layout; a service card shows the rate, the
// total for hourly work, the route for errands and when the job is.
// Rendered by any MCP Apps host. Data comes from the tool result's
// structuredContent; actions call the server's tools through the host.

type View = "deal" | "options" | "deals" | "posts" | "suggestions" | "routines";
const viewFor = (d: Data): View => (d.suggestions ? "suggestions" : d.routines ? "routines" : d.matches ? "options" : d.deals ? "deals" : d.offers || d.requests ? "posts" : "deal");

type Kind = "item" | "service";
type Unit = "each" | "job" | "hour";

interface Deal {
  deal_id: string; offer_id: string; kind: Kind; title: string; task: string | null; condition: string | null;
  your_role: "buyer" | "seller" | "observer"; counterpart: string | null;
  price: number; price_unit: Unit; hours: number | null; total: number | null; ask_price: number; saved_vs_ask: number; currency: string;
  status: "proposed" | "confirmed" | "declined" | "replaced" | "expired" | "withdrawn";
  waiting_for: ("buyer" | "seller")[]; waiting_for_you: boolean;
  seller_confirmed: boolean;
  meetup: { place: string | null; availability: string | null; point?: MeetPoint | null }; pickup: string | null; needed_by: string | null;
  handoff?: "meetup" | "delivery" | null; delivery?: Delivery | null;
  on_hold_until: string | null;
  price_check: { verdict: "typical" | "below_typical" | "above_typical" | "far_below" | "far_above"; typical_low: number; typical_high: number } | null;
  scheduling?: { status: "verified" | "needs_confirmation" | "conflict"; starts_at: string | null; ends_at: string | null; time_zone: string; provider_availability: string | null } | null;
}
interface Delivery {
  selected: boolean; provider: string; fee: number; eta: string; reference: string | null;
  drop_off: { name: string; area: string }; pick_up: { name: string; area: string };
}
type Arrival = "not_here" | "checked_in" | "confirmed";
interface MeetPoint { point_id: string; name: string; status: "chosen" | "one_here" | "both_here"; you: Arrival; them: Arrival }
interface Offer {
  offer_id: string; kind: Kind; title: string; condition: string | null; ask_price: number; price_unit: Unit; currency: string;
  location: string | null; status: string; within_budget_at_ask?: boolean; your_min_price?: number;
  availability?: string | null; time_zone?: string;
}
interface Request {
  request_id: string; kind: Kind; need: string; status: string; price_unit: Unit; your_max_price?: number; currency: string;
  pickup: string | null; location: string | null; schedule: string | null;
}
interface Fallback { reason: "no_seller" | "over_budget"; new_price: number | null; currency: string; amazon_url: string; say: string }
interface TradeIn { category: string; url: string; say: string }
type Data = Record<string, unknown> & {
  say?: string; fallback?: Fallback | null; trade_in?: TradeIn | null; deal?: Deal | null; next_deal?: Deal | null; deals?: Deal[]; offer?: Offer; request?: Request;
  suggestions?: {suggestion_id:string;say:string;reason:string;request:{max_price:number|null}}[];
  routines?: {routine_id:string;need:string;when:string;usual_budget:number;price_unit:Unit;pickup:string|null;location:string|null;next_at:string}[];
  time_zone?: string;
  request_id?: string; matches?: Offer[]; alternatives?: Offer[]; offers?: Offer[]; requests?: Request[]; waiting_requests?: number;
};

const app = new App({ name: "PairUp", version: "1.0.0" }, {}, { autoResize: true });
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
/** "$9/hr", "$4 per job", "$17". */
const rate = (n: number, unit: Unit, currency = "USD") => money(n, currency) + (unit === "hour" ? "/hr" : unit === "job" ? " per job" : "");
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const pretty = (s: string) => s.replace(/_/g, " ");
const OFFER_STATUS: Record<string, Record<Kind, string>> = {
  active: { item: "For sale", service: "Available" }, pending: { item: "Offer pending", service: "Job pending" },
  sold: { item: "Sold", service: "Booked" }, withdrawn: { item: "Taken down", service: "Taken down" },
};
const REQUEST_STATUS: Record<string, Record<Kind, string>> = {
  open: { item: "Looking", service: "Asking" }, matched: { item: "Offer pending", service: "Helper found" },
  fulfilled: { item: "Bought", service: "Booked" }, cancelled: { item: "Cancelled", service: "Cancelled" },
};
/** Inline views stay short (Alexa+ design guide: 3–5 items); the rest live in the app's lists. */
const INLINE_MAX = 5;

function chip(text: string, tone: "accent" | "good" | "muted" | "warn" = "muted") {
  return h("span", { class: `chip ${tone}` }, text);
}

function statusChip(d: Deal) {
  const service = d.kind === "service";
  if (d.status === "proposed") {
    if (d.waiting_for_you) return chip(service && d.your_role === "seller" ? "New job for you" : "Waiting for your yes", "accent");
    const who = d.waiting_for.map((p) => (service ? (p === "seller" ? d.counterpart ?? "helper" : d.counterpart ?? "requester") : `the ${p}`));
    return chip(`Waiting for ${who.join(" and ")}`, "muted");
  }
  if (d.status === "confirmed") return chip(service ? "Booked" : "Confirmed", "good");
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

/** Opens an Amazon page in the host's browser (the host may ask the user first). */
async function openLink(url: string) {
  try {
    const res = await app.openLink({ url });
    if (res.isError) throw new Error("refused");
  } catch {
    note = `Open ${url} to see it on Amazon.`;
    render();
  }
}

// ---------- views ----------

function savingsLine(d: Deal) {
  const buyer = d.your_role === "buyer";
  const ask = rate(d.ask_price, d.price_unit, d.currency);
  if (d.saved_vs_ask <= 0) return d.kind === "item" ? "At the asking price" : "At their rate";
  if (!buyer) return `Asked ${ask}, agreed inside your limit`;
  return `You save ${money(d.saved_vs_ask, d.currency)}${d.price_unit === "hour" ? "/hr" : ""} on the ${ask} ask`;
}

/** Where and when: a meet-up for an item; for a service, the route or place and the time. */
function placeRows(d: Deal) {
  const schedule = d.scheduling;
  const format = (iso: string, end = false) => new Date(iso).toLocaleString(undefined, {
    timeZone: schedule?.time_zone, ...(end ? {} : { weekday: "short", month: "short", day: "numeric" }), hour: "numeric", minute: "2-digit",
  });
  const time = schedule?.starts_at
    ? `${format(schedule.starts_at)}${schedule.ends_at ? ` – ${format(schedule.ends_at, schedule.starts_at.slice(0, 10) === schedule.ends_at.slice(0, 10))}` : ""}`
    : d.needed_by ? `By ${format(d.needed_by)}` : d.meetup.availability;
  if (d.kind === "item" && d.delivery?.selected) {
    const v = d.delivery;
    return [
      h("p", { class: "meet" }, h("span", { class: "label" }, "Drop off"), v.drop_off.name),
      h("p", { class: "meet" }, h("span", { class: "label" }, "Pick up"), `${v.pick_up.name}, ${v.eta}`),
      d.total != null ? h("p", { class: "meet" }, h("span", { class: "label" }, "Total"), `${money(d.total, d.currency)} with ${money(v.fee, d.currency)} delivery`) : null,
      v.reference ? h("p", { class: "meet" }, h("span", { class: "label" }, "Reference"), v.reference) : null,
      h("p", { class: "muted small" }, `${v.provider} · demo locations`),
    ];
  }
  if (d.kind === "item") {
    const meet = [d.meetup.place, d.meetup.availability].filter(Boolean).join(" · ");
    return meet ? [h("p", { class: "meet" }, h("span", { class: "label" }, "Meet-up"), meet)] : [];
  }
  return [
    d.pickup ? h("p", { class: "meet" }, h("span", { class: "label" }, "Pick up"), d.pickup) : null,
    d.meetup.place ? h("p", { class: "meet" }, h("span", { class: "label" }, d.pickup ? "Drop off" : "Where"), d.meetup.place) : null,
    time ? h("p", { class: "meet" }, h("span", { class: "label" }, "When"), time) : null,
    schedule ? h("p", { class: "muted small" }, schedule.time_zone) : null,
  ];
}

/** A PairUp Point: where to meet, each side's Ring-confirmed arrival, and the next step. */
function pointPanel(d: Deal) {
  const p = d.meetup.point;
  const open = d.status === "proposed" || d.status === "confirmed";
  if (!p) {
    return open && d.your_role !== "observer"
      ? h("div", { class: "actions" }, button("Meet at a PairUp Point", "secondary", () => act("choose_meetup_point", { deal_id: d.deal_id }, () => refresh(d.deal_id))))
      : null;
  }
  const label = (who: string, a: Arrival) => chip(`${who}: ${a === "confirmed" ? "here, Ring confirmed" : a === "checked_in" ? "checked in" : "on the way"}`, a === "confirmed" ? "good" : a === "checked_in" ? "accent" : "muted");
  return h("div", { class: "schedule-note", role: "note" },
    h("strong", {}, p.status === "both_here" ? "Both here. Go ahead with the hand-off." : "PairUp Point with Ring"),
    h("div", { class: "row" }, label("You", p.you), label(d.counterpart ?? "Them", p.them)),
    h("p", { class: "small muted" }, "Press the Ring doorbell when you arrive. Ring reports only the time of the press; no video is kept."),
    d.status === "confirmed" && p.you !== "confirmed"
      ? h("div", { class: "actions" }, button("I'm here", "primary", () => act("check_in_at_point", { deal_id: d.deal_id }, () => refresh(d.deal_id))))
      : null);
}

/** Reload one deal after a meet-up change. */
function refresh(dealId: string) {
  void app.callServerTool({ name: "get_deal_status", arguments: { deal_id: dealId } }).then((res) => {
    const next = (res.structuredContent as Data | undefined)?.deals?.[0];
    if (next) { replaceDeal(next); render(); }
  }).catch(() => undefined);
}

function scheduleNote(d: Deal) {
  if (!d.scheduling || d.status !== "proposed") return null;
  const s = d.scheduling;
  return h("div", { class: s.status === "needs_confirmation" && !d.seller_confirmed ? "alert" : "schedule-note", role: "note" },
    h("strong", {}, s.status === "verified" ? "Fits the stated availability" : d.seller_confirmed ? "Time approved by the helper" : "Time needs the helper's approval"),
    s.provider_availability ? h("p", { class: "small muted" }, `Provider's hours: ${s.provider_availability}`) : null,
    s.status === "needs_confirmation" && !d.seller_confirmed ? h("p", { class: "small" }, "This is a tentative match. The helper must check the time before it is booked.") : null);
}

/** The agreed price against the usual range; a warning for the buyer when it is far off. */
function priceNote(d: Deal) {
  const c = d.price_check;
  if (!c) return null;
  const usual = `Usually ${money(c.typical_low, d.currency)} to ${rate(c.typical_high, d.price_unit, d.currency)}`;
  if (d.your_role === "buyer" && c.verdict === "far_below") {
    return h("p", { class: "alert", role: "note" }, h("strong", {}, "Far below the usual price. "),
      d.kind === "item" ? `${usual}. Meet somewhere public, check it works, and pay only once you have it.` : `${usual}.`);
  }
  if (d.your_role === "buyer" && c.verdict === "far_above") return h("p", { class: "alert", role: "note" }, h("strong", {}, "Well above the usual price. "), `${usual}.`);
  return h("p", { class: "muted small" }, usual);
}

function dealCard(d: Deal, compact = false) {
  const buyer = d.your_role === "buyer";
  const service = d.kind === "service";
  const confirmLabel = service && !buyer ? "Confirm I can do this job" : service ? `Confirm ${money(d.total ?? d.price, d.currency)}${d.total == null && d.price_unit === "hour" ? "/hr" : " booking"}` : `Confirm ${money(buyer ? d.total ?? d.price : d.price, d.currency)}`;
  const actions = d.status === "proposed" && d.waiting_for_you
    ? h("div", { class: "actions" },
        button(confirmLabel, "primary", () => act("confirm_deal", { deal_id: d.deal_id }, (r) => { if (r.deal) replaceDeal(r.deal); })),
        button(service && !buyer ? "Pass" : "Decline", "secondary", () => act("decline_deal", { deal_id: d.deal_id }, (r) => {
          replaceDeal({ ...d, status: "declined", waiting_for: [], waiting_for_you: false });
          if (r.next_deal && data) data = { ...data, deal: r.next_deal, next_deal: null };
        })))
    : null;
  const title = service && !buyer && d.task ? d.task : d.title;
  // The buyer can switch a proposed item deal between a meet-up and Amazon Hub delivery.
  const handoff = buyer && d.delivery && d.status === "proposed"
    ? h("div", { class: "actions" }, button(
        d.delivery.selected ? "Meet up instead" : `Deliver to my locker · +${money(d.delivery.fee, d.currency)}`, "secondary",
        () => act("choose_handoff", { deal_id: d.deal_id, method: d.delivery!.selected ? "meetup" : "delivery" }, (r) => { if (r.deal) replaceDeal(r.deal); })))
    : null;
  return h("article", { class: compact ? "card compact" : "card" },
    h("div", { class: "row" }, statusChip(d), d.counterpart ? h("span", { class: "muted" }, `${buyer ? (service ? "By" : "From") : "For"} ${d.counterpart}`) : null),
    h("h2", {}, title),
    service && !buyer ? h("p", { class: "muted small" }, d.title) : null,
    h("div", { class: "deal-overview" },
      h("div", {},
        h("div", { class: "price" }, rate(d.price, d.price_unit, d.currency)),
        d.price_unit === "hour" && d.total != null && d.hours != null
          ? h("p", { class: "muted" }, `${money(d.total, d.currency)} for ${d.hours} hour${d.hours === 1 ? "" : "s"}`) : null,
        h("p", { class: "muted small" }, savingsLine(d)), priceNote(d)),
      h("div", { class: "deal-place" }, ...placeRows(d))),
    scheduleNote(d),
    d.delivery?.selected ? null : pointPanel(d),
    d.status === "confirmed" ? h("p", { class: "muted small" }, service ? "Booking agreed. Pay the helper directly after the job." : d.delivery?.selected ? "Both sides agreed. The seller drops it off and you get a pickup code." : "Both sides agreed. Check the item and pay directly at handover.") : null,
    actions,
    handoff,
    d.status === "proposed" && d.on_hold_until ? h("p", { class: "muted small expiry" }, `On hold until ${when(d.on_hold_until)}`) : null,
  );
}

function replaceDeal(next: Deal) {
  if (!data) return;
  if (data.deal?.deal_id === next.deal_id || data.next_deal?.deal_id === next.deal_id) data = { ...data, deal: next, next_deal: null };
  if (data.deals) data = { ...data, deals: data.deals.map((x) => (x.deal_id === next.deal_id ? next : x)) };
}

function offerCard(o: Offer, requestId?: string) {
  return h("article", { class: "card option" },
    h("div", { class: "row" }, chip(o.condition ? pretty(o.condition) : o.price_unit === "hour" ? "hourly" : "per job"), o.within_budget_at_ask ? chip("In budget", "good") : null),
    h("h3", {}, o.title),
    h("div", { class: "price small-price" }, rate(o.ask_price, o.price_unit, o.currency)),
    o.location ? h("p", { class: "muted small" }, o.location) : null,
    o.kind === "service" && o.availability ? h("p", { class: "muted small" }, `${o.availability} · ${o.time_zone ?? "America/Los_Angeles"}`) : null,
    requestId ? button(o.kind === "service" ? "Choose this helper" : "See this offer", "secondary", () => act("negotiate", { request_id: requestId, offer_id: o.offer_id }, (r) => {
      if (data) data = { ...data, deal: r.deal ?? null, matches: data.matches?.filter((m) => m.offer_id !== o.offer_id) };
    })) : null,
  );
}

function renderDeal(d: Data) {
  const deal = d.deal ?? d.next_deal ?? null;
  const parts: (Node | null)[] = [];
  if (deal) parts.push(dealCard(deal));
  else if (d.offer) {
    const o = d.offer;
    const service = o.kind === "service";
    const waiting = d.waiting_requests ?? 0;
    parts.push(h("article", { class: "card" },
      h("div", { class: "row" }, chip(service ? "Available" : "Listed", "accent"),
        waiting ? h("span", { class: "muted" }, `${waiting} ${waiting > 1 ? "people" : "person"} looking`) : null),
      h("h2", {}, o.title),
      h("div", { class: "price" }, rate(o.ask_price, o.price_unit, o.currency)),
      o.your_min_price != null ? h("p", { class: "muted" }, `Private minimum ${rate(o.your_min_price, o.price_unit, o.currency)} · nobody else sees it`) : null,
      h("p", { class: "muted small" }, service ? "You'll get jobs as people ask." : "You'll be paired with the next buyer who asks."),
      d.trade_in ? h("div", { class: "actions" }, button("Amazon Trade-In", "secondary", () => void openLink(d.trade_in!.url))) : null,
    ));
  } else if (d.request) {
    const r = d.request;
    const service = r.kind === "service";
    parts.push(h("article", { class: "card" },
      h("div", { class: "row" }, chip(service ? "Asking" : "Looking", "accent")),
      h("h2", {}, r.need),
      r.your_max_price != null ? h("p", { class: "muted" }, `Up to ${rate(r.your_max_price, r.price_unit, r.currency)} · ${service ? "helpers" : "sellers"} never see it`) : null,
      service && (r.pickup || r.location || r.schedule)
        ? h("p", { class: "meet" }, [r.pickup && r.location ? `${r.pickup} → ${r.location}` : r.pickup ?? r.location, r.schedule].filter(Boolean).join(" · "))
        : null,
      h("p", { class: "muted small" }, service ? "You'll be paired as soon as someone offers." : "You'll be paired as soon as a seller lists one."),
      d.fallback ? h("p", { class: "muted small" }, d.fallback.say) : null,
      d.fallback ? h("div", { class: "actions" }, button(
        d.fallback.new_price != null ? `New on Amazon · about ${money(d.fallback.new_price, d.fallback.currency)} (demo estimate)` : "Look on Amazon",
        "secondary", () => void openLink(d.fallback!.amazon_url),
      )) : null,
    ));
  }
  // Alternatives matter while the user is still deciding.
  const alts = !deal || deal.status === "proposed" ? d.alternatives ?? [] : [];
  if (alts.length && d.request) {
    parts.push(h("h4", {}, deal ? "Other options" : "Close matches"));
    parts.push(h("div", { class: "carousel" }, ...alts.map((o) => offerCard(o, d.request!.request_id))));
  }
  return parts;
}

function renderOptions(d: Data) {
  const matches = d.matches ?? [];
  if (d.deal) return [dealCard(d.deal), ...(matches.length ? [h("h4", {}, "Other options"), h("div", { class: "carousel" }, ...matches.map((o) => offerCard(o, d.request_id)))] : [])];
  if (!matches.length) return [h("p", { class: "muted" }, "No other options right now.")];
  return [h("div", { class: "carousel" }, ...matches.map((o) => offerCard(o, d.request_id)))];
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
  const row = (id: string, label: string, sub: string, status: string, statusText: string) => {
    const armed = confirming.has(id);
    return h("article", { class: "card compact" },
      h("div", { class: "row" }, chip(statusText, live(status) ? "accent" : "muted")),
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
            offers: data.offers?.map((o) => (o.offer_id === id ? { ...o, status } : o)),
            requests: data.requests?.map((q) => (q.request_id === id ? { ...q, status } : q)),
          };
        });
      })) : null,
    );
  };
  const items = [
    ...[...(d.offers ?? [])].sort((a, b) => order(a.status) - order(b.status))
      .map((o) => row(o.offer_id, o.title, `${o.kind === "service" ? "Offering" : "Selling"} · ${rate(o.ask_price, o.price_unit, o.currency)}`, o.status,
        OFFER_STATUS[o.status]?.[o.kind] ?? pretty(o.status))),
    ...[...(d.requests ?? [])].sort((a, b) => order(a.status) - order(b.status))
      .map((q) => row(q.request_id, q.need, `${q.kind === "service" ? "Asking for help" : "Buying"}${q.your_max_price != null ? ` · up to ${rate(q.your_max_price, q.price_unit, q.currency)}` : ""}`, q.status,
        REQUEST_STATUS[q.status]?.[q.kind] ?? pretty(q.status))),
  ];
  if (!items.length) return [h("p", { class: "muted" }, "No offers or requests yet.")];
  return items.length > INLINE_MAX ? [...items.slice(0, INLINE_MAX), h("p", { class: "more" }, `And ${items.length - INLINE_MAX} more`)] : items;
}

function renderSuggestions(d:Data) {
  if(!d.suggestions?.length)return [h('p',{class:'muted'},'Nothing to suggest right now.')];
  return d.suggestions.map(s=>{
    const budget=h('input',{type:'number',min:'0.01',max:'100000',step:'0.01','aria-label':'Your budget',placeholder:'Your budget'}) as HTMLInputElement;
    return h('article',{class:'card'},h('h3',{},s.say),h('p',{class:'muted small'},s.reason),s.request.max_price===null?budget:null,
      h('div',{class:'actions'},button('Yes','primary',()=>{
        const max=s.request.max_price??Number(budget.value);
        if(!(max>0)){note='Enter your budget first.';budget.focus();return;}
        void act('accept_suggestion',{suggestion_id:s.suggestion_id,max_price:max,idempotency_key:crypto.randomUUID()},r=>{data=r;});
      }),button('Not now','secondary',()=>void act('dismiss_suggestion',{suggestion_id:s.suggestion_id},()=>{data={...data,suggestions:data?.suggestions?.filter(x=>x.suggestion_id!==s.suggestion_id)};})),
      button('Forget','secondary',()=>void act('dismiss_suggestion',{suggestion_id:s.suggestion_id,forget:true},()=>{data={...data,suggestions:data?.suggestions?.filter(x=>x.suggestion_id!==s.suggestion_id)};}))));
  });
}
function renderRoutines(d:Data) {
  if(!d.routines?.length)return [h('p',{class:'muted'},'No routines learned yet.')];
  return d.routines.map(r=>h('article',{class:'card'},h('h3',{},r.need),h('p',{},r.when),h('p',{class:'muted'},[rate(r.usual_budget,r.price_unit),r.pickup,r.location].filter(Boolean).join(' · ')),
    button('Forget','secondary',()=>{
      const date=new Intl.DateTimeFormat('en-CA',{timeZone:d.time_zone??'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.next_at)).replaceAll('-','');
      void act('dismiss_suggestion',{suggestion_id:'sug_'+r.routine_id+'_'+date,forget:true},()=>{data={...data,routines:data?.routines?.filter(x=>x.routine_id!==r.routine_id)};});
    })));
}
function render() {
  root.replaceChildren();
  if (!data) {
    root.append(h("p", { class: "muted" }, "Loading…"));
    return;
  }
  const view = viewFor(data);
  const parts = view === "suggestions" ? renderSuggestions(data)
    : view === "routines" ? renderRoutines(data)
    : view === "options" ? renderOptions(data)
    : view === "deals" ? renderDeals(data)
    : view === "posts" ? renderPosts(data) : renderDeal(data);
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
