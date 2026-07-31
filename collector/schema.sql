-- Applied at DEPLOY time, not by whichever request happens to arrive first.
--
-- The Worker used to run this DDL inside the POST handler, which meant /health
-- queried a table that did not exist until somebody posted an event -- and the
-- deploy's own verification caught exactly that on the first real run. Creating
-- schema lazily from a request handler also costs a round trip on every batch,
-- and makes the first request after a schema change the one that silently
-- repairs it.
CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY,
  site          TEXT NOT NULL,
  received_at   TEXT NOT NULL,
  v             INTEGER NOT NULL,
  event         TEXT NOT NULL,
  sid           TEXT NOT NULL,
  first_seen    TEXT,
  visit_n       INTEGER,
  path          TEXT,
  t_ms          INTEGER,
  viewport      TEXT,
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  referrer_host TEXT,
  props         TEXT
);
CREATE INDEX IF NOT EXISTS idx_site_time ON events(site, received_at);
