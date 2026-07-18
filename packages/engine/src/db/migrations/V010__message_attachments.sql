-- Adds persisted attachments to the messages table for chat file previews.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments TEXT;
