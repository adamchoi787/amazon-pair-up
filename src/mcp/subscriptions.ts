import { log } from "../http/log.js";
import { marketEvents, type MarketEvent } from "../market/events.js";

// Live updates for agents. A connection that subscribes to deals://me or
// posts://me (resources/subscribe) gets notifications/resources/updated
// whenever a market event touches that user: a deal proposed, confirmed by
// either side, declined, switched, withdrawn or expired, or a post created or
// taken down. The agent then reads the resource (or calls get_deal_status), so
// a seller hears "a buyer said yes" without polling.
//
// Subscriptions live in this process, on open connections: a stateful
// Streamable HTTP session (src/mcp/sessions.ts) or any persistent transport.

export const MY_DEALS = "deals://me";
export const MY_POSTS = "posts://me";
export const SUBSCRIBABLE: readonly string[] = [MY_DEALS, MY_POSTS];

export interface Subscriber {
  userId: string;
  uris: Set<string>;
  /** Sends notifications/resources/updated for one URI. */
  send(uri: string): Promise<void>;
}

const byUser = new Map<string, Set<Subscriber>>();
/** Coalesces bursts (a post that pairs logs several events) into one notification per URI. */
const pending = new Map<Subscriber, { uris: Set<string>; timer: NodeJS.Timeout }>();
const COALESCE_MS = 25;

export function subscribe(sub: Subscriber, uri: string) {
  sub.uris.add(uri);
  let subs = byUser.get(sub.userId);
  if (!subs) byUser.set(sub.userId, (subs = new Set()));
  subs.add(sub);
  listen();
}

export function unsubscribe(sub: Subscriber, uri?: string) {
  if (uri) sub.uris.delete(uri);
  else sub.uris.clear();
  if (sub.uris.size) return;
  const subs = byUser.get(sub.userId);
  subs?.delete(sub);
  if (subs && !subs.size) byUser.delete(sub.userId);
  const p = pending.get(sub);
  if (p) clearTimeout(p.timer);
  pending.delete(sub);
}

/** Open subscriptions, for /health and tests. */
export const subscriberCount = () => [...byUser.values()].reduce((n, s) => n + s.size, 0);

/** Tell every subscribed connection of these users that their deals and posts changed. */
export function notifyUsers(userIds: Iterable<string>) {
  for (const userId of userIds) {
    for (const sub of byUser.get(userId) ?? []) {
      let p = pending.get(sub);
      if (!p) {
        const entry = { uris: new Set<string>(), timer: setTimeout(() => flush(sub), COALESCE_MS) };
        entry.timer.unref?.();
        pending.set(sub, (p = entry));
      }
      for (const uri of sub.uris) p.uris.add(uri);
    }
  }
}

function flush(sub: Subscriber) {
  const p = pending.get(sub);
  pending.delete(sub);
  for (const uri of p?.uris ?? []) {
    if (!sub.uris.has(uri)) continue;
    sub.send(uri).catch((err) => log("warn", "resource update not delivered", { uri, err }));
  }
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  marketEvents.on("event", (e: MarketEvent) => {
    if (!byUser.size) return;
    affectedUsers(e)
      .then((users) => notifyUsers(users))
      .catch((err) => log("warn", "could not resolve who an event affects", { kind: e.kind, err }));
  });
}

/** The people whose deals or posts an event changed: the actor, and the owners of every post and deal it names. */
async function affectedUsers(e: MarketEvent) {
  const users = new Set<string>();
  if (e.actorId) users.add(e.actorId);
  const ids = [e.refId, e.detail.released_deal, e.detail.listing_id, e.detail.intent_id, e.detail.to_listing]
    .filter((v): v is string => typeof v === "string");
  const deals = ids.filter((id) => id.startsWith("deal_"));
  const listings = ids.filter((id) => id.startsWith("ofr_"));
  const intents = ids.filter((id) => id.startsWith("req_"));
  if (!deals.length && !listings.length && !intents.length) return users;
  const { rows } = await e.db.query<{ user_id: string }>(
    `SELECT l.seller_id AS user_id FROM deals d JOIN listings l ON l.id = d.listing_id WHERE d.id = ANY($1)
     UNION SELECT i.buyer_id FROM deals d JOIN buy_intents i ON i.id = d.buy_intent_id WHERE d.id = ANY($1)
     UNION SELECT seller_id FROM listings WHERE id = ANY($2)
     UNION SELECT buyer_id FROM buy_intents WHERE id = ANY($3)`,
    [deals, listings, intents],
  );
  for (const r of rows) users.add(r.user_id);
  return users;
}
