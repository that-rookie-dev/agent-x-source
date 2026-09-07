-- Engineering Crew: persist partial code/test documents in phase rows for resume.

ALTER TABLE engineering_crew_phases
  ADD COLUMN IF NOT EXISTS code_document TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS test_document TEXT NOT NULL DEFAULT '{}';
