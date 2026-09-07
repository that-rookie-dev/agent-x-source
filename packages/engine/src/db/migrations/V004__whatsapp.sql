-- WhatsApp channel: session lifecycle, Baileys credential storage, message log,
-- LID<->phone identity mapping, external webhook subsystem, owner standing orders,
-- and the owner address book.
--
-- Exactly one WhatsApp session is supported per Agent-X install (by application
-- convention, not a hard schema constraint).
--
-- This is the final clean baseline. All objects use CREATE ... IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS whatsapp_session (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'disconnected',
  engine TEXT NOT NULL DEFAULT 'baileys',
  phone_number TEXT,
  push_name TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connected_at TIMESTAMPTZ,
  last_active_at TIMESTAMPTZ
);

-- Baileys credential storage: creds (single blob) + signal keys (per-row)
CREATE TABLE IF NOT EXISTS whatsapp_creds (
  id TEXT PRIMARY KEY DEFAULT 'default',
  creds_enc TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_signal_keys (
  category TEXT NOT NULL,
  key_id TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (category, key_id)
);

-- LID <-> phone number mapping (WhatsApp multi-device identity quirk)
CREATE TABLE IF NOT EXISTS whatsapp_lid_mapping (
  lid TEXT PRIMARY KEY,
  phone TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Message log
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id TEXT PRIMARY KEY,
  wa_message_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  body TEXT,
  type TEXT NOT NULL DEFAULT 'text',
  status TEXT NOT NULL DEFAULT 'pending',
  timestamp BIGINT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_wa_id ON whatsapp_messages(wa_message_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_timestamp ON whatsapp_messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat ON whatsapp_messages(chat_id, timestamp);

-- External webhook subscriptions
CREATE TABLE IF NOT EXISTS whatsapp_webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT ARRAY['*']::text[],
  secret_enc TEXT,
  secret_iv TEXT,
  secret_tag TEXT,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  filters JSONB,
  active BOOLEAN NOT NULL DEFAULT true,
  retry_count INTEGER NOT NULL DEFAULT 3,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook delivery failure / dead-letter bookkeeping
CREATE TABLE IF NOT EXISTS whatsapp_webhook_failures (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES whatsapp_webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  url TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_status_code INTEGER,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_failures_webhook ON whatsapp_webhook_failures(webhook_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhook_failures_created ON whatsapp_webhook_failures(created_at);

-- Owner standing orders (when to brief / auto-reply / ignore)
CREATE TABLE IF NOT EXISTS whatsapp_standing_orders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 0,
  match_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_json JSONB NOT NULL DEFAULT '{"type":"brief"}'::jsonb,
  created_from TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_standing_orders_enabled
  ON whatsapp_standing_orders(enabled, priority DESC, created_at ASC);

-- Owner WhatsApp address book. Structured index (not RAG) so name → JID
-- resolution is deterministic: unique match or ask, never a fuzzy guess.
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  jid TEXT PRIMARY KEY,
  phone TEXT,
  lid_jid TEXT,
  saved_name TEXT,
  first_name TEXT,
  last_name TEXT,
  notify_name TEXT,
  business_name TEXT,
  username TEXT,
  is_saved BOOLEAN NOT NULL DEFAULT FALSE,
  sendable BOOLEAN NOT NULL DEFAULT TRUE,
  aliases TEXT[] NOT NULL DEFAULT '{}'::text[],
  search_text TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_phone ON whatsapp_contacts(phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_saved_name ON whatsapp_contacts(lower(saved_name));
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_business_name ON whatsapp_contacts(lower(business_name));
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_search ON whatsapp_contacts(search_text);
