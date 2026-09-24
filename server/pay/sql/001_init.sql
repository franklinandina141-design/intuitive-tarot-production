-- Pay ledger schema for 女巫的牌桌 (witchtable.cn)
-- Applied automatically when DATABASE_URL is set (see store-pg.mjs).
-- On Render: add the Postgres addon, then set DATABASE_URL from the addon.

CREATE TABLE IF NOT EXISTS pay_users (
  openid TEXT PRIMARY KEY,
  credits INTEGER NOT NULL DEFAULT 0,
  free_granted INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS pay_sessions (
  token TEXT PRIMARY KEY,
  openid TEXT NOT NULL REFERENCES pay_users(openid) ON DELETE CASCADE,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS pay_sessions_openid_idx ON pay_sessions(openid);

CREATE TABLE IF NOT EXISTS pay_orders (
  order_id TEXT PRIMARY KEY,
  openid TEXT NOT NULL REFERENCES pay_users(openid) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  price_fen INTEGER NOT NULL,
  credits INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at BIGINT NOT NULL,
  paid_at BIGINT
);

CREATE INDEX IF NOT EXISTS pay_orders_openid_idx ON pay_orders(openid);
CREATE INDEX IF NOT EXISTS pay_orders_status_idx ON pay_orders(status);

CREATE TABLE IF NOT EXISTS pay_notify_handled (
  order_id TEXT PRIMARY KEY,
  at BIGINT NOT NULL,
  source TEXT NOT NULL DEFAULT ''
);

-- Schema version marker (single-row table)
CREATE TABLE IF NOT EXISTS pay_schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO pay_schema_meta(key, value)
VALUES ('version', '1')
ON CONFLICT (key) DO NOTHING;
