-- Observability schema: traces, spans, logs, metric samples, config, OTLP,
-- alerting, and cost analytics rollup.
--
-- DOMAIN SEGREGATION: every row is tagged with `domain` ∈ ('APP','AGENT'):
--   AGENT = AI/LLM turn lifecycle (turns, journey, llm calls, tool decisions, crew, retrieval)
--   APP   = normal application operations (HTTP, auth, DB, WebSocket, channels, automation, startup)
--
-- This is the final clean baseline. All objects use CREATE ... IF NOT EXISTS.

CREATE SCHEMA IF NOT EXISTS observability;

-- 1. TRACES — one row per turn (AGENT) or per app request/operation (APP)
CREATE TABLE IF NOT EXISTS observability.traces (
  trace_id        TEXT PRIMARY KEY,
  root_span_id    TEXT NOT NULL,
  domain          TEXT NOT NULL CHECK(domain IN ('APP','AGENT')) DEFAULT 'AGENT',
  kind            TEXT NOT NULL,
  session_id      TEXT,
  turn_id         TEXT,
  user_text       TEXT,
  status          TEXT NOT NULL CHECK(status IN ('running','ok','error','cancelled')),
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  duration_ms     INTEGER,
  provider        TEXT,
  model           TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(12,6) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_traces_session_started ON observability.traces (session_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_status_started ON observability.traces (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_kind_started ON observability.traces (kind, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_traces_domain_started ON observability.traces (domain, started_at DESC);

-- 2. SPANS — the tree (llm, tool, tool_decision, journey_stage, agent, retrieval, internal)
CREATE TABLE IF NOT EXISTS observability.spans (
  span_id         TEXT PRIMARY KEY,
  trace_id        TEXT NOT NULL REFERENCES observability.traces(trace_id) ON DELETE CASCADE,
  parent_span_id  TEXT,
  domain          TEXT NOT NULL CHECK(domain IN ('APP','AGENT')) DEFAULT 'AGENT',
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  status          TEXT NOT NULL CHECK(status IN ('ok','error','unset')),
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  duration_ms     INTEGER,
  attributes      JSONB NOT NULL DEFAULT '{}'::jsonb,
  events          JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_spans_trace_started ON observability.spans (trace_id, started_at);
CREATE INDEX IF NOT EXISTS idx_spans_parent ON observability.spans (parent_span_id);
CREATE INDEX IF NOT EXISTS idx_spans_domain ON observability.spans (domain);

-- 3. LOGS — structured, linked to trace/span, tagged by domain
CREATE TABLE IF NOT EXISTS observability.logs (
  id           BIGSERIAL PRIMARY KEY,
  trace_id     TEXT,
  span_id      TEXT,
  session_id   TEXT,
  domain       TEXT NOT NULL CHECK(domain IN ('APP','AGENT')) DEFAULT 'AGENT',
  ts           TIMESTAMPTZ NOT NULL,
  level        TEXT NOT NULL CHECK(level IN ('debug','info','warn','error')),
  scope        TEXT,
  message      TEXT NOT NULL,
  payload      JSONB
);

CREATE INDEX IF NOT EXISTS idx_logs_trace_ts ON observability.logs (trace_id, ts);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON observability.logs (ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_session_ts ON observability.logs (session_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_logs_domain_ts ON observability.logs (domain, ts DESC);

-- 4. METRIC SAMPLES — time-series for UI charts
CREATE TABLE IF NOT EXISTS observability.metric_samples (
  id         BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL,
  name       TEXT NOT NULL,
  value      DOUBLE PRECISION NOT NULL,
  labels     JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_metrics_name_ts ON observability.metric_samples (name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_domain_ts ON observability.metric_samples ((labels->>'domain'), ts DESC);

-- 5. CONFIG — single row (id=1) with OTLP and alerting settings
CREATE TABLE IF NOT EXISTS observability.config (
  id                      INT PRIMARY KEY DEFAULT 1 CHECK(id = 1),
  retention_days          INT NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 90),
  capture_prompts         BOOLEAN NOT NULL DEFAULT TRUE,
  enabled                 BOOLEAN NOT NULL DEFAULT TRUE,
  otlp_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  otlp_endpoint           TEXT    NOT NULL DEFAULT 'http://localhost:4318/v1/traces',
  otlp_protocol           TEXT    NOT NULL DEFAULT 'http' CHECK(otlp_protocol IN ('http', 'grpc')),
  otlp_headers            JSONB   NOT NULL DEFAULT '{}'::jsonb,
  alerting_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  alerting_error_rate_pct INT     NOT NULL DEFAULT 10  CHECK(alerting_error_rate_pct BETWEEN 1 AND 100),
  alerting_latency_p95_ms INT     NOT NULL DEFAULT 30000 CHECK(alerting_latency_p95_ms BETWEEN 100 AND 600000),
  alerting_window_minutes INT     NOT NULL DEFAULT 15  CHECK(alerting_window_minutes BETWEEN 1 AND 1440)
);

INSERT INTO observability.config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 6. Cost analytics rollup (materialized view, refreshed on-demand)
CREATE MATERIALIZED VIEW IF NOT EXISTS observability.cost_rollup_daily AS
  SELECT
    date_trunc('day', started_at)::date              AS day,
    COALESCE(provider, 'unknown')                    AS provider,
    COALESCE(model, 'unknown')                       AS model,
    domain,
    COUNT(*)                                         AS trace_count,
    SUM(input_tokens)                                AS total_input_tokens,
    SUM(output_tokens)                               AS total_output_tokens,
    SUM(cost_usd)                                    AS total_cost_usd,
    AVG(duration_ms)                                 AS avg_duration_ms
  FROM observability.traces
  WHERE cost_usd IS NOT NULL
  GROUP BY 1, 2, 3, 4
  ORDER BY 1 DESC, 2, 3;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_rollup_daily
  ON observability.cost_rollup_daily (day, provider, model, domain);

-- 7. Alerts — persisted alert events
CREATE TABLE IF NOT EXISTS observability.alerts (
  id          BIGSERIAL PRIMARY KEY,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  type        TEXT NOT NULL CHECK(type IN ('error_rate', 'latency_p95')),
  severity    TEXT NOT NULL DEFAULT 'warning' CHECK(severity IN ('info', 'warning', 'critical')),
  message     TEXT NOT NULL,
  threshold   INT NOT NULL,
  actual      INT NOT NULL,
  window_minutes INT NOT NULL,
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alerts_unresolved ON observability.alerts (resolved, triggered_at DESC) WHERE NOT resolved;
CREATE INDEX IF NOT EXISTS idx_alerts_triggered ON observability.alerts (triggered_at DESC);
