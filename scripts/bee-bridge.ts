import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

// Bee → PairUp. Forwards the user's own Bee to-dos, conversation
// summaries, voice notes and places to /api/context, where the ones that name a
// need become suggestions ("Your Bee picked up: 'need a graphing calculator
// before the exam'. Want me to find one for up to $18?"). Other people's
// words (raw utterances) are never forwarded.
//
//   npm run bee:bridge                 live: runs `bee stream --json` (after `bee login`)
//   npm run bee:bridge -- --poll       polls the Bee developer API (BEE_API_TOKEN) every 5 minutes
//   npm run bee:bridge -- --replay data/bee-demo-events.jsonl
//                                      replays recorded events in Bee's stream format (demo, no device)
//
// Env: PAIRUP_URL (default http://127.0.0.1:3000), PAIRUP_DEVICE_TOKEN (a "bee"
// device token from the web app's Devices panel; in local development
// PAIRUP_USER_ID works instead), BEE_API_TOKEN and BEE_API_URL for --poll,
// PAIRUP_TIME_ZONE (the wearer's IANA zone; live modes default to this machine's zone,
// a replay keeps the zone already stored for the user).

type Json = Record<string, unknown>;
interface Signal { kind: "todo" | "conversation" | "journal" | "location"; text?: string; place?: string; external_id: string; observed_at?: string }

const PAIRUP = (process.env.PAIRUP_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const BEE_API = (process.env.BEE_API_URL ?? "https://api.developer.bee.amazon.dev").replace(/\/$/, "");
const args = process.argv.slice(2);
const TIME_ZONE = process.env.PAIRUP_TIME_ZONE
  ?? (args.includes("--replay") ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone);

const auth = (): Record<string, string> =>
  process.env.PAIRUP_DEVICE_TOKEN
    ? { Authorization: `Bearer ${process.env.PAIRUP_DEVICE_TOKEN}` }
    : process.env.PAIRUP_USER_ID ? { "X-User-Id": process.env.PAIRUP_USER_ID } : {};

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const short = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
const when = (v: unknown) => (typeof v === "number" ? new Date(v).toISOString() : str(v));

/** One Bee stream event (`bee stream --json`: no event field, identified by its keys) → a signal, or nothing. */
export function toSignal(e: Json): Signal | null {
  const todo = e.todo as Json | undefined;
  if (todo) {
    if (todo.completed === true) return null;
    const text = str(todo.text);
    return text ? { kind: "todo", text, external_id: `todo:${todo.id ?? short(text)}` } : null;
  }
  const journal = e.journal as Json | undefined;
  if (journal) {
    const text = str(journal.text) ?? str(journal.summary);
    return text ? { kind: "journal", text, external_id: `journal:${journal.id ?? short(text)}:${short(text)}` } : null;
  }
  const convo = e.conversation as Json | undefined;
  if (convo) {
    const text = str(convo.short_summary) ?? str(convo.summary);
    if (!text) return null;
    return { kind: "conversation", text, external_id: `conv:${convo.id ?? e.conversation_uuid ?? short(text)}:${short(text)}`, observed_at: when(convo.end_time ?? convo.start_time) };
  }
  const loc = (e.location ?? e.visit) as Json | undefined;
  if (loc) {
    const place = str(loc.name) ?? str(loc.place_name) ?? str(loc.address);
    return place ? { kind: "location", place, external_id: `loc:${short(place)}:${Math.floor(Date.now() / 600_000)}` } : null;
  }
  // new-utterance and anything else: not forwarded.
  return null;
}

async function forward(signals: Signal[]) {
  if (!signals.length) return;
  const res = await fetch(`${PAIRUP}/api/context`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth() },
    body: JSON.stringify({ signals: signals.map((s) => ({ ...s, source: "bee", ...(TIME_ZONE ? { time_zone: TIME_ZONE } : {}) })) }),
  });
  if (!res.ok) {
    console.error(`[bee-bridge] /api/context ${res.status}: ${await res.text()}`);
    return;
  }
  const body = (await res.json()) as { say?: string; results: { duplicate: boolean; suggestion: unknown }[] };
  const fresh = body.results.filter((r) => !r.duplicate).length;
  console.log(`[bee-bridge] sent ${signals.length} (${fresh} new)${body.say ? ` → ${body.say}` : ""}`);
}

async function stream() {
  const types = "todo-created,todo-updated,update-conversation-summary,journal-created,journal-updated,update-location";
  const bee = spawn("bee", ["stream", "--json", "--types", types], { stdio: ["ignore", "pipe", "inherit"], shell: process.platform === "win32" });
  bee.on("error", (err) => {
    console.error(`[bee-bridge] could not run the Bee CLI (${err.message}). Install it and run \`bee login\`, or use --replay.`);
    process.exit(1);
  });
  for await (const line of createInterface({ input: bee.stdout })) await handleLine(line);
}

async function handleLine(line: string) {
  if (!line.trim() || line.startsWith("#")) return;
  try {
    const s = toSignal(JSON.parse(line) as Json);
    if (s) await forward([s]);
  } catch (err) {
    console.error(`[bee-bridge] skipped a line: ${(err as Error).message}`);
  }
}

/** The Bee developer API: open to-dos (and today's summary when available). */
async function poll() {
  const token = process.env.BEE_API_TOKEN;
  if (!token) throw new Error("--poll needs BEE_API_TOKEN");
  const get = async (path: string) => {
    const res = await fetch(`${BEE_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return (await res.json()) as unknown;
  };
  const list = (v: unknown, key: string) => (Array.isArray(v) ? v : ((v as Json)?.[key] as unknown[] | undefined) ?? []) as Json[];
  for (;;) {
    try {
      const todos = list(await get("/v1/todos"), "todos").map((todo) => toSignal({ todo })).filter((s): s is Signal => !!s);
      await forward(todos);
    } catch (err) {
      console.error(`[bee-bridge] poll failed: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 5 * 60_000));
  }
}

async function replay(file: string) {
  console.log(`[bee-bridge] replaying ${file} (recorded in Bee's stream format, not live device data)`);
  for (const line of readFileSync(file, "utf8").split("\n")) await handleLine(line);
}

const i = args.indexOf("--replay");
if (i >= 0) await replay(args[i + 1] ?? "data/bee-demo-events.jsonl");
else if (args.includes("--poll")) await poll();
else await stream();
