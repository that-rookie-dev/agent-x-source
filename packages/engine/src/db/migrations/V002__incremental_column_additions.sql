-- Incremental column additions and index changes added after the initial schema.
-- Previously applied via ALTER TABLE ... ADD COLUMN IF NOT EXISTS in migrate().

-- messages: parts column (for structured message parts)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS parts TEXT;

-- messages: soft-archive support
ALTER TABLE messages ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_messages_session_active ON messages(session_id, created_at) WHERE archived_at IS NULL;

-- message_parts: link to messages table
ALTER TABLE message_parts ADD COLUMN IF NOT EXISTS message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_message_parts_message_id ON message_parts(message_id);
CREATE INDEX IF NOT EXISTS idx_message_parts_session_created ON message_parts(session_id, created_at);

-- messages: session+created index for ordered reads
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);

-- crews: additional metadata columns
ALTER TABLE crews ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE crews ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- sessions: compaction tracking
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS compaction_count INTEGER NOT NULL DEFAULT 0;

-- sessions: crew private session support
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS context_kind TEXT NOT NULL DEFAULT 'agent_x';
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS host_crew_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS host_crew_name TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS host_crew_callsign TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS host_crew_title TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS host_crew_color TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS host_crew_catalog_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS host_crew_category_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_crew_private ON sessions(host_crew_id, context_kind);

-- Backfill child_sessions from sessions for existing sub-agent sessions
INSERT INTO child_sessions (id, parent_session_id, kind, label, status, created_at, updated_at)
SELECT id, parent_id, 'sub_agent', title, status, created_at, updated_at
FROM sessions WHERE parent_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;
