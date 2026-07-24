-- Rename markdown documents table: canvases → markdowns.
-- Idempotent: safe if already renamed or if a fresh DB somehow has markdowns.

DO $$
BEGIN
  IF to_regclass('public.canvases') IS NOT NULL
     AND to_regclass('public.markdowns') IS NULL THEN
    ALTER TABLE canvases RENAME TO markdowns;
  END IF;
END $$;

-- Indexes (old names → new names)
DO $$
BEGIN
  IF to_regclass('public.idx_canvases_created') IS NOT NULL THEN
    ALTER INDEX idx_canvases_created RENAME TO idx_markdowns_created;
  END IF;
  IF to_regclass('public.idx_canvases_session') IS NOT NULL THEN
    ALTER INDEX idx_canvases_session RENAME TO idx_markdowns_session;
  END IF;
END $$;

-- Ensure indexes exist under the new names (fresh or partial upgrades).
CREATE INDEX IF NOT EXISTS idx_markdowns_created ON markdowns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_markdowns_session ON markdowns(session_id, created_at DESC);

-- Rename session FK constraint if the old name is still present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'canvases_session_id_fkey'
      AND conrelid = 'public.markdowns'::regclass
  ) THEN
    ALTER TABLE markdowns RENAME CONSTRAINT canvases_session_id_fkey TO markdowns_session_id_fkey;
  END IF;

  -- If somehow the table was renamed earlier but FK is missing, recreate it.
  IF to_regclass('public.markdowns') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.markdowns'::regclass
         AND conname = 'markdowns_session_id_fkey'
     )
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sessions') THEN
    BEGIN
      ALTER TABLE markdowns
        ADD CONSTRAINT markdowns_session_id_fkey
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;
