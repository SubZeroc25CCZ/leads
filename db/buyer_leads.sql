-- LeadMachine FL — buyer-side capture table
-- Run against: leadmachine-db  (bce5b2af-1852-4aa0-a084-ecba3d3f3933)
--   wrangler d1 execute leadmachine-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS buyer_leads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  counties    TEXT,
  volume      TEXT,
  source      TEXT DEFAULT 'landing',
  referrer    TEXT,
  ip          TEXT,
  user_agent  TEXT,
  status      TEXT DEFAULT 'new',   -- new | sample_sent | customer | dead
  requests    INTEGER DEFAULT 1,
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_buyer_leads_status  ON buyer_leads(status);
CREATE INDEX IF NOT EXISTS idx_buyer_leads_created ON buyer_leads(created_at DESC);

-- Daily working queue: who is still owed a sample.
--   SELECT email, counties, volume, created_at
--   FROM buyer_leads WHERE status='new' ORDER BY created_at;
