-- Engineering Crew — isolated software-engineering pipeline persistence.
--
-- Stores Plan Artifacts produced by the Engineering Crew subsystem
-- (packages/engine/src/engineering-crew/), separate from the persona Crew
-- system (design doc Section 0 — isolation mandate).
--
-- See docs/engineering-crew/DESIGN.md for the full architecture.

CREATE TABLE IF NOT EXISTS engineering_crew_runs (
  task_id           TEXT PRIMARY KEY,
  session_id        TEXT,
  objective         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'complete', 'blocked', 'timed_out', 'failed', 'cancelled')),
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  summary           TEXT,
  rounds            INTEGER NOT NULL DEFAULT 0,
  plan_snapshot     TEXT NOT NULL DEFAULT '{}'      -- full PlanArtifact JSON for checkpointing
);

CREATE INDEX IF NOT EXISTS idx_engineering_crew_runs_session
  ON engineering_crew_runs (session_id);

CREATE INDEX IF NOT EXISTS idx_engineering_crew_runs_status
  ON engineering_crew_runs (status);

CREATE TABLE IF NOT EXISTS engineering_crew_phases (
  id                TEXT NOT NULL,
  run_task_id       TEXT NOT NULL REFERENCES engineering_crew_runs (task_id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'verified', 'failed', 'blocked')),
  depends_on        TEXT NOT NULL DEFAULT '[]',     -- JSON array of phase IDs
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  unknowns          TEXT NOT NULL DEFAULT '[]',     -- JSON array of {question, resolution?, escalated?}
  verification      TEXT NOT NULL DEFAULT '[]',     -- JSON array of {criterion, passed, detail?, command?, exitCode?, output?}
  implementation_notes TEXT,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  explicit_commands TEXT,                           -- JSON {build?, test?, run?}
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id, run_task_id)
);

CREATE INDEX IF NOT EXISTS idx_engineering_crew_phases_run
  ON engineering_crew_phases (run_task_id);

CREATE INDEX IF NOT EXISTS idx_engineering_crew_phases_status
  ON engineering_crew_phases (status);
