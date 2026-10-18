// Shared AI types (kept separate from index.ts to avoid circular imports).

export const CONDITIONS = ["for_parts", "fair", "good", "like_new", "new"] as const;
export type Condition = (typeof CONDITIONS)[number];

/** Structured fields pulled out of a free-form request or ambient context. */
export interface ExtractedIntent {
  need: string;
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
