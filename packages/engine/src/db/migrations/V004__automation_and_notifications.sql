-- Automation tasks, run logs, notifications, and session confirmations.
-- Previously created inline in PostgresStorageAdapter.migrate().

CREATE TABLE IF NOT EXISTS automation_tasks (
  id TEXT PRIMARY KEY,
  task_key TEXT,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_tasks_status ON automation_tasks(status);
CREATE INDEX IF NOT EXISTS idx_automation_tasks_session ON automation_tasks(source_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_tasks_active_key ON automation_tasks(task_key) WHERE task_key IS NOT NULL AND status = 'active';
ALTER TABLE automation_tasks ADD COLUMN IF NOT EXISTS display_id TEXT;
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at) WHERE read_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_active ON notifications(created_at DESC) WHERE dismissed_at IS NULL;

CREATE TABLE IF NOT EXISTS automation_session_confirmations (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmation_note TEXT
);
