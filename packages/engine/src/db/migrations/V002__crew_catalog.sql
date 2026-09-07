-- Crew Hub catalog tables, full-text search, and session preferences.
-- Crew catalog data is seeded at application level from crew-catalog.manifest.json
-- (see catalog-seed-runner.ts) — no seed data in SQL.
--
-- This is the final clean baseline. All objects use CREATE ... IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS crew_catalog (
  id              TEXT PRIMARY KEY,
  callsign        TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  category_id     TEXT NOT NULL,
  category_label  TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  system_prompt   TEXT NOT NULL DEFAULT '',
  tone            TEXT,
  expertise       TEXT,
  traits          TEXT,
  tools           TEXT,
  tags            TEXT,
  search_text     TEXT NOT NULL DEFAULT '',
  search_tsv      tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(search_text, ''))) STORED,
  certifications  TEXT[] NOT NULL DEFAULT '{}',
  hub_revision    INTEGER NOT NULL DEFAULT 1,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_catalog_category ON crew_catalog(category_id);
CREATE INDEX IF NOT EXISTS idx_crew_catalog_callsign ON crew_catalog(callsign);
CREATE INDEX IF NOT EXISTS idx_crew_catalog_active ON crew_catalog(active);
CREATE INDEX IF NOT EXISTS idx_crew_catalog_tsv ON crew_catalog USING GIN (search_tsv);

-- ─── App metadata (key-value store for catalog revision, etc.) ──────────────

CREATE TABLE IF NOT EXISTS app_metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ─── Session crew preferences (suggestion dismissal tracking) ───────────────

CREATE TABLE IF NOT EXISTS session_crew_preferences (
  session_id              TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  suggestions_dismissed   BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_at            TIMESTAMPTZ,
  last_suggestion_at      TIMESTAMPTZ,
  last_suggestion_turn_id TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
