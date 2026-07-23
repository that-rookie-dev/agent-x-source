-- Document Studio masters: immutable input objects + honest analysis (spec §5.1).

CREATE TABLE IF NOT EXISTS doc_masters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'layout',
  format TEXT NOT NULL DEFAULT 'other',
  mime_type TEXT NOT NULL,
  storage_id TEXT NOT NULL,
  checksum TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  analysis JSONB,
  analysis_state TEXT NOT NULL DEFAULT 'pending',
  analysis_error TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_masters_kind ON doc_masters (kind);
CREATE INDEX IF NOT EXISTS idx_doc_masters_updated ON doc_masters (updated_at DESC);
