-- Mixtape audit log (plan.md section 35.5). Safe to run more than once.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,            -- sessionId from the client
  visitor_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,    -- server time, ms
  last_seen_at INTEGER NOT NULL,
  ip TEXT NOT NULL,
  country TEXT, region TEXT, city TEXT, asn INTEGER, as_org TEXT,
  user_agent TEXT, browser TEXT, os TEXT, device_type TEXT, device_model TEXT,
  screen TEXT, language TEXT, time_zone TEXT, referrer TEXT
);
CREATE INDEX IF NOT EXISTS sessions_visitor ON sessions (visitor_id, started_at);
CREATE INDEX IF NOT EXISTS sessions_ip ON sessions (ip, started_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  visitor_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  client_ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  ip TEXT NOT NULL,               -- repeated: the address can change mid-session
  type TEXT NOT NULL,
  track_id TEXT,
  listened_sec REAL,
  reason TEXT,
  detail TEXT,                    -- JSON for the remaining fields
  UNIQUE (session_id, seq)        -- makes retried batches idempotent
);
CREATE INDEX IF NOT EXISTS events_track ON events (track_id, received_at);
CREATE INDEX IF NOT EXISTS events_type ON events (type, received_at);
CREATE INDEX IF NOT EXISTS events_visitor ON events (visitor_id, received_at);

CREATE TABLE IF NOT EXISTS tracks (  -- every link ever added or played, with details
  track_id TEXT PRIMARY KEY,
  source TEXT, provider TEXT, kind TEXT,
  url TEXT, external_id TEXT,
  title TEXT, artist TEXT, duration REAL, cover TEXT,
  file_name TEXT, bytes INTEGER, mime TEXT,
  first_seen_at INTEGER NOT NULL, first_visitor_id TEXT, first_ip TEXT,
  last_seen_at INTEGER NOT NULL,
  add_count INTEGER NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  listened_sec REAL NOT NULL DEFAULT 0
);
