-- Design brief for templates: how the master looks / is structured (not just blank fields).

ALTER TABLE document_templates
  ADD COLUMN IF NOT EXISTS design_summary TEXT;
