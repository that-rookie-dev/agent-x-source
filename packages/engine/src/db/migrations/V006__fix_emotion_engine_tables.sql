-- Fix EmotionEngine tables: add missing columns to agent_emotions and create agent_emotional_state.
--
-- The EmotionEngine inserts into agent_emotions with columns (session_id, source, trigger, valence)
-- that were not in the original V001 schema. It also queries agent_emotional_state which was never
-- created. Both gaps caused silent failures (wrapped in try/catch) where emotional state tracking
-- was non-functional.

-- Add missing columns to agent_emotions
ALTER TABLE agent_emotions ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE agent_emotions ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE agent_emotions ADD COLUMN IF NOT EXISTS trigger TEXT;
ALTER TABLE agent_emotions ADD COLUMN IF NOT EXISTS valence REAL;
CREATE INDEX IF NOT EXISTS idx_agent_emotions_source ON agent_emotions(source);
CREATE INDEX IF NOT EXISTS idx_agent_emotions_session ON agent_emotions(session_id);

-- Create agent_emotional_state (singleton row, id=1)
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
