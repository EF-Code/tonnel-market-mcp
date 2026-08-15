export const migration = {
  version: 1,
  name: "initial marketplace ledger and projections",
  sql: `
CREATE TABLE IF NOT EXISTS raw_events (
  event_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  receive_sequence INTEGER NOT NULL,
  raw_payload TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('processed', 'failed')),
  correlation_id TEXT NOT NULL,
  processed_at TEXT,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS raw_events_occurred_at_idx ON raw_events (occurred_at, receive_sequence);
CREATE INDEX IF NOT EXISTS raw_events_type_idx ON raw_events (type, occurred_at);

CREATE TABLE IF NOT EXISTS checkpoints (
  name TEXT PRIMARY KEY,
  event_id TEXT,
  occurred_at TEXT,
  committed_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('replay', 'websocket', 'manual'))
);

CREATE TABLE IF NOT EXISTS coverage_intervals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('available', 'gap')),
  from_at TEXT,
  to_at TEXT,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS coverage_intervals_time_idx
  ON coverage_intervals (from_at, to_at, kind);

CREATE TABLE IF NOT EXISTS gifts (
  gift_id INTEGER PRIMARY KEY,
  gift_num INTEGER NOT NULL,
  gift_name TEXT NOT NULL,
  model TEXT NOT NULL,
  backdrop TEXT NOT NULL,
  symbol TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_event_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS gifts_name_idx ON gifts (gift_name, gift_num);
CREATE INDEX IF NOT EXISTS gifts_traits_idx ON gifts (model, backdrop, symbol);

CREATE TABLE IF NOT EXISTS listing_observations (
  event_id TEXT PRIMARY KEY,
  gift_id INTEGER,
  gift_num INTEGER,
  gift_name TEXT,
  model TEXT,
  backdrop TEXT,
  symbol TEXT,
  observation_type TEXT NOT NULL CHECK (observation_type IN ('created', 'price_changed', 'cancelled', 'promoted', 'promotion_ended')),
  price TEXT,
  previous_price TEXT,
  asset TEXT,
  sale_type TEXT,
  promotion_target TEXT,
  auction_id TEXT,
  dutch_json TEXT,
  occurred_at TEXT NOT NULL,
  raw_data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS listing_observations_gift_idx
  ON listing_observations (gift_id, occurred_at);
CREATE INDEX IF NOT EXISTS listing_observations_price_idx
  ON listing_observations (asset, price, occurred_at);

CREATE TABLE IF NOT EXISTS sale_facts (
  event_id TEXT PRIMARY KEY,
  gift_id INTEGER,
  gift_num INTEGER NOT NULL,
  gift_name TEXT NOT NULL,
  model TEXT NOT NULL,
  backdrop TEXT NOT NULL,
  symbol TEXT NOT NULL,
  price TEXT NOT NULL,
  asset TEXT NOT NULL,
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  raw_data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sale_facts_gift_idx ON sale_facts (gift_id, occurred_at);
CREATE INDEX IF NOT EXISTS sale_facts_asset_idx ON sale_facts (asset, occurred_at);

CREATE TABLE IF NOT EXISTS auctions (
  auction_id TEXT PRIMARY KEY,
  gift_id INTEGER,
  gift_json TEXT NOT NULL,
  starting_bid TEXT,
  asset TEXT,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CANCELLED', 'SOLD', 'NO_BIDS', 'UNKNOWN')),
  latest_bid TEXT,
  latest_bid_asset TEXT,
  bid_count INTEGER NOT NULL DEFAULT 0,
  winning_bid TEXT,
  created_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  cancelled_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS auctions_gift_idx ON auctions (gift_id, ends_at);
CREATE INDEX IF NOT EXISTS auctions_status_idx ON auctions (status, ends_at);

CREATE TABLE IF NOT EXISTS auction_bids (
  event_id TEXT PRIMARY KEY,
  auction_id TEXT NOT NULL,
  gift_id INTEGER NOT NULL,
  amount TEXT NOT NULL,
  asset TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  raw_data TEXT NOT NULL,
  FOREIGN KEY (auction_id) REFERENCES auctions (auction_id)
);

CREATE INDEX IF NOT EXISTS auction_bids_auction_idx ON auction_bids (auction_id, occurred_at);

CREATE TABLE IF NOT EXISTS buy_offers (
  event_id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  gift_id INTEGER NOT NULL,
  gift_json TEXT NOT NULL,
  observation_type TEXT NOT NULL CHECK (observation_type IN ('created', 'countered', 'accepted', 'rejected', 'cancelled')),
  price TEXT,
  original_price TEXT,
  counter_price TEXT,
  asset TEXT NOT NULL,
  stage TEXT,
  occurred_at TEXT NOT NULL,
  raw_data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS buy_offers_offer_idx ON buy_offers (offer_id, occurred_at);
CREATE INDEX IF NOT EXISTS buy_offers_gift_idx ON buy_offers (gift_id, occurred_at);

CREATE TABLE IF NOT EXISTS premarket_facts (
  event_id TEXT PRIMARY KEY,
  gift_id INTEGER NOT NULL,
  gift_json TEXT NOT NULL,
  observation_type TEXT NOT NULL CHECK (observation_type IN ('listing_created', 'sale_completed', 'listing_cancelled', 'settled')),
  price TEXT,
  price_with_fee TEXT,
  previous_price TEXT,
  amount TEXT,
  asset TEXT NOT NULL,
  status TEXT,
  occurred_at TEXT NOT NULL,
  raw_data TEXT NOT NULL,
  FOREIGN KEY (gift_id) REFERENCES gifts (gift_id)
);

CREATE INDEX IF NOT EXISTS premarket_facts_gift_idx ON premarket_facts (gift_id, occurred_at);

CREATE TABLE IF NOT EXISTS bundles (
  event_id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL,
  gift_ids_json TEXT NOT NULL,
  observation_type TEXT NOT NULL CHECK (observation_type IN ('created', 'debundled')),
  occurred_at TEXT NOT NULL,
  raw_data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS bundles_bundle_idx ON bundles (bundle_id, occurred_at);

CREATE TABLE IF NOT EXISTS trades (
  event_id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL,
  offer_id TEXT,
  observation_type TEXT NOT NULL CHECK (observation_type IN ('created', 'offer_created', 'completed', 'cancelled')),
  gift_ids_json TEXT NOT NULL,
  requested_gift_ids_json TEXT,
  offered_gift_ids_json TEXT,
  amount TEXT,
  asset TEXT,
  requested_amount TEXT,
  requested_asset TEXT,
  offered_amount TEXT,
  offered_asset TEXT,
  occurred_at TEXT NOT NULL,
  raw_data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS trades_trade_idx ON trades (trade_id, occurred_at);

CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  rule_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL,
  event_id TEXT,
  matched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE (rule_id, event_id),
  FOREIGN KEY (rule_id) REFERENCES alert_rules (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS alert_hits_rule_idx ON alert_hits (rule_id, matched_at);

CREATE TABLE IF NOT EXISTS collector_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  collector_started_at TEXT NOT NULL,
  websocket_state TEXT NOT NULL CHECK (websocket_state IN ('idle', 'connecting', 'buffering', 'connected', 'backoff', 'stopped')),
  last_server_time TEXT,
  last_received_at TEXT,
  last_committed_event_id TEXT,
  last_committed_at TEXT,
  replay_state TEXT NOT NULL CHECK (replay_state IN ('idle', 'running', 'expired_cursor', 'failed', 'completed')),
  last_replay_started_at TEXT,
  last_replay_completed_at TEXT,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  unknown_event_count INTEGER NOT NULL DEFAULT 0,
  processing_error_count INTEGER NOT NULL DEFAULT 0,
  cursor_expiry_count INTEGER NOT NULL DEFAULT 0,
  full_snapshot INTEGER NOT NULL DEFAULT 0 CHECK (full_snapshot IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`,
} as const;
