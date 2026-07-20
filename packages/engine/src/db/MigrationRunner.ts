/**
 * Industry-standard versioned migration runner for PostgreSQL.
 *
 * - Migrations are plain SQL files bundled with the app at build time.
 * - Each migration runs inside a transaction and is recorded in the
 *   `core_schema_migrations` table so it executes exactly once per database.
 * - Migrations are forward-only (no rollback) — the standard approach for
 *   embedded desktop applications where the DB is always upgraded, never downgraded.
 * - The runner is idempotent: safe to call on every app startup.
 *
 * Uses a separate tracking table (`core_schema_migrations`) from the neural memory
 * migration system (`schema_migrations`) to avoid version number collisions —
 * both systems use integer version numbers starting from 1.
 *
 * File naming convention:
 *   V001__baseline_core_schema.sql
 *   V002__add_archived_at_to_messages.sql
 *   V003__crew_catalog_tables.sql
 *   ...
 *
 * The version number (V001, V002, ...) determines execution order.
 * Migrations that are already recorded in `core_schema_migrations` are skipped.
 */
import type { Pool, PoolClient } from 'pg';
import { getLogger } from '@agentx/shared';

export interface AppliedMigration {
  version: number;
  name: string;
  applied_at: string;
}

export interface MigrationResult {
  applied: number;
  skipped: number;
  currentVersion: number;
  appliedMigrations: AppliedMigration[];
}

export interface MigrationFile {
  version: number;
  name: string;
  sql: string;
}

/**
 * Ensure the `core_schema_migrations` tracking table exists.
 * Uses a session-level advisory lock to prevent concurrent migration runs.
 */
async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS core_schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Parse a version number from a migration filename.
 * Accepts formats like "V001__name.sql" or "001_name.sql".
 */
function parseVersion(filename: string): number | null {
  const match = filename.match(/^(?:V)?(\d+)/i);
  return match ? parseInt(match[1]!, 10) : null;
}

/**
 * Parse a migration name from a filename.
 * "V001__baseline_core_schema.sql" → "baseline_core_schema"
 */
function parseName(filename: string): string {
  const base = filename.replace(/\.sql$/i, '');
  const parts = base.split(/__|_/).filter(Boolean);
  // Drop the version prefix
  if (parts.length > 0 && /^(?:V)?\d+$/i.test(parts[0]!)) {
    return parts.slice(1).join('_');
  }
  return base;
}

/**
 * Load migration files from a list of embedded SQL strings.
 * In production, these are bundled into the app via the build system.
 */
export function loadMigrationsFromEntries(
  entries: Array<{ filename: string; sql: string }>,
): MigrationFile[] {
  const migrations: MigrationFile[] = [];
  for (const entry of entries) {
    const version = parseVersion(entry.filename);
    if (version === null) continue;
    migrations.push({
      version,
      name: parseName(entry.filename),
      sql: entry.sql,
    });
  }
  migrations.sort((a, b) => a.version - b.version);
  return migrations;
}

/**
 * Run all pending migrations in order.
 *
 * Each migration executes inside its own transaction. If a migration fails,
 * the transaction is rolled back and the runner stops — subsequent migrations
 * are not attempted. This prevents partial schema updates.
 *
 * @param pool     PostgreSQL connection pool
 * @param migrations  Ordered list of migration files to apply
 * @param onProgress  Optional callback for progress reporting
 * @returns Summary of what was applied and what was skipped
 */
export async function runMigrations(
  pool: Pool,
  migrations: MigrationFile[],
  onProgress?: (line: string) => void,
): Promise<MigrationResult> {
  const log = getLogger();
  const appliedMigrations: AppliedMigration[] = [];
  let applied = 0;
  let skipped = 0;

  const client = await pool.connect();
  try {
    // Acquire a transaction-level advisory lock so only one migration
    // runner can execute at a time across concurrent connections.
    await client.query('SELECT pg_advisory_lock(20260714)');
    await ensureMigrationsTable(client);

    // Fetch already-applied versions
    const { rows } = await client.query<{ version: number; name: string; applied_at: string }>(
      `SELECT version, name, applied_at FROM core_schema_migrations ORDER BY version ASC`,
    );
    const appliedSet = new Set(rows.map((r) => r.version));

    for (const migration of migrations) {
      if (appliedSet.has(migration.version)) {
        skipped++;
        continue;
      }

      const label = `V${String(migration.version).padStart(3, '0')}__${migration.name}`;
      onProgress?.(`Applying migration ${label}…`);
      log.info('MIGRATION', `Applying ${label}`);

      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO core_schema_migrations (version, name) VALUES ($1, $2)`,
          [migration.version, migration.name],
        );
        await client.query('COMMIT');
        applied++;
        appliedMigrations.push({
          version: migration.version,
          name: migration.name,
          applied_at: new Date().toISOString(),
        });
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        const msg = error instanceof Error ? error.message : String(error);
        log.error('MIGRATION', `Migration ${label} failed`, { error: msg });
        throw new Error(`Migration ${label} failed: ${msg}`);
      }
    }

    const currentVersion = migrations.length > 0
      ? Math.max(...migrations.map((m) => m.version))
      : rows.length > 0
        ? Math.max(...rows.map((r) => r.version))
        : 0;

    if (applied > 0) {
      onProgress?.(`Applied ${applied} migration(s), skipped ${skipped}. Now at v${currentVersion}.`);
    } else {
      onProgress?.(`Schema current (v${currentVersion}, ${skipped} migration(s) already applied).`);
    }

    return { applied, skipped, currentVersion, appliedMigrations };
  } finally {
    await client.query('SELECT pg_advisory_unlock(20260714)').catch(() => {});
    client.release();
  }
}
