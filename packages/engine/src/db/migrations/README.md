# Database Migrations

This directory contains versioned SQL migration files that are applied to the
PostgreSQL database on app startup. The migration system is forward-only —
migrations are never rolled back, only new ones are added.

## How it works

1. **SQL files** live in this directory with the naming convention:
   ```
   V001__descriptive_name.sql
   V002__add_column_xyz.sql
   ```
   The version number (`V001`, `V002`, ...) determines execution order.

2. **Build time**: `scripts/generate-migration-registry.mjs` reads all `.sql`
   files and generates `src/db/migration-registry.ts` with the SQL content
   embedded as string literals. This runs automatically before `tsup` via
   the `prebuild` script in `package.json`.

3. **Runtime**: `PostgresStorageAdapter.migrate()` calls `runMigrations()` from
   `MigrationRunner.ts`, which:
   - Creates a `schema_migrations` tracking table if it doesn't exist
   - Acquires a PostgreSQL advisory lock to prevent concurrent migration runs
   - Queries which migrations are already applied
   - Executes only the pending migrations, each in its own transaction
   - Records each applied migration in `schema_migrations`

## Adding a new migration

1. Create a new SQL file in this directory:
   ```
   V006__add_new_feature_table.sql
   ```

2. Write the SQL using `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD
   COLUMN IF NOT EXISTS` for idempotency (in case the file is applied to a
   database that already has the changes from manual runs).

3. Rebuild the engine:
   ```
   pnpm --filter @agentx/engine build
   ```
   The `prebuild` script will regenerate the migration registry automatically.

4. The migration will be applied on the next app startup.

## Rules

- **Never edit an existing migration file** — once applied to any database,
  its content is immutable. Create a new migration instead.
- **Never delete a migration file** — it's part of the permanent history.
- **Always use `IF NOT EXISTS`** — the migration runner wraps each file in a
  transaction, but `IF NOT EXISTS` makes the SQL idempotent even if the
  transaction is retried.
- **Version numbers must be sequential** — gaps are allowed but discouraged.
- **One concern per migration** — don't mix unrelated schema changes in the
  same file. Create separate files for separate features.
