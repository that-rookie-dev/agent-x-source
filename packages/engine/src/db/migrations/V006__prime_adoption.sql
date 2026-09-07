-- Prime Agent adoption schema (V006)
-- Harness, goals, durable turns, leases, command journal, inter-agent messaging, resident sessions

-- ─── Continual Harness ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS harness_entries (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'local' CHECK (scope IN ('local', 'global')),
  kind TEXT NOT NULL CHECK (kind IN ('prompt', 'memory', 'skill', 'subagent')),
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  reference JSONB NOT NULL DEFAULT '{}'::jsonb,
  arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_harness_entries_session_kind
  ON harness_entries(session_id, kind);
CREATE INDEX IF NOT EXISTS idx_harness_entries_scope_kind
  ON harness_entries(scope, kind);

CREATE TABLE IF NOT EXISTS harness_refinements (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  scope TEXT NOT NULL DEFAULT 'local',
  trigger TEXT NOT NULL DEFAULT '',
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  rollback_id TEXT,
  before_snapshot JSONB,
  after_snapshot JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_harness_refinements_session
  ON harness_refinements(session_id, created_at DESC);

-- ─── Persistent Goals ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_goals (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'idle',
  objective TEXT NOT NULL DEFAULT '',
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  budget JSONB NOT NULL DEFAULT '{}'::jsonb,
  continuations_used INTEGER NOT NULL DEFAULT 0,
  tokens_used INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Durable Turns ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS durable_turns (
  turn_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  generation INTEGER NOT NULL DEFAULT 0,
  sequence INTEGER NOT NULL DEFAULT 0,
  partial_content TEXT,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_durable_turns_session_status
  ON durable_turns(session_id, status);

CREATE TABLE IF NOT EXISTS turn_checkpoints (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES durable_turns(turn_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  partial_content TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_turn_checkpoints_turn
  ON turn_checkpoints(turn_id, sequence);

-- ─── Session Leases ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_leases (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  holder_pid INTEGER,
  holder_instance TEXT,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- ─── Command Journal ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS command_journal (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  command_type TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'received',
  result JSONB,
  error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_command_journal_session
  ON command_journal(session_id, received_at DESC);

-- ─── Inter-agent Messaging ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  from_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  to_session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  topic TEXT NOT NULL DEFAULT 'default',
  delivery_mode TEXT NOT NULL DEFAULT 'auto',
  receiver_role TEXT NOT NULL DEFAULT 'sibling',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_to
  ON agent_messages(to_session_id, created_at DESC);

-- ─── WS Generation / Resident Sessions ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_generations (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS resident_sessions (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  detached_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idle_timeout_ms INTEGER NOT NULL DEFAULT 86400000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
