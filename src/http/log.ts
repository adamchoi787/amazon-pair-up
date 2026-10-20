import { randomUUID } from "node:crypto";
import type express from "express";

// Logs and metrics in one place. LOG_FORMAT=json writes one JSON object per
// line, the shape CloudWatch Logs Insights queries directly; metric lines carry
// an Embedded Metric Format block, so CloudWatch turns them into metrics
// (namespace AmazonPairUp) without an agent or an API call. LOG_FORMAT=text
// (the default) keeps local output readable.

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const json = () => process.env.LOG_FORMAT === "json";
export const METRIC_NAMESPACE = "AmazonPairUp";

export function log(level: Level, msg: string, fields: Fields = {}) {
  const line = json()
    ? JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }, errorReplacer)
    : `[${level}] ${msg}${Object.keys(fields).length ? " " + JSON.stringify(fields, errorReplacer) : ""}`;
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

/**
 * One measured event: a log line that is also a CloudWatch metric. `dims` are
 * the metric's dimensions (keep them low-cardinality, e.g. a tool name);
 * `values` are the measurements, in milliseconds when the name ends in "Ms".
 * With text logs, `text: false` leaves the line out (the access line says enough).
 */
export function metric(
  msg: string, dims: Record<string, string>, values: Record<string, number>, fields: Fields = {}, opts: { text?: boolean } = {},
) {
  if (!json()) {
    if (opts.text !== false) log("info", msg, { ...dims, ...values, ...fields });
    return;
  }
  const _aws = {
    Timestamp: Date.now(),
    CloudWatchMetrics: [{
      Namespace: METRIC_NAMESPACE,
      Dimensions: [Object.keys(dims)],
      Metrics: Object.keys(values).map((name) => ({ Name: name, Unit: name.endsWith("Ms") ? "Milliseconds" : "Count" })),
    }],
  };
  console.log(JSON.stringify({ time: new Date().toISOString(), level: "info", msg, _aws, ...dims, ...values, ...fields }, errorReplacer));
}

function errorReplacer(_key: string, value: unknown) {
  return value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
}

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Every request gets an id: the caller's X-Request-Id when it looks like one
 * (CloudFront, Alexa and agents can pass theirs through), otherwise a new one.
 * It is echoed in the response and attached to every log line for the request.
 */
export const requestId: express.RequestHandler = (req, res, next) => {
  const given = req.header("x-request-id");
  const id = given && SAFE_ID.test(given) ? given : randomUUID();
  res.locals.requestId = id;
  res.set("X-Request-Id", id);
  next();
};

/** One access line (and latency metric) per call, to watch the Alexa+ budget (< 500 ms round trip). */
export const accessLog = (route: string): express.RequestHandler => (req, res, next) => {
  const start = performance.now();
  res.on("finish", () => {
    const body = req.body as { method?: string; params?: { name?: string } } | undefined;
    metric(
      "request",
      { Route: route },
      { LatencyMs: Math.round(performance.now() - start), ServerErrors: res.statusCode >= 500 ? 1 : 0 },
      { requestId: res.locals.requestId, method: body?.method ?? req.method, tool: body?.params?.name, status: res.statusCode },
    );
  });
  next();
};
