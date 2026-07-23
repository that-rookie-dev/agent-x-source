-- Document Studio job checkpoint / cancel columns.
ALTER TABLE doc_jobs ADD COLUMN IF NOT EXISTS step_results JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE doc_jobs ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE doc_jobs ADD COLUMN IF NOT EXISTS cancelled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE doc_jobs ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
