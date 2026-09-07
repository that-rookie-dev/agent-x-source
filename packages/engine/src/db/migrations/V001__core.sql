-- Core schema: sessions, child_sessions, messages, message_parts, token_logs, checkpoints,
-- session_crew_states, tool_executions, session_events, permission_rules, agent_tasks, crews,
-- crew_feedback, turn_feedback, session_resume_state, bot_credentials, agent_persona,
-- task_snapshots, agent_experiences, agent_growth_state, agent_emotions, agent_emotional_state,
-- agent_memories, agent_diary, agent_identity, background_tasks.
--
-- This is the final clean baseline. All objects use CREATE ... IF NOT EXISTS; no historical
-- ALTER TABLE / DROP TABLE / DROP CONSTRAINT corrections remain.

-- Ensure pgcrypto is available for gen_random_uuid() (built-in on PG 13+).
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgcrypto extension not available: %', SQLERRM;
END $$;

-- ─── Sessions ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New Session',
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  scope_path TEXT NOT NULL,
  parent_id TEXT REFERENCES sessions(id),
  token_used INTEGER DEFAULT 0,
  token_available INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  compaction_count INTEGER NOT NULL DEFAULT 0,
  context_kind TEXT NOT NULL DEFAULT 'agent_x',
  host_crew_id TEXT,
  host_crew_name TEXT,
  host_crew_callsign TEXT,
  host_crew_title TEXT,
  host_crew_color TEXT,
  host_crew_catalog_id TEXT,
  host_crew_category_id TEXT,
  list_day_key TEXT,
  list_day_label TEXT,
  thinking_mode TEXT,
  output_mode TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_crew_private ON sessions(host_crew_id, context_kind);

CREATE TABLE IF NOT EXISTS child_sessions (
  id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'sub_agent',
  label TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_child_sessions_parent ON child_sessions(parent_session_id);

-- ─── Messages ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,
  plan TEXT,
  parts TEXT,
  metadata TEXT,
  token_count INTEGER DEFAULT 0,
  attachments TEXT,
  archived_at TIMESTAMPTZ,
  platform_message_id BIGINT,
  platform_message_ids TEXT,
  platform_chat_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_session_active ON messages(session_id, created_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_platform_chat_id ON messages(platform_chat_id) WHERE platform_chat_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_parts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT,
  type TEXT NOT NULL,
  content TEXT,
  tool_name TEXT,
  tool_call_id TEXT,
  tool_args TEXT,
  tool_result TEXT,
  tool_success INTEGER,
  usage_input INTEGER,
  usage_output INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parts_session ON message_parts(session_id);
CREATE INDEX IF NOT EXISTS idx_message_parts_message_id ON message_parts(message_id);
CREATE INDEX IF NOT EXISTS idx_message_parts_session_created ON message_parts(session_id, created_at);

-- ─── Token logs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS token_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT,
  provider_id TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  reasoning_tokens INTEGER DEFAULT 0,
  cost_usd REAL,
  crew_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_logs_session ON token_logs(session_id);

-- ─── Checkpoints ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  messages TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);

-- ─── Session crew states ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_crew_states (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  crew_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_active TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, crew_id)
);

CREATE INDEX IF NOT EXISTS idx_session_crew_states_session ON session_crew_states(session_id);

