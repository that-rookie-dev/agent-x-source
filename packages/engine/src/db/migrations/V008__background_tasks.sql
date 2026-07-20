-- Durable background task records.
-- Tracks every delegated / background sub-agent task so the UI can restore
-- active/completed work across reconnects and the dashboard can surface
-- cross-session background work.
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
