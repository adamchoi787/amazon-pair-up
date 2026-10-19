import { createHash } from "node:crypto";
import type { RequestHandler } from "express";

// Fixed-window limit per caller. The caller is the bearer token when there is
// one, else the X-User-Id header, else the client IP. State is per process: on
// several instances each one enforces the limit on its own share of traffic.

export function rateLimit(perMinute: number): RequestHandler {
  const windows = new Map<string, { start: number; count: number }>();
  let lastPrune = Date.now();

  return (req, res, next) => {
    if (perMinute <= 0) return next();
    const now = Date.now();
    if (now - lastPrune > 60_000) {
      for (const [k, w] of windows) if (now - w.start >= 60_000) windows.delete(k);
      lastPrune = now;
    }
    const caller = req.header("authorization") ?? req.header("x-user-id") ?? req.ip ?? "unknown";
    const key = createHash("sha256").update(caller).digest("base64url");
    const w = windows.get(key);
    if (!w || now - w.start >= 60_000) {
      windows.set(key, { start: now, count: 1 });
      return next();
    }
    if (++w.count <= perMinute) return next();
    const retry = Math.ceil((w.start + 60_000 - now) / 1000);
    res.status(429).set("Retry-After", String(retry)).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: `Too many requests. Try again in ${retry} seconds.` },
      id: null,
    });
  };
}
