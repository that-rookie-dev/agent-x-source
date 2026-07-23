-- Document Studio jobs, instance plans, artifacts, and manifests (spec §14).

CREATE TABLE IF NOT EXISTS doc_jobs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  spec JSONB NOT NULL,
  recipe_id TEXT,
  binder_id TEXT,
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  progress_detail TEXT,
  artifacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  manifest_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_jobs_status ON doc_jobs (status);
CREATE INDEX IF NOT EXISTS idx_doc_jobs_updated ON doc_jobs (updated_at DESC);

CREATE TABLE IF NOT EXISTS doc_instances (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  index INTEGER NOT NULL,
  binding_set_id TEXT,
  path TEXT,
  master_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_doc_instances_job ON doc_instances (job_id);

CREATE TABLE IF NOT EXISTS doc_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  instance_index INTEGER,
  path TEXT NOT NULL,
  storage_id TEXT,
  format TEXT NOT NULL,
  checksum TEXT NOT NULL,
  binding_set_id TEXT,
  evidence_map JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_artifacts_job ON doc_artifacts (job_id);

CREATE TABLE IF NOT EXISTS doc_manifests (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary_ok INTEGER NOT NULL DEFAULT 0,
  summary_failed INTEGER NOT NULL DEFAULT 0,
  summary_skipped INTEGER NOT NULL DEFAULT 0
);
