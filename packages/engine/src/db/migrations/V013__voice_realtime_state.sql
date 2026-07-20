-- Durable xAI realtime conversation identity + rolling voice session summary.
-- One row per Agent-X voice session (__channel__:voice or voice:<crewTextId>).
-- conversation_id is assigned once by xAI and never rotated by the app.

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

CREATE INDEX IF NOT EXISTS idx_voice_realtime_last_active
  ON voice_realtime_state (last_voice_active_at DESC NULLS LAST);
