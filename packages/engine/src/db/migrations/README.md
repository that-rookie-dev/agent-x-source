# Database Migrations

This directory contains versioned SQL migration files that are applied to the
PostgreSQL database on app startup. The migration system is forward-only —
migrations are never rolled back, only new ones are added.

## How it works

1. **SQL files** live in this directory with the naming convention:
   ```
   V001__descriptive_name.sql
   V002__descriptive_name.sql
   ```
   The version number (`V001`, `V002`, ...) determines execution order.

2. **Build time**: `scripts/generate-migration-registry.mjs` reads all `.sql`
   files and generates `src/db/migration-registry.ts` with the SQL content
   embedded as string literals. This runs automatically before `tsup` via
   the `prebuild` script in `package.json`.

3. **Runtime**: `runMigrations()` from `MigrationRunner.ts`:
   - Creates a `core_schema_migrations` tracking table if it doesn't exist
   - Acquires a PostgreSQL advisory lock to prevent concurrent migration runs
   - Queries which migrations are already applied
   - Executes only the pending migrations, each in its own transaction
   - Records each applied migration in `core_schema_migrations`

## Current state

The migrations were squashed into 7 domain-organized baselines. Since there are
no production users, the entire schema history was collapsed into clean final
files — no `ALTER TABLE` corrections, `DROP TABLE` migrations, or rename
migrations remain.

- **V001__core** — Sessions, child sessions, messages, message parts, token logs,
  checkpoints, session crew states, tool executions, session events, permission
  rules, agent tasks, crews (with inline `search_tsv`), crew feedback, turn
  feedback, session resume state, bot credentials, agent persona, task snapshots,
  agent experiences / growth / emotions / memories / diary / identity, and
  background tasks.
- **V002__crew_catalog** — Crew Hub catalog (with inline `search_tsv`), app
  metadata, and session crew preferences.
- **V003__automation_kb_articles_voice** — Automation tasks / run logs / runs /
  session confirmations, notifications, articles, knowledge base (with optional
  pgvector), voice realtime state, document templates, document studio, and
  voice call / host security tables.
- **V004__whatsapp** — WhatsApp session, credentials, signal keys, LID mapping,
  messages, webhooks, webhook failures, standing orders, and contacts.
- **V005__observability** — Observability schema (traces, spans, logs, metric
  samples, config, OTLP settings, cost rollup materialized view, and alerts).
- **V006__prime_adoption** — Harness, harness refinements, session goals,
  durable turns, turn checkpoints, session leases, command journal, agent
  messages, session generations, and resident sessions.
- **V007__capabilities** — Synthetic Intelligence capability store: capabilities,
  observed patterns, capability audit events, capability gates, capability usage,
  and capability test cases.

## Adding a new migration

1. Create a new SQL file with the next version number:
   ```
   V008__new_feature.sql
   ```

2. Write the SQL using `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
   / `CREATE MATERIALIZED VIEW IF NOT EXISTS` for idempotency.

3. Rebuild the engine:
   ```
   pnpm --filter @agentx/engine build
   ```
   The `prebuild` script will regenerate the migration registry automatically.

4. The migration will be applied on the next app startup.

## Rules

- **Never edit an existing migration file** — once applied to any database,
  its content is immutable. Create a new migration instead.
- **Always use `IF NOT EXISTS`** — makes the SQL idempotent even if retried.
- **Version numbers must be sequential** — gaps are allowed but discouraged.
- **One concern per migration** — don't mix unrelated schema changes in the
  same file. Create separate files for separate features.
