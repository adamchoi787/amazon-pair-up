// Captures every product frame in the film from the real app.
//
//   node scripts/video/studio/capture/capture.mjs [step ...]
//
// It resets a disposable market (.data/video-capture), starts the server with
// AUTH_MODE=none and mock AI on port 3310, then drives the app with Playwright at
// phone size (430x932, 3x) and saves PNGs to scripts/video/studio/public/assets/cap/.
// The process clock is set to FAKE_NOW (a weekday, 11:38 AM Pacific) so the lunch
// routine is offered the way it is before noon. Ring arrivals use the signed local
// webhook (scripts/ring-simulate.ts); Bee context uses the labelled replay fixture.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../../../..");
const OUT = resolve(here, "../public/assets/cap");
const PORT = 3310;
const BASE = `http://127.0.0.1:${PORT}`;
const FAKE_NOW = process.env.FAKE_NOW ?? "2026-10-22T11:38:00-07:00";
const ENV = {
  ...process.env,
  PORT: String(PORT),
  PGLITE_DIR: ".data/video-capture",
  AI_MODE: "mock",
  AUTH_MODE: "none",
  TZ: "America/Los_Angeles",
  RING_HMAC_KEY: "video-local-test-key",
  RING_POINT_DEVICES: "pt_uw_hub=video_doorbell_hub",
  FAKE_NOW,
  NODE_OPTIONS: `--import=${pathToUrl(join(here, "fake-clock.mjs"))}`,
};
const steps = process.argv.slice(2);
const want = (s) => steps.length === 0 || steps.includes(s);

function pathToUrl(p) {
  return "file:///" + p.replace(/\\/g, "/");
}

function run(cmd, args, env = ENV) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env, shell: true, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

async function waitHealth() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Matches the deployed app: the local-only mode badge is hidden; scrollbars are hidden.
const CLEAN_CSS = `#mode{display:none!important} ::-webkit-scrollbar{display:none} *{scrollbar-width:none} *{caret-color:transparent!important}`;

