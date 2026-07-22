-- Track LLM field-discovery status for raw uploaded templates.

ALTER TABLE document_templates
  ADD COLUMN IF NOT EXISTS analysis_status TEXT NOT NULL DEFAULT 'ready';

ALTER TABLE document_templates
  ADD COLUMN IF NOT EXISTS analysis_error TEXT;
