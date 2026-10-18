// Schema is applied idempotently on startup. Owner: B (marketplace engine).
// Private limits (min_price / max_price) live here and must never be returned
// to the counterparty — see src/market/views.ts.

export const schemaSql = (embeddingDim: number) => `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  home_area     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id            TEXT PRIMARY KEY,
  seller_id     TEXT NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT,
  condition     TEXT NOT NULL DEFAULT 'good',   -- new | like_new | good | fair | for_parts
  quantity      INTEGER NOT NULL DEFAULT 1,
  currency      TEXT NOT NULL DEFAULT 'USD',
  ask_price     NUMERIC(10,2) NOT NULL,         -- public
  min_price     NUMERIC(10,2) NOT NULL,         -- PRIVATE reserve, never shown to buyers
  auto_accept   BOOLEAN NOT NULL DEFAULT TRUE,  -- seller pre-authorised deals >= min_price
  location      TEXT,
  availability  TEXT,
  status        TEXT NOT NULL DEFAULT 'active', -- active | pending | sold | withdrawn
  embedding     vector(${embeddingDim}),
  search_tsv    tsvector GENERATED ALWAYS AS (
                  to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(category,''))
                ) STORED,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_tsv_idx ON listings USING gin (search_tsv);

CREATE TABLE IF NOT EXISTS buy_intents (
  id            TEXT PRIMARY KEY,
  buyer_id      TEXT NOT NULL REFERENCES users(id),
  need          TEXT NOT NULL,                  -- normalised description of what they need
  raw_request   TEXT,                           -- original utterance / context, if any
  source        TEXT NOT NULL DEFAULT 'voice',  -- voice | bee_context
  category      TEXT,
  min_condition TEXT NOT NULL DEFAULT 'for_parts',
  quantity      INTEGER NOT NULL DEFAULT 1,
  currency      TEXT NOT NULL DEFAULT 'USD',
  max_price     NUMERIC(10,2) NOT NULL,         -- PRIVATE budget, never shown to sellers
  needed_by     TIMESTAMPTZ,
  location      TEXT,
  status        TEXT NOT NULL DEFAULT 'open',   -- open | matched | fulfilled | cancelled
  embedding     vector(${embeddingDim}),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deals (
  id              TEXT PRIMARY KEY,
  listing_id      TEXT NOT NULL REFERENCES listings(id),
  buy_intent_id   TEXT NOT NULL REFERENCES buy_intents(id),
  price           NUMERIC(10,2) NOT NULL,
  currency        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'proposed', -- proposed | confirmed | declined
  buyer_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  seller_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  meetup          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only audit trail; powers the judge dashboard.
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  actor_id    TEXT,
  ref_id      TEXT,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
