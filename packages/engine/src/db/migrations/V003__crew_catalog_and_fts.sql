-- Crew Hub catalog tables, full-text search, and crew metadata columns.
-- Previously created by runPgCrewCatalogMigration() in postgres-crew-catalog.ts.

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
  hub_revision    INTEGER NOT NULL DEFAULT 1,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_metadata (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_crew_preferences (
  session_id              TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  suggestions_dismissed   BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_at            TIMESTAMPTZ,
  last_suggestion_at      TIMESTAMPTZ,
  last_suggestion_turn_id TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_catalog_category ON crew_catalog(category_id);
CREATE INDEX IF NOT EXISTS idx_crew_catalog_callsign ON crew_catalog(callsign);
CREATE INDEX IF NOT EXISTS idx_crew_catalog_active ON crew_catalog(active);

-- Crew metadata columns
ALTER TABLE crews ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'custom';
ALTER TABLE crews ADD COLUMN IF NOT EXISTS catalog_id TEXT;
ALTER TABLE crews ADD COLUMN IF NOT EXISTS search_text TEXT NOT NULL DEFAULT '';
ALTER TABLE crews ADD COLUMN IF NOT EXISTS suggestable BOOLEAN NOT NULL DEFAULT TRUE;

-- Full-text search columns (generated tsvector)
DO $$ BEGIN
  ALTER TABLE crew_catalog ADD COLUMN search_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(search_text, ''))) STORED;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE crews ADD COLUMN search_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(search_text, ''))) STORED;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_crew_catalog_tsv ON crew_catalog USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_crews_tsv ON crews USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_crews_source ON crews(source);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crews_catalog_id ON crews(catalog_id) WHERE catalog_id IS NOT NULL;

-- Legacy _schema table for backward compatibility (records v20 marker)
CREATE TABLE IF NOT EXISTS _schema (
  version     INTEGER PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO _schema (version) VALUES (20) ON CONFLICT (version) DO NOTHING;
