-- Document Studio binders, answer sets, and mappings (spec §5.4, §5.9).

CREATE TABLE IF NOT EXISTS doc_binders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_binders_name ON doc_binders (name);

CREATE TABLE IF NOT EXISTS doc_answer_sets (
  id TEXT PRIMARY KEY,
  values JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS doc_mappings (
  id TEXT PRIMARY KEY,
  data_master_id TEXT NOT NULL,
  schema_ref TEXT NOT NULL,
  entries JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
