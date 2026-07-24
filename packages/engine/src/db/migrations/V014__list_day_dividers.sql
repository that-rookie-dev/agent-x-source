-- Persisted list day dividers for markdown docs (table still named canvases until V015) and sessions (call history).
-- Written once at create time; list UIs read list_day_key / list_day_label as-is.

ALTER TABLE canvases ADD COLUMN IF NOT EXISTS list_day_key TEXT;
ALTER TABLE canvases ADD COLUMN IF NOT EXISTS list_day_label TEXT;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS list_day_key TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS list_day_label TEXT;

-- Best-effort backfill of day keys only (absolute labels set for new rows at write time).
UPDATE canvases
SET list_day_key = to_char(timezone('UTC', created_at)::date, 'YYYY-MM-DD')
WHERE list_day_key IS NULL AND created_at IS NOT NULL;

UPDATE sessions
SET list_day_key = to_char(timezone('UTC', created_at)::date, 'YYYY-MM-DD')
WHERE list_day_key IS NULL AND created_at IS NOT NULL;

UPDATE canvases
SET list_day_label = list_day_key
WHERE list_day_label IS NULL AND list_day_key IS NOT NULL;

UPDATE sessions
SET list_day_label = list_day_key
WHERE list_day_label IS NULL AND list_day_key IS NOT NULL;
