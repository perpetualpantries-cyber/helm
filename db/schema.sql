-- Canopy data layer: one Postgres database (Neon) shared by every agent layer.
--   Gavin  (per site)   reads rows filtered by site_id
--   Ronin  (per client) reads rows filtered by client_id
--   Canopy (all)        reads the rollup views
--   Helm                reads Canopy's summary endpoint
-- Cafés never talk to agents directly; they write here via POST /api/ingest.

CREATE TABLE IF NOT EXISTS clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES clients(id),
  name               text NOT NULL,
  timezone           text NOT NULL DEFAULT 'Australia/Sydney',
  -- sha256 of the site's ingest token; the raw token is shown once at creation
  ingest_token_hash  text NOT NULL UNIQUE,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sites_client_id_idx ON sites (client_id);

-- One row per site per trading day, written by the café's end-of-day close.
-- Re-sending a day overwrites it, so the PP app can safely retry.
CREATE TABLE IF NOT EXISTS daily_site_metrics (
  site_id        uuid NOT NULL REFERENCES sites(id),
  business_date  date NOT NULL,
  revenue        numeric(12,2) NOT NULL DEFAULT 0,
  costs          numeric(12,2) NOT NULL DEFAULT 0,
  covers         integer NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, business_date)
);

-- Raw event log: every ingest call lands here, including types that have no
-- dedicated table yet (waste logs, stock counts, ...).
CREATE TABLE IF NOT EXISTS events (
  id           bigserial PRIMARY KEY,
  site_id      uuid NOT NULL REFERENCES sites(id),
  type         text NOT NULL,
  occurred_at  timestamptz NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_site_time_idx ON events (site_id, occurred_at DESC);

-- Ronin-level rollup: a client's sites summed per day.
CREATE OR REPLACE VIEW client_daily_metrics AS
SELECT s.client_id,
       m.business_date,
       sum(m.revenue)          AS revenue,
       sum(m.costs)            AS costs,
       sum(m.covers)           AS covers,
       count(DISTINCT m.site_id) AS reporting_sites
FROM daily_site_metrics m
JOIN sites s ON s.id = m.site_id
GROUP BY s.client_id, m.business_date;
