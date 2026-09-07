-- Automation, notifications, articles, knowledge base, pgvector, voice realtime state,
-- document templates, document studio, and voice call / host security tables.
--
-- This is the final clean baseline. All objects use CREATE ... IF NOT EXISTS.

-- ─── Automation ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS automation_tasks (
  id TEXT PRIMARY KEY,
  task_key TEXT,
  display_id TEXT,
  title TEXT NOT NULL,
  instruction TEXT NOT NULL,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once', 'recurring')),
  cron_expression TEXT,
  run_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'active',
  source_channel TEXT NOT NULL DEFAULT 'web',
  source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  notify_channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
  permission_snapshot JSONB,
  pgboss_job_id TEXT,
  pgboss_schedule_name TEXT,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  next_run_at TIMESTAMPTZ,
  run_count INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_tasks_status ON automation_tasks(status);
CREATE INDEX IF NOT EXISTS idx_automation_tasks_session ON automation_tasks(source_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_tasks_active_key ON automation_tasks(task_key) WHERE task_key IS NOT NULL AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_tasks_display_id ON automation_tasks(display_id) WHERE display_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS automation_run_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES automation_tasks(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  level TEXT NOT NULL,
  label TEXT NOT NULL,
  detail TEXT,
  event_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_run_logs_task_created ON automation_run_logs(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_automation_run_logs_run ON automation_run_logs(run_id, created_at);

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES automation_tasks(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'schedule',
  status TEXT NOT NULL,
  coalesced BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_task_started ON automation_runs(task_id, started_at DESC);

CREATE TABLE IF NOT EXISTS automation_session_confirmations (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmation_note TEXT
);

-- ─── Notifications ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES automation_tasks(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB,
  channels JSONB NOT NULL DEFAULT '["in_app"]'::jsonb,
  delivery_status JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at) WHERE read_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_active ON notifications(created_at DESC) WHERE dismissed_at IS NULL;

-- ─── Articles ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  message_id TEXT,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'article',
  source_role TEXT,
  compile_error TEXT,
  list_day_key TEXT,
  list_day_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_session ON articles(session_id, created_at DESC);

-- ─── Knowledge base ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  storage_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  summary TEXT,
  chunk_count INTEGER,
  page_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_sources_session ON knowledge_sources(session_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_status ON knowledge_sources(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_created_at ON knowledge_sources(created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, index)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source ON knowledge_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source_index ON knowledge_chunks(source_id, index);

CREATE TABLE IF NOT EXISTS knowledge_pages (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  embedding JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_pages_source ON knowledge_pages(source_id);

CREATE TABLE IF NOT EXISTS knowledge_source_status_events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_status_events_source ON knowledge_source_status_events(source_id);

-- ─── pgvector (optional — app degrades to in-memory store if unavailable) ────

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS knowledge_chunk_vectors (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata JSONB,
      embedding vector(1536)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_vectors_source ON knowledge_chunk_vectors(source_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunk_vectors_embedding ON knowledge_chunk_vectors USING ivfflat (embedding vector_cosine_ops);
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

-- ─── Voice realtime state ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS voice_realtime_state (
  session_id TEXT PRIMARY KEY,
  xai_conversation_id TEXT,
  xai_conversation_updated_at TIMESTAMPTZ,
  last_voice_active_at TIMESTAMPTZ,
  summary TEXT,
  summary_updated_at TIMESTAMPTZ,
  summary_source_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_realtime_last_active ON voice_realtime_state (last_voice_active_at DESC NULLS LAST);

-- ─── Document templates ─────────────────────────────────────────────────────

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
  analysis_status TEXT NOT NULL DEFAULT 'ready',
  analysis_error TEXT,
  design_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_templates_name ON document_templates (name);
CREATE INDEX IF NOT EXISTS idx_document_templates_updated ON document_templates (updated_at DESC);

-- ─── Document Studio ────────────────────────────────────────────────────────

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
  step_results JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  cancelled BOOLEAN NOT NULL DEFAULT false,
  cancelled_at TIMESTAMPTZ,
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

-- ─── Voice call domain ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS voice_call_missions (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  provider_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL,
  recipient_e164 TEXT,
  purpose TEXT NOT NULL,
  system_context TEXT,
  allowed_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  forbidden_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_tool_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  require_confirmation_for JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_duration_seconds INTEGER NOT NULL DEFAULT 600,
  max_cost_minor_units INTEGER,
  recording TEXT NOT NULL DEFAULT 'off',
  ai_disclosure TEXT NOT NULL DEFAULT 'required',
  escalation JSONB NOT NULL DEFAULT '{}'::jsonb,
  stop_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_call_missions_status
  ON voice_call_missions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS voice_call_sessions (
  id TEXT PRIMARY KEY,
  mission_id TEXT REFERENCES voice_call_missions(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  provider_call_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  state TEXT NOT NULL DEFAULT 'created',
  from_e164_redacted TEXT,
  to_e164_redacted TEXT,
  phone_number_id TEXT,
  idempotency_key TEXT,
  cost_minor_units INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  outcome TEXT,
  outcome_summary TEXT,
  recording_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_call_sessions_provider_call
  ON voice_call_sessions(provider_id, provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_call_sessions_idempotency
  ON voice_call_sessions(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voice_call_sessions_state
  ON voice_call_sessions(state, updated_at DESC);

CREATE TABLE IF NOT EXISTS voice_call_events (
  id TEXT PRIMARY KEY,
  call_session_id TEXT NOT NULL REFERENCES voice_call_sessions(id) ON DELETE CASCADE,
  provider_event_id TEXT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_call_events_provider_event
  ON voice_call_events(call_session_id, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voice_call_events_session
  ON voice_call_events(call_session_id, occurred_at ASC);

CREATE TABLE IF NOT EXISTS voice_call_consents (
  id TEXT PRIMARY KEY,
  e164_hash TEXT NOT NULL,
  e164_redacted TEXT NOT NULL,
  consent_type TEXT NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_call_consents_hash
  ON voice_call_consents(e164_hash, consent_type);

CREATE TABLE IF NOT EXISTS voice_call_provider_bindings (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  provider_number_id TEXT,
  e164 TEXT,
  e164_redacted TEXT,
  label TEXT,
  inbound_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  outbound_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_call_bindings_provider
  ON voice_call_provider_bindings(provider_id);

CREATE TABLE IF NOT EXISTS host_security_events (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_host_security_events_created
  ON host_security_events(created_at DESC);
