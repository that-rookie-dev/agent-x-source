-- Document Templates library: layout masters kept as original binaries.
-- Placeholders use {{field_key}} syntax. Chunking/RAG is intentionally not used.

CREATE TABLE IF NOT EXISTS document_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  storage_id TEXT NOT NULL,
  format TEXT NOT NULL DEFAULT 'other',
  fillable BOOLEAN NOT NULL DEFAULT FALSE,
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_templates_name ON document_templates (name);
CREATE INDEX IF NOT EXISTS idx_document_templates_updated ON document_templates (updated_at DESC);
