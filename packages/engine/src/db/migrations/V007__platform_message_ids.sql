-- Add columns to track external platform message IDs (Telegram, Slack, Discord)
-- so that channel clear can delete messages from the external platform API.
-- These are nullable — existing messages and non-channel sessions have NULL.

-- platform_message_id: single message_id for inbound user messages from a channel
-- platform_message_ids: JSON array of message_ids for outbound assistant replies (multi-chunk)
-- platform_chat_id: the chat/channel ID on the external platform (e.g. Telegram chat_id)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS platform_message_id BIGINT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS platform_message_ids TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS platform_chat_id BIGINT;

-- Index for efficient lookup when clearing a channel conversation.
CREATE INDEX IF NOT EXISTS idx_messages_platform_chat_id ON messages(platform_chat_id) WHERE platform_chat_id IS NOT NULL;
