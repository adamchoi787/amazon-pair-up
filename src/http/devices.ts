import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { runVoiceTurn } from "../agent/runner.js";
import { createDeviceToken, DEVICE_KINDS, deviceForToken, listDevices, revokeDevice } from "../auth/devices.js";
import type { Config } from "../config.js";
import { addContext, getSuggestions, rememberTimeZone, SIGNAL_KINDS, SIGNAL_SOURCES } from "../market/context.js";
import { ensureUser, MarketError, type Deps } from "../market/service.js";
import { log } from "./log.js";
import { rateLimit } from "./rateLimit.js";

// Devices that know what the user needs:
//   POST /api/voice     words in, a sentence out: the Apple Watch Shortcut
//                       ("Hey Siri, PairUp") and phone automations
//   POST /api/context   context in: Bee to-dos and summaries (scripts/bee-bridge.ts),
//                       "arrived at Hall 5" from a Shortcut automation
//   /api/devices        create (shown once), list and revoke device tokens; web app only
// /api/voice and /api/context take a device token or the web app's own sign-in.

/** The signed-in user from the web app's credentials (OAuth token, or X-User-Id locally). */
export type UserCaller = (req: Request) => Promise<{ ok: true; userId?: string } | { ok: false }>;

const signal = z.object({
  source: z.enum(SIGNAL_SOURCES).optional(),
  kind: z.enum(SIGNAL_KINDS),
  text: z.string().max(2000).optional(),
  place: z.string().max(120).optional(),
  observed_at: z.string().max(40).optional(),
  external_id: z.string().max(128).optional(),
  time_zone: z.string().max(64).optional(),
});
const contextBody = z.union([z.object({ signals: z.array(signal).min(1).max(20) }), signal]);
const voiceBody = z.object({
  text: z.string().trim().min(1).max(1000),
  conversation_id: z.string().max(64).optional(),
  time_zone: z.string().max(64).optional(),
});
const newDevice = z.object({ kind: z.enum(DEVICE_KINDS), label: z.string().max(40).optional() });

export function deviceRouter(deps: Deps, cfg: Config, userCaller: UserCaller): Router {
  const r = express.Router();
  r.use(["/api/voice", "/api/context", "/api/devices"], rateLimit(cfg.mcpCallsPerMinute));

  /** A device token first, then the web app's sign-in. */
  async function who(req: Request): Promise<{ userId: string; deviceId?: string; kind?: string } | null> {
    const device = await deviceForToken(deps.db, req.headers.authorization);
    if (device) return { userId: device.user_id, deviceId: device.id, kind: device.kind };
    const u = await userCaller(req);
    return u.ok && u.userId ? { userId: u.userId } : null;
  }

  const fail = (res: Response, status: number, error: string) => res.status(status).json({ error, say: error });

  r.post("/api/voice", async (req, res) => {
    const caller = await who(req);
    if (!caller) return fail(res, 401, "This device isn't connected. Create a device token in the PairUp app.");
    const body = voiceBody.safeParse(req.body);
    if (!body.success) return fail(res, 400, "Say what you need.");
    try {
      await ensureUser(deps.db, caller.userId);
      await rememberTimeZone(deps.db, caller.userId, body.data.time_zone);
      const key = `${caller.deviceId ?? caller.userId}:${body.data.conversation_id ?? "default"}`;
      const reply = await runVoiceTurn(deps, cfg, caller.userId, key, body.data.text);
      res.set("Cache-Control", "no-store").json(reply);
    } catch (err) {
      log("error", "voice turn failed", { requestId: res.locals.requestId, err });
      fail(res, 500, "Sorry, something went wrong on my side. Please try again.");
    }
  });

  r.post("/api/context", async (req, res) => {
    const caller = await who(req);
    if (!caller) return fail(res, 401, "This device isn't connected.");
    const body = contextBody.safeParse(req.body);
    if (!body.success) return fail(res, 400, body.error.issues[0]?.message ?? "invalid context");
    const items = "signals" in body.data ? body.data.signals : [body.data];
    const fallback = (caller.kind ?? "phone") as (typeof SIGNAL_SOURCES)[number];
    try {
      const results = [];
      for (const s of items) {
        const source = s.source ?? (SIGNAL_SOURCES.includes(fallback) ? fallback : "phone");
        results.push(await addContext(deps, caller.userId, { ...s, source }));
      }
      const fresh = results.filter((x) => x.suggestion && !x.duplicate);
      // Arriving somewhere can make a routine due: then answer with what is worth saying now.
      const arrived = !fresh.length && items.some((s) => s.kind === "location");
      const now = arrived ? (await getSuggestions(deps, caller.userId)).suggestions : [];
      res.set("Cache-Control", "no-store").json({
        results,
        suggestions: fresh.length ? fresh.map((x) => x.suggestion) : now,
        say: fresh[0]?.suggestion?.say ?? now[0]?.say ?? "",
      });
    } catch (err) {
      if (err instanceof MarketError) return fail(res, 400, err.message);
      log("error", "context failed", { requestId: res.locals.requestId, err });
      fail(res, 500, "Sorry, something went wrong.");
    }
  });

  // Device tokens are managed from a signed-in web session only, never with a device token.
  const signedIn = async (req: Request) => {
    const u = await userCaller(req);
    return u.ok && u.userId ? u.userId : null;
  };
  r.get("/api/devices", async (req, res) => {
    const userId = await signedIn(req);
    if (!userId) return fail(res, 401, "Sign in first.");
    res.set("Cache-Control", "no-store").json({ devices: await listDevices(deps.db, userId) });
  });
  r.post("/api/devices", async (req, res) => {
    const userId = await signedIn(req);
    if (!userId) return fail(res, 401, "Sign in first.");
    const body = newDevice.safeParse(req.body);
    if (!body.success) return fail(res, 400, "kind must be watch, bee or phone");
    try {
      const d = await createDeviceToken(deps.db, userId, body.data.kind, body.data.label ?? defaultLabel(body.data.kind));
      res.set("Cache-Control", "no-store").status(201).json({ ...d, endpoints: { voice: `${base(req, cfg)}/api/voice`, context: `${base(req, cfg)}/api/context` } });
    } catch (err) {
      fail(res, (err as { status?: number }).status ?? 500, (err as Error).message);
    }
  });
  r.delete("/api/devices/:id", async (req, res) => {
    const userId = await signedIn(req);
    if (!userId) return fail(res, 401, "Sign in first.");
    const ok = await revokeDevice(deps.db, userId, String(req.params.id));
    res.status(ok ? 200 : 404).json({ revoked: ok });
  });
  return r;
}

const defaultLabel = (k: string) => (k === "watch" ? "Apple Watch" : k === "bee" ? "Bee" : "Phone");
const base = (req: Request, cfg: Config) => cfg.publicBaseUrl || `${req.protocol}://${req.header("host")}`;
