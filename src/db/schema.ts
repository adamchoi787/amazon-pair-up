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
-- Items change hands at a Hub point ('meetup') or by Amazon Hub delivery
-- ('delivery', src/market/amazon.ts). The deal keeps its own copy, set by the buyer.
ALTER TABLE buy_intents ADD COLUMN IF NOT EXISTS handoff    TEXT NOT NULL DEFAULT 'meetup';
ALTER TABLE deals       ADD COLUMN IF NOT EXISTS handoff    TEXT NOT NULL DEFAULT 'meetup';
ALTER TABLE deals       ADD COLUMN IF NOT EXISTS delivery_ref TEXT;
-- Natural-language schedules are retained for speech; concrete work windows
-- are stored separately for availability and overlap checks. Existing rows
-- are interpreted conservatively from their original creation time.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'America/Los_Angeles';
ALTER TABLE buy_intents ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'America/Los_Angeles';
ALTER TABLE buy_intents ADD COLUMN IF NOT EXISTS service_start TIMESTAMPTZ;
ALTER TABLE buy_intents ADD COLUMN IF NOT EXISTS service_end TIMESTAMPTZ;

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

-- Trust and safety (src/market/policy.ts, src/market/trust.ts).
-- policy_examples: phrases per prohibited category, embedded to catch posts by
-- meaning. reports: one open report per reporter and reported user; a reporter
-- and the person they reported are never paired. ratings: 1-5 stars per side
-- of a confirmed deal; they feed the track records the ranking uses.
-- users.review_status: active | under_review (enough people reported them;
-- not paired until a reviewer decides) | suspended.
CREATE TABLE IF NOT EXISTS policy_examples (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL,
  text        TEXT NOT NULL,
  hash        TEXT NOT NULL,
  embedding   vector(${embeddingDim})
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS reviewed_at   TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  reporter_id  TEXT NOT NULL REFERENCES users(id),
  reported_id  TEXT NOT NULL REFERENCES users(id),
  reason       TEXT NOT NULL,
  deal_id      TEXT REFERENCES deals(id),
  post_id      TEXT,
  details      TEXT,
  status       TEXT NOT NULL DEFAULT 'open',      -- open | dismissed | upheld
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS reports_open_idx ON reports (reporter_id, reported_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS reports_reported_idx ON reports (reported_id, status);
CREATE TABLE IF NOT EXISTS ratings (
  deal_id      TEXT NOT NULL REFERENCES deals(id),
  rater_id     TEXT NOT NULL REFERENCES users(id),
  ratee_id     TEXT NOT NULL REFERENCES users(id),
  ratee_role   TEXT NOT NULL,                     -- buyer | seller: the role of the person rated
  stars        INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, rater_id)
);
CREATE INDEX IF NOT EXISTS ratings_ratee_idx ON ratings (ratee_id, ratee_role);

-- Append-only audit trail; powers the dashboard.
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  actor_id    TEXT,
  ref_id      TEXT,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_ref_actor_idx ON events (ref_id, actor_id, kind);

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
-- One grant per authorization: the tokens from one code and all their refreshes.
-- Revoking a refresh token (RFC 7009) revokes the whole grant.
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS grant_id TEXT;
CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens (grant_id);

-- Clients registered through RFC 7591 dynamic registration (public, PKCE only).
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id       TEXT PRIMARY KEY,
  client_name     TEXT,
  redirect_uris   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Authorization requests waiting for Login with Amazon to come back.
CREATE TABLE IF NOT EXISTS oauth_pending (
  state_hash      TEXT PRIMARY KEY,
  request         JSONB NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL
);

-- Name + passcode sign-in (local development and the judge demo only).
CREATE TABLE IF NOT EXISTS user_passcodes (
  user_id         TEXT PRIMARY KEY REFERENCES users(id),
  passcode_hash   TEXT NOT NULL
);

-- Knowing what people need (src/market/lifestyle.ts, src/market/context.ts).
-- Each user's time zone places their routines in their own day. Context
-- signals are short snippets from Bee, a watch or a phone (a to-do, a
-- conversation summary, "arrived at McCarty Hall"); one that names a need becomes a
-- suggestion the user accepts with a yes. Snippets are deleted after 30 days.
ALTER TABLE users ADD COLUMN IF NOT EXISTS time_zone TEXT;
CREATE TABLE IF NOT EXISTS context_signals (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  source       TEXT NOT NULL,                   -- bee | watch | phone | agent
  kind         TEXT NOT NULL,                   -- todo | conversation | journal | fact | location | note
  external_id  TEXT,
  text         TEXT,
  place        TEXT,
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status       TEXT NOT NULL DEFAULT 'new',     -- new | suggested | accepted | dismissed | ignored
  suggestion   JSONB,
  request_id   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS context_signals_ext_idx ON context_signals (user_id, source, external_id);
CREATE INDEX IF NOT EXISTS context_signals_user_idx ON context_signals (user_id, status, observed_at);

-- What the user did with a routine suggestion: accepted, dismissed, or forget (never suggest it again).
CREATE TABLE IF NOT EXISTS routine_feedback (
  user_id     TEXT NOT NULL REFERENCES users(id),
  routine_id  TEXT NOT NULL,
  action      TEXT NOT NULL,
  day         TEXT NOT NULL,                     -- the user's local date the suggestion was for
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, routine_id, day, action)
);

-- Long-lived, revocable tokens for a watch Shortcut or the Bee bridge. They
-- reach only /api/voice and /api/context; only SHA-256 hashes are stored.
CREATE TABLE IF NOT EXISTS device_tokens (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL REFERENCES users(id),
  label         TEXT NOT NULL,
  kind          TEXT NOT NULL,                   -- watch | bee | phone
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked       BOOLEAN NOT NULL DEFAULT FALSE
);
`;
