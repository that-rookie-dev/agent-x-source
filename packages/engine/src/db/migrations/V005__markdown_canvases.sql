-- Markdown canvas documents table.
-- Previously created by MarkdownDocumentStore.ensureSchema().

CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  message_id TEXT,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL,
  content_format TEXT NOT NULL DEFAULT 'markdown',
  source_role TEXT,
  compile_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canvases_created ON canvases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvases_session ON canvases(session_id, created_at DESC);

-- Ensure session_id is nullable (older versions may have created it NOT NULL)
ALTER TABLE canvases ALTER COLUMN session_id DROP NOT NULL;

-- Ensure the FK uses ON DELETE SET NULL (older versions may have used CASCADE)
DO $$
DECLARE
  conname TEXT;
  has_set_null BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'canvases'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (session_id)%'
      AND pg_get_constraintdef(oid) LIKE '%ON DELETE SET NULL%'
  ) INTO has_set_null;

  IF NOT has_set_null THEN
    SELECT c.conname INTO conname
    FROM pg_constraint c
    WHERE c.conrelid = 'canvases'::regclass
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE 'FOREIGN KEY (session_id)%';

    IF conname IS NOT NULL THEN
      EXECUTE format('ALTER TABLE canvases DROP CONSTRAINT %I', conname);
    END IF;

    EXECUTE 'ALTER TABLE canvases ADD CONSTRAINT canvases_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL';
  END IF;
END $$;
