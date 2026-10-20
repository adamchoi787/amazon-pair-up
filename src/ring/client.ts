// Ring Partner API client (https://developer.amazon.com/docs/ring/api-documentation.html).
// PairUp Points read two things from Ring: which devices the account has, and
// the Event History of the device watching a point. Both are server-to-server
// calls with a Bearer token: a Playground token (developer.amazon.com/ring/console/playground,
// valid 30 minutes) for development, or an account-linked app token in production.
// Responses are JSON:API. No video, snapshots or audio are ever requested.

export const RING_API_BASE = "https://api.amazonvision.com";

export interface RingDevice { id: string; name: string }

/** One Event History entry. event_type: motion | ding | on_demand (a live view). */
export interface RingHistoryEvent { id: string; device_id: string; event_type: string; start: number; end: number | null }

export class RingApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type Fetch = typeof fetch;

interface JsonApiResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: { source?: { data?: { id?: string } } };
}
interface JsonApiDoc { data?: JsonApiResource[]; links?: { next?: string | null } }

export class RingClient {
  private readonly base: string;
  private readonly fetchFn: Fetch;

  constructor(private readonly token: string, opts: { apiBase?: string; fetch?: Fetch } = {}) {
    this.base = (opts.apiBase || RING_API_BASE).replace(/\/$/, "");
    this.fetchFn = opts.fetch ?? fetch;
  }

  /** GET /v1/devices: the cameras, doorbells and sensors this token can see. */
  async devices(): Promise<RingDevice[]> {
    const doc = await this.get("/v1/devices");
    return (doc.data ?? []).map((d) => ({ id: d.id, name: String(d.attributes?.name ?? d.id) }));
  }

  /**
   * GET /v1/history/devices/{id}/events, newest first, following links.next.
   * Stops at the first event older than `since` (epoch ms) or after `maxPages`.
   * `eventTypes` is sent as Ring's event_types filter and applied here as well.
   */
  async history(deviceId: string, opts: { since?: number; eventTypes?: string[]; maxPages?: number } = {}): Promise<RingHistoryEvent[]> {
    const filter = opts.eventTypes?.length ? `?event_types=${encodeURIComponent(opts.eventTypes.join(","))}` : "";
    let path: string | null = `/v1/history/devices/${encodeURIComponent(deviceId)}/events${filter}`;
    const out: RingHistoryEvent[] = [];
    for (let page = 0; path && page < (opts.maxPages ?? 3); page++) {
      const doc = await this.get(path);
      for (const e of doc.data ?? []) {
        const start = Number(e.attributes?.start);
        if (!Number.isFinite(start)) continue;
        if (opts.since != null && start < opts.since) return out;
        const type = String(e.attributes?.event_type ?? "");
        if (opts.eventTypes?.length && !opts.eventTypes.some((t) => t.split(".")[0] === type)) continue;
        const end = Number(e.attributes?.end);
        out.push({ id: e.id, device_id: e.relationships?.source?.data?.id ?? deviceId, event_type: type, start, end: Number.isFinite(end) ? end : null });
      }
      path = doc.links?.next ?? null;
    }
    return out;
  }

  private async get(path: string): Promise<JsonApiDoc> {
    const url = path.startsWith("http") ? path : `${this.base}${path.startsWith("/") ? "" : "/"}${path}`;
    if (new URL(url).origin !== new URL(this.base).origin) throw new RingApiError("Ring returned a link to another host", 502);
    const res = await this.fetchFn(url, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.api+json, application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const hint = res.status === 401 ? "the Ring token is invalid or expired" : res.status === 429 ? "Ring rate limit reached" : `Ring API returned ${res.status}`;
      throw new RingApiError(hint, res.status);
    }
    return (await res.json()) as JsonApiDoc;
  }
}
