// Shared AI types (kept separate from index.ts to avoid circular imports).

export const CONDITIONS = ["for_parts", "fair", "good", "like_new", "new"] as const;
export type Condition = (typeof CONDITIONS)[number];

/** Structured fields pulled out of a free-form request or ambient context. */
export interface ExtractedIntent {
  need: string;
  /** 'service' when someone should do a task: deliver, pick up, run an errand, help at an event. */
  kind?: "item" | "service";
  /** Services: a flat fee per job, or a rate per hour. */
  price_unit?: "job" | "hour";
  /** Hourly work: how long it lasts. */
  hours?: number;
  /** Errands: where to collect from. */
  pickup?: string;
  /** Services: when, as said, e.g. "Saturday 2-6pm" or "today by 12:30". */
  schedule?: string;
  category?: string;
  max_price?: number;
  min_condition?: Condition;
  quantity?: number;
  needed_by?: string; // ISO 8601
  location?: string;
}

export interface Ai {
  readonly mode: "mock" | "bedrock";
  embed(text: string): Promise<number[]>;
  extractIntent(text: string, now?: Date): Promise<ExtractedIntent>;
}
