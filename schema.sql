-- D1 Schema for CZGS

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
  query_id TEXT PRIMARY KEY,
  datetime TEXT,
  src_country TEXT,
  src_country_code TEXT,
  source_ip TEXT,
  resolved_ips TEXT
);
CREATE INDEX IF NOT EXISTS idx_datetime ON logs(datetime);

CREATE TABLE IF NOT EXISTS dns_timeseries (
  bucket_ts INTEGER PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dns_ts_bucket ON dns_timeseries(bucket_ts);

CREATE TABLE IF NOT EXISTS dns_top_domains (
  bucket_ts INTEGER NOT NULL,
  domain TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_ts, domain)
);
CREATE INDEX IF NOT EXISTS idx_dns_domains_bucket ON dns_top_domains(bucket_ts);

CREATE TABLE IF NOT EXISTS dns_top_locations (
  bucket_ts INTEGER NOT NULL,
  location TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_ts, location)
);
CREATE INDEX IF NOT EXISTS idx_dns_locations_bucket ON dns_top_locations(bucket_ts);

CREATE TABLE IF NOT EXISTS dns_resolver_decisions (
  bucket_ts INTEGER NOT NULL,
  decision TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_ts, decision)
);
CREATE INDEX IF NOT EXISTS idx_dns_decisions_bucket ON dns_resolver_decisions(bucket_ts);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  last_synced_ts INTEGER,
  oldest_synced_ts INTEGER
);

CREATE TABLE IF NOT EXISTS traffic_map_sources (
  country TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS traffic_map_destinations (
  country TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS traffic_map_routes (
  source_country TEXT NOT NULL,
  destination_country TEXT NOT NULL,
  source_lat REAL NOT NULL,
  source_lng REAL NOT NULL,
  destination_lat REAL NOT NULL,
  destination_lng REAL NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_country, destination_country)
);

CREATE TABLE IF NOT EXISTS traffic_map_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS traffic_map_daily_snapshots (
  day TEXT PRIMARY KEY,
  total_queries INTEGER NOT NULL,
  source_count INTEGER NOT NULL,
  destination_count INTEGER NOT NULL,
  route_count INTEGER NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traffic_map_daily_snapshots_day ON traffic_map_daily_snapshots(day);
