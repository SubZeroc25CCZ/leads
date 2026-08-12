-- LeadMachine D1 schema (database: leadmachine-db, id bce5b2af-1852-4aa0-a084-ecba3d3f3933)
-- Recovered verbatim from the live database on 2026-08-12.

CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_ref TEXT UNIQUE,
  owner_name TEXT,
  property_address TEXT,
  address_key TEXT,
  city TEXT,
  county TEXT,
  state TEXT DEFAULT 'FL',
  zip TEXT,
  phone TEXT,
  email TEXT,
  est_value INTEGER DEFAULT 0,
  signals TEXT DEFAULT '[]',
  score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'new',
  source TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE buyers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  company TEXT,
  email TEXT,
  phone TEXT,
  vertical TEXT DEFAULT 'cash_buyer',
  states TEXT DEFAULT '[]',
  counties TEXT DEFAULT '[]',
  zip_codes TEXT DEFAULT '[]',
  min_value INTEGER DEFAULT 0,
  max_value INTEGER DEFAULT 0,
  price_per_lead REAL DEFAULT 0,
  status TEXT DEFAULT 'prospect',
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id INTEGER,
  lead_ids TEXT DEFAULT '[]',
  type TEXT DEFAULT 'sample',
  price_total REAL DEFAULT 0,
  delivered_at TEXT,
  notes TEXT
);

CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  county TEXT,
  state TEXT,
  signal TEXT,
  url_template TEXT,   -- ArcGIS/Socrata query URL with {cutoff_date} placeholder (YYYY-MM-DD)
  field_map TEXT,      -- JSON: {"owner": "<src field>", "address": "...", "city": "...", "zip": "..."} (address required)
  lookback_days INTEGER DEFAULT 30,
  enabled INTEGER DEFAULT 1,
  created_at TEXT
);

CREATE TABLE harvest_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT,
  fetched INTEGER,
  inserted INTEGER,
  merged INTEGER,
  skipped INTEGER,
  ok INTEGER,
  note TEXT,
  ran_at TEXT
);