async function phone(browser, user, device, extra = "") {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, colorScheme: "dark", timezoneId: "America/Los_Angeles" });
  await ctx.clock.install({ time: new Date(FAKE_NOW) });
  await ctx.clock.resume();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/app/?device=${device}&as=${encodeURIComponent(user)}${extra}`);
  await page.addStyleTag({ content: CLEAN_CSS });
  await page.getByRole("textbox", { name: "Message" }).waitFor();
  await sleep(1200);
  return page;
}

async function shot(page, name, opts = {}) {
  await page.addStyleTag({ content: CLEAN_CSS }).catch(() => {});
  for (const f of page.frames()) await f.addStyleTag({ content: CLEAN_CSS }).catch(() => {});
  await page.screenshot({ path: join(OUT, `${name}.png`), ...opts });
  console.log("  saved", name);
}

/** Type a request in steps, saving the composer at each step, then send it. */
async function say(page, name, text, frames = 10) {
  const box = page.getByRole("textbox", { name: "Message" });
  await box.click();
  for (let i = 1; i <= frames; i++) {
    const upto = Math.round((text.length * i) / frames);
    await box.fill(text.slice(0, upto));
    await shot(page, `${name}_type${String(i).padStart(2, "0")}`);
  }
  await box.press("Enter");
}

/** The newest card frame, once its text includes `text`. */
async function card(page, text, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    for (const f of page.frames().reverse()) {
      if (f === page.mainFrame()) continue;
      const body = await f.textContent("body").catch(() => "");
      if (body && body.includes(text)) return f;
    }
    await sleep(250);
  }
  await page.screenshot({ path: join(OUT, `debug_${text.replace(/\W+/g, "_")}.png`) });
  throw new Error(`card with "${text}" not found`);
}

async function settle(page, ms = 1500) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(ms);
}

async function cardShot(page, frame, name) {
  const el = await frame.frameElement();
  await el.scrollIntoViewIfNeeded();
  await sleep(400);
  await el.screenshot({ path: join(OUT, `${name}.png`), omitBackground: true });
  console.log("  saved", name);
}

async function watchPage(browser, name, device) {
  const watch = await browser.newContext({ viewport: { width: 220, height: 270 }, deviceScaleFactor: 4, colorScheme: "dark", timezoneId: "America/Los_Angeles" });
  await watch.clock.install({ time: new Date(FAKE_NOW) });
  await watch.clock.resume();
  const w = await watch.newPage();
  await w.goto(`${BASE}/watch/?device=${device}&as=${encodeURIComponent(name)}`);
  await settle(w, 1500);
  const box = w.getByPlaceholder("Your name");
  if (await box.isVisible().catch(() => false)) {
    await box.fill(name);
    await box.press("Enter");
    await settle(w, 3000);
  }
  await w.addStyleTag({ content: CLEAN_CSS });
  return w;
}

function ring(type = "button_press") {
  run("npx", ["tsx", "scripts/ring-simulate.ts", "--type", type], { ...ENV, PAIRUP_URL: BASE });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log("reset market");
  run("npx", ["tsx", "scripts/seed.ts", "--reset", "--lifestyle"]);
  console.log("start server");
  const server = spawn("npx", ["tsx", "src/index.ts"], { cwd: ROOT, env: ENV, shell: true, stdio: "ignore" });
  try {
    await waitHealth();
    const browser = await chromium.launch();

    if (want("calc")) {
      console.log("calculator");
      const sam = await phone(browser, "Sam", "video-sam");
      await shot(sam, "sam_home");
      await say(sam, "sam", "Sell my TI-84 for $20. I'll take anything above $15.");
      await settle(sam);
      const samCard = await card(sam, "nobody else sees it");
      await settle(sam, 800);
      await shot(sam, "sam_listed");
      await cardShot(sam, samCard, "card_sam_listing");

      const mei = await phone(browser, "Mei", "video-mei");
      await shot(mei, "mei_home");
      await say(mei, "mei", "I need a graphing calculator in good condition near UW campus today, max $18.");
      await settle(mei);
      let meiCard = await card(mei, "Confirm $18");
      await settle(mei, 800);
      await shot(mei, "mei_match");
      await cardShot(mei, meiCard, "card_mei_match");

      await meiCard.getByRole("button", { name: /PairUp Point/ }).click();
      await settle(mei);
      meiCard = await card(mei, "PairUp Point with Ring");
      await shot(mei, "mei_point");
      await cardShot(mei, meiCard, "card_mei_point");

      await meiCard.getByRole("button", { name: /Confirm \$18/ }).click();
      await settle(mei, 2000);
      meiCard = await card(mei, "PairUp Point");
      await shot(mei, "mei_confirmed");
      await cardShot(mei, meiCard, "card_mei_confirmed");

      // Sam's limit was his yes: the deal is already agreed on his side.
      await sam.reload();
      await sam.addStyleTag({ content: CLEAN_CSS });
      await settle(sam, 1500);
      await sam.getByRole("tab", { name: /Deals/ }).click();
      await settle(sam, 2500);
      let samDeal = await card(sam, "Both sides agreed");
      await shot(sam, "sam_agreed");
      await cardShot(sam, samDeal, "card_sam_agreed");

      // Ring: each person checks in; the doorbell event confirms the arrival.
      console.log("ring");
      await mei.reload();
      await mei.addStyleTag({ content: CLEAN_CSS });
      await settle(mei, 1500);
      await mei.getByRole("tab", { name: /Deals/ }).click();
      await settle(mei, 2500);
      meiCard = await card(mei, "I'm here");
      await cardShot(mei, meiCard, "card_ring_0_ontheway");
      await shot(mei, "mei_ring_0");
      await meiCard.getByRole("button", { name: /I'm here/ }).click();
      await settle(mei, 1500);
      meiCard = await card(mei, "PairUp Point");
      await cardShot(mei, meiCard, "card_ring_1_checkedin");
      ring();
      await sleep(800);
      await meiCard.getByRole("button", { name: /I'm here/ }).click().catch(() => {});
      await settle(mei, 2000);
      meiCard = await card(mei, "PairUp Point");
      await cardShot(mei, meiCard, "card_ring_2_meiconfirmed");
      await shot(mei, "mei_ring_2");

      await sam.reload();
      await sam.addStyleTag({ content: CLEAN_CSS });
      await settle(sam, 1500);
      await sam.getByRole("tab", { name: /Deals/ }).click();
      await settle(sam, 2500);
      samDeal = await card(sam, "I'm here");
      await samDeal.getByRole("button", { name: /I'm here/ }).click();
      await settle(sam, 1200);
      ring();
      await sleep(800);
      await samDeal.getByRole("button", { name: /I'm here/ }).click().catch(() => {});
      await settle(sam, 2000);
      samDeal = await card(sam, "Both here");
      await cardShot(sam, samDeal, "card_ring_3_bothhere_sam");
      await shot(sam, "sam_bothhere");
      await mei.reload();
      await mei.addStyleTag({ content: CLEAN_CSS });
      await settle(mei, 1500);
      await mei.getByRole("tab", { name: /Deals/ }).click();
      await settle(mei, 2500);
      meiCard = await card(mei, "Both here");
      await cardShot(mei, meiCard, "card_ring_3_bothhere_mei");
      await shot(mei, "mei_bothhere");

      const w = await watchPage(browser, "Mei", "video-mei-watch");
      await shot(w, "watch_mei_bothhere");
    }

    if (want("services")) {
      console.log("services");
      const priya = await phone(browser, "Priya", "video-priya");
      await say(priya, "priya", "I can do lunch runs on campus for $4 a run", 6);
      await settle(priya);
      const run = await card(priya, "$4");
      await cardShot(priya, run, "card_priya_lunchruns");
      const tony = await phone(browser, "Tony", "video-tony");
      await say(tony, "tony", "Find someone to pick up my lunch from the HUB to McCarty Hall by 12:30, $5", 8);
      await settle(tony);
      const lunch = await card(tony, "McCarty");
      await settle(tony, 800);
      await shot(tony, "tony_lunch");
      await cardShot(tony, lunch, "card_lunch");
      const org = await phone(browser, "Ava", "video-event");
      await say(org, "event", "Get me a helper for the event on Saturday 2-6pm, $10 an hour", 8);
      await settle(org);
      const ev = await card(org, "$40");
      await settle(org, 800);
      await shot(org, "event_offer");
      await cardShot(org, ev, "card_event");
    }

    if (want("context")) {
      console.log("context");
      // The labelled fixture's exam event only, so the watch opens on it.
      const NL = String.fromCharCode(10);
      const fixture = readFileSync(join(ROOT, "data/bee-demo-events.jsonl"), "utf8").split(NL).filter((l) => l.startsWith("#") || l.includes("graphing calculator") || l.includes("McCarty"));
      mkdirSync(join(ROOT, "video/build"), { recursive: true });
      writeFileSync(join(ROOT, "video/build/bee-exam.jsonl"), fixture.join(NL) + NL);
      run("npx", ["tsx", "scripts/bee-bridge.ts", "--replay", "video/build/bee-exam.jsonl"], { ...ENV, PAIRUP_URL: BASE, PAIRUP_USER_ID: "u_tony" });
      const tony = await phone(browser, "Tony", "video-tony-2");
      await settle(tony, 2500);
      await shot(tony, "tony_foryou_0");
      await tony.locator("#for-you .fy-toggle").click();
      await sleep(700);
      await shot(tony, "tony_foryou_1");
      const dock = tony.locator("#for-you");
      await dock.screenshot({ path: join(OUT, "dock_1.png") });
      for (let i = 2; i <= 4; i++) {
        const next = tony.getByRole("button", { name: "Next suggestion" });
        if (!(await next.isVisible().catch(() => false)) || (await next.isDisabled())) break;
        await next.click();
        await sleep(600);
        await shot(tony, `tony_foryou_${i}`);
        await dock.screenshot({ path: join(OUT, `dock_${i}.png`) });
      }
      const w = await watchPage(browser, "Tony", "video-tony-watch");
      await shot(w, "watch_tony_suggestion");
      const budget = w.getByPlaceholder(/maximum/i);
      if (await budget.isVisible().catch(() => false)) {
        await budget.fill("18");
        await shot(w, "watch_tony_budget");
        await budget.press("Enter");
        await settle(w, 2500);
        await shot(w, "watch_tony_after");
      }
    }

    if (want("tech")) {
      console.log("tech");
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
      const d = await ctx.newPage();
      await d.goto(`${BASE}/dashboard/`);
      await settle(d, 3000);
      await shot(d, "dashboard");
      // The real MCP tool list, for the engineering scene.
      const init = await fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-User-Id": "u_video" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "video", version: "1" } } }),
      });
      const sid = init.headers.get("mcp-session-id");
      const list = await fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "X-User-Id": "u_video", ...(sid ? { "mcp-session-id": sid, "mcp-protocol-version": "2025-11-25" } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });
      const text = await list.text();
      const json = JSON.parse(text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:")).slice(5));
      const tools = json.result.tools.map((t) => ({ name: t.name, title: t.title ?? "" }));
      writeFileSync(join(here, "../src/generated/tools.json"), JSON.stringify(tools, null, 1));
      console.log("  tools:", tools.length);
    }
    await browser.close();
  } finally {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { shell: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
