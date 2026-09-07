-- Synthetic Intelligence capability store.
--
-- Merges the final baseline tables and columns from the V014, V016 and V017
-- iterations. All objects use CREATE ... IF NOT EXISTS; no ALTER TABLE or
-- DROP CONSTRAINT statements remain.

CREATE TABLE IF NOT EXISTS capabilities (
  id                    TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL CHECK (kind IN ('tool', 'skill', 'knowledge')),
  status                TEXT NOT NULL CHECK (status IN (
    'observed','proposed','sandbox-failed','sandbox-passed','in-trial','trial-failed','registered','disabled','archived'
  )),
  name                  TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            TEXT NOT NULL DEFAULT 'system',
  source_session_id     TEXT,
  version               INTEGER NOT NULL DEFAULT 1,
  origin                TEXT NOT NULL DEFAULT 'observed' CHECK (origin IN ('observed','user-prompt','seeded','imported')),
  user_prompt           TEXT,
  generated_by          TEXT,
  alternatives          TEXT NOT NULL DEFAULT '[]',

  language              TEXT CHECK (language IN ('typescript','python','bash','javascript')),
  source_code           TEXT,
  entry_point           TEXT,
  input_schema          TEXT,
  output_schema         TEXT,
  dependencies          TEXT,
  side_effects          TEXT,
  approved_side_effects TEXT,
  sandbox_result        TEXT,
  trial_count           INTEGER NOT NULL DEFAULT 0,
  use_count             INTEGER NOT NULL DEFAULT 0,

  prompt_template       TEXT,
  trigger_pattern       TEXT,
  example_calls         TEXT,

  domain                TEXT,
  knowledge_content     TEXT,
  source_references     TEXT,
  original_source_code  TEXT,
  merged_from           TEXT
);

CREATE INDEX IF NOT EXISTS idx_capabilities_status ON capabilities(status);
CREATE INDEX IF NOT EXISTS idx_capabilities_kind ON capabilities(kind);
CREATE INDEX IF NOT EXISTS idx_capabilities_name ON capabilities(name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_capabilities_name_active
  ON capabilities (name)
  WHERE status <> 'archived';

CREATE TABLE IF NOT EXISTS observed_patterns (
  id                TEXT PRIMARY KEY,
  pattern           TEXT NOT NULL,
  frequency         INTEGER NOT NULL DEFAULT 1,
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_observed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  context           TEXT NOT NULL DEFAULT '',
  confidence        REAL NOT NULL DEFAULT 0.0,
  acknowledged      INTEGER NOT NULL DEFAULT 0,
  ignored           INTEGER NOT NULL DEFAULT 0,
  rejected_count    INTEGER NOT NULL DEFAULT 0,
  origin            TEXT NOT NULL DEFAULT 'autonomous' CHECK (origin IN ('autonomous','user-prompt')),
  example_inputs    TEXT
);

CREATE INDEX IF NOT EXISTS idx_observations_confidence ON observed_patterns(confidence);
CREATE INDEX IF NOT EXISTS idx_observations_ignored ON observed_patterns(ignored, confidence DESC);

CREATE TABLE IF NOT EXISTS capability_audit_events (
  id            TEXT PRIMARY KEY,
  capability_id TEXT REFERENCES capabilities(id) ON DELETE CASCADE,
  event         TEXT NOT NULL,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor         TEXT NOT NULL DEFAULT 'system',
  details       TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_capability_audit_capability_id ON capability_audit_events(capability_id);
CREATE INDEX IF NOT EXISTS idx_capability_audit_timestamp ON capability_audit_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_capability_audit_event ON capability_audit_events(event, timestamp DESC);

CREATE TABLE IF NOT EXISTS capability_gates (
  capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  gate          TEXT NOT NULL CHECK (gate IN ('sandbox','trial','user-approval')),
  status        TEXT NOT NULL CHECK (status IN ('pending','passed','failed','skipped')),
  passed_at     TIMESTAMPTZ,
  passed_by     TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (capability_id, gate)
);

CREATE TABLE IF NOT EXISTS capability_usage (
  id                TEXT PRIMARY KEY,
  capability_id     TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  session_id        TEXT,
  success           INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  execution_time_ms INTEGER,
  positive_feedback INTEGER
);

CREATE INDEX IF NOT EXISTS idx_capability_usage_cap ON capability_usage(capability_id, created_at DESC);

CREATE TABLE IF NOT EXISTS capability_test_cases (
  id            TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  input         TEXT NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capability_test_cases_cap ON capability_test_cases(capability_id, created_at DESC);
