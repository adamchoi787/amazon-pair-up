// Schema is applied idempotently on startup. `listings` hold offers and
// `buy_intents` hold requests; either can be an item or a service.
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
  status          TEXT NOT NULL DEFAULT 'proposed', -- proposed | confirmed | declined | replaced | expired | withdrawn
  buyer_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  seller_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  meetup          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Added after the first release; kept as ALTERs so existing databases upgrade in place.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS deals_open_idx ON deals (status, expires_at);
CREATE INDEX IF NOT EXISTS deals_listing_idx ON deals (listing_id, status);
CREATE INDEX IF NOT EXISTS deals_intent_idx ON deals (buy_intent_id, status);
CREATE INDEX IF NOT EXISTS listings_seller_idx ON listings (seller_id, created_at);
CREATE INDEX IF NOT EXISTS listings_status_idx ON listings (status);
CREATE INDEX IF NOT EXISTS intents_buyer_idx ON buy_intents (buyer_id, created_at);
CREATE INDEX IF NOT EXISTS intents_status_idx ON buy_intents (status);

-- Services. A post is an item or a service. Items are priced each, services per
-- job (a lunch run) or per hour (event help), and only posts of the same kind
-- and unit are paired. A service request can add the expected hours (hourly
-- work), where to pick something up (errands) and when the job happens.
ALTER TABLE listings    ADD COLUMN IF NOT EXISTS kind       TEXT NOT NULL DEFAULT 'item';
ALTER TABLE listings    ADD COLUMN IF NOT EXISTS price_unit TEXT NOT NULL DEFAULT 'each';
ALTER TABLE buy_intents ADD COLUMN IF NOT EXISTS kind       TEXT NOT NULL DEFAULT 'item';
ALTER TABLE buy_intents ADD COLUMN IF NOT EXISTS price_unit TEXT NOT NULL DEFAULT 'each';
ALTER TABLE buy_intents ADD COLUMN IF NOT EXISTS hours      NUMERIC(5,2);
ALTER TABLE buy_intents ADD COLUMN IF NOT EXISTS pickup     TEXT;
ALTER TABLE buy_intents ADD COLUMN IF NOT EXISTS schedule   TEXT;

-- Price check (src/market/pricing.ts). Reference prices for typical second-hand
-- ranges; each offer keeps the range it was checked against, and price_flag
-- records a price the person confirmed although it was far outside it.
CREATE TABLE IF NOT EXISTS reference_prices (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  price_unit  TEXT NOT NULL,
  title       TEXT NOT NULL,
  low         NUMERIC(10,2) NOT NULL,
  high        NUMERIC(10,2) NOT NULL,
  hash        TEXT NOT NULL,                      -- re-embed only when an entry changes
  embedding   vector(${embeddingDim})
);
-- new_price: items only, the typical price new on Amazon.com (the Amazon fallback).
ALTER TABLE reference_prices ADD COLUMN IF NOT EXISTS new_price NUMERIC(10,2);
-- ref_source: reference | trades. price_flag: far_below | far_above.
ALTER TABLE listings    ADD COLUMN IF NOT EXISTS ref_low    NUMERIC(10,2);
ALTER TABLE listings    ADD COLUMN IF NOT EXISTS ref_high   NUMERIC(10,2);
ALTER TABLE listings    ADD COLUMN IF NOT EXISTS ref_source TEXT;
ALTER TABLE listings    ADD COLUMN IF NOT EXISTS price_flag TEXT;
ALTER TABLE buy_intents ADD COLUMN IF NOT EXISTS price_flag TEXT;

-- One offer below the asking price per buyer and listing. Once a budget below
-- the ask fails, that buyer gets the listing only at the asking price, so
-- retrying with rising budgets can't find the seller's minimum.
CREATE TABLE IF NOT EXISTS failed_offers (
  listing_id  TEXT NOT NULL REFERENCES listings(id),
  buyer_id    TEXT NOT NULL REFERENCES users(id),
  offered     NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id, buyer_id)
);

-- Learning to pair better (src/market/learning.ts). What the engine saw when it
-- proposed each deal, and the ranking models trained on how those deals ended.
-- ranking_models.status: champion | retired | rejected | rolled_back.
CREATE TABLE IF NOT EXISTS pairing_features (
  deal_id        TEXT PRIMARY KEY REFERENCES deals(id),
  arm            TEXT NOT NULL,
  model_version  INTEGER,
  predicted      DOUBLE PRECISION,
  baseline       DOUBLE PRECISION NOT NULL,
  features       JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ranking_models (
  version     SERIAL PRIMARY KEY,
  bias        DOUBLE PRECISION NOT NULL,
  weights     JSONB NOT NULL,
  metrics     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Retry-safe writes (src/market/idempotency.ts): the first result for each
-- caller's idempotency_key, replayed to retries for 24 hours.
CREATE TABLE IF NOT EXISTS idempotent_calls (
  user_id     TEXT NOT NULL,
  key         TEXT NOT NULL,
  tool        TEXT NOT NULL,
  args_hash   TEXT NOT NULL,
  result      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idempotent_calls_age_idx ON idempotent_calls (created_at);

-- Append-only audit trail; powers the dashboard.
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  actor_id    TEXT,
  ref_id      TEXT,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OAuth 2.1 account linking (src/auth/oauth.ts). Only SHA-256 hashes of codes
-- and tokens are stored, never the raw values.
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash       TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL,
  user_id         TEXT NOT NULL REFERENCES users(id),
  redirect_uri    TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,
  scope           TEXT NOT NULL,
  resource        TEXT,
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash      TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,                  -- access | refresh
  client_id       TEXT NOT NULL,
  user_id         TEXT NOT NULL REFERENCES users(id),
  scope           TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked         BOOLEAN NOT NULL DEFAULT FALSE
);
`;