-- ─── Tool executions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tool_executions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  agent_task_id TEXT,
  tool_name TEXT NOT NULL,
  input TEXT NOT NULL,
  output TEXT,
  success INTEGER,
  elapsed_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_executions_session ON tool_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_name ON tool_executions(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_executions_created_at ON tool_executions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_executions_name_created ON tool_executions(tool_name, created_at DESC);

-- ─── Session events ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  event_type TEXT,
  payload TEXT NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_session_events_replay ON session_events(session_id, generation, sequence);

-- ─── Permission rules ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS permission_rules (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  pattern TEXT NOT NULL DEFAULT '*',
  effect TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Agent tasks ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  parent_id TEXT,
  instruction TEXT NOT NULL,
  tools TEXT,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  result TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_session ON agent_tasks(session_id);

-- ─── Crews ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crews (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  title TEXT,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  expertise TEXT,
  traits TEXT,
  tool_preferences TEXT,
  enabled_tools TEXT,
  disabled_tools TEXT,
  is_default INTEGER DEFAULT 0,
  metadata TEXT,
  source TEXT NOT NULL DEFAULT 'custom',
  catalog_id TEXT,
  search_text TEXT NOT NULL DEFAULT '',
  search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(search_text, ''))) STORED,
  suggestable BOOLEAN NOT NULL DEFAULT TRUE,
  certifications TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crews_tsv ON crews USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS idx_crews_source ON crews(source);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crews_catalog_id ON crews(catalog_id) WHERE catalog_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS crew_feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  crew_id TEXT NOT NULL,
  positive INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_feedback_crew ON crew_feedback(crew_id);

-- ─── Turn feedback ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS turn_feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  context_kind TEXT NOT NULL DEFAULT 'agent_x',
  crew_id TEXT,
  rating TEXT NOT NULL,
  turn_summary TEXT,
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_turn_feedback_session ON turn_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_turn_feedback_crew ON turn_feedback(crew_id);

-- ─── Session resume state ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_resume_state (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Bot credentials ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bot_credentials (
  platform TEXT PRIMARY KEY,
  config_enc TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Agent persona ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_persona (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  communication_style TEXT NOT NULL DEFAULT 'direct',
  decision_making TEXT NOT NULL DEFAULT 'balanced',
  domain_context TEXT NOT NULL DEFAULT '',
  traits TEXT NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Task snapshots ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 0,
  goal TEXT NOT NULL DEFAULT '',
  plan_state TEXT NOT NULL DEFAULT '{}',
  failure_history TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Agent growth / emotions / memories ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_experiences (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  category TEXT,
  action TEXT,
  context TEXT,
  result TEXT,
  confidence REAL,
  reward REAL,
  correction TEXT,
  learnings TEXT,
  metadata TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_growth_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  level TEXT DEFAULT 'Fresh',
  wisdom_score REAL DEFAULT 0,
  total_experiences INTEGER DEFAULT 0,
  total_interactions INTEGER DEFAULT 0,
  total_corrections INTEGER DEFAULT 0,
  avg_confidence REAL DEFAULT 0.5,
  emotional_range REAL DEFAULT 0,
  capabilities TEXT DEFAULT '[]',
  next_milestone_at INTEGER,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_emotions (
  id TEXT PRIMARY KEY,
  mood TEXT,
  intensity REAL,
  context TEXT,
  session_id TEXT,
  source TEXT,
  trigger TEXT,
  valence REAL,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_emotions_source ON agent_emotions(source);
CREATE INDEX IF NOT EXISTS idx_agent_emotions_session ON agent_emotions(session_id);

CREATE TABLE IF NOT EXISTS agent_emotional_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  current_mood TEXT NOT NULL DEFAULT 'neutral',
  mood_intensity REAL NOT NULL DEFAULT 0.3,
  mood_since TEXT,
  baseline_mood TEXT NOT NULL DEFAULT 'neutral',
  emotional_range TEXT NOT NULL DEFAULT '[]',
  mood_decay_rate REAL NOT NULL DEFAULT 0.05,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO agent_emotional_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS agent_memories (
  id TEXT PRIMARY KEY,
  content TEXT,
  category TEXT,
  importance REAL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_diary (
  id TEXT PRIMARY KEY,
  entry TEXT,
  importance INTEGER,
  highlights TEXT,
  tags TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS agent_identity (
  id INTEGER PRIMARY KEY DEFAULT 1,
  interaction_count INTEGER DEFAULT 0
);

-- ─── Background tasks ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS background_tasks (
  id TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  child_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  instruction TEXT NOT NULL,
  tools TEXT NOT NULL DEFAULT '[]',
  timeout INTEGER NOT NULL DEFAULT 60000,
  status TEXT NOT NULL DEFAULT 'queued',
  result TEXT,
  error TEXT,
  resource_usage TEXT,
  channel_context TEXT,
  background BOOLEAN NOT NULL DEFAULT true,
  consumed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_background_tasks_parent_session ON background_tasks(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_background_tasks_status ON background_tasks(status);
CREATE INDEX IF NOT EXISTS idx_background_tasks_created_at ON background_tasks(created_at DESC);
