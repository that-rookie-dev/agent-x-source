import type { Pool } from 'pg';
import type { Crew } from '@agentx/shared';
import { getLogger } from '@agentx/shared';
import { runMigrations } from '../db/MigrationRunner.js';
import { MIGRATION_FILES } from '../db/migration-registry.js';
import { purgeOrphanChildSessionsPg } from '../session/child-session-cleanup.js';
import { backfillPgCrewSearchColumns } from '../crew/postgres-crew-catalog.js';
import { MemoryFabric } from '../neural/MemoryFabric.js';

const logger = getLogger();

/**
 * Context required by the migration helpers. Mirrors the relevant private
 * state/methods of PostgresStorageAdapter so the extracted functions can
 * operate without `this`.
 */
export interface MigrationContext {
  pool: Pool;
  progress: (line: string) => void;
  crewFromRow: (row: Record<string, unknown>) => Crew;
  hydrateEssentialCache: () => Promise<void>;
  hydrateCache: () => Promise<void>;
  lazyHydrate: boolean;
  setConnected: (value: boolean) => void;
}

export function crewFromRow(row: Record<string, unknown>): Crew {
  let metadata: Partial<Crew> = {};
  if (row['metadata']) {
    try {
      metadata = JSON.parse(row['metadata'] as string) as Partial<Crew>;
    } catch (error) {
      logger.warn('PG_STORAGE', `Failed to parse crew metadata: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    title: (row['title'] as string) || metadata.title,
    callsign: metadata.callsign ?? (row['id'] as string),
    systemPrompt: row['system_prompt'] as string ?? metadata.systemPrompt ?? '',
    description: (row['description'] as string) || metadata.description || '',
    emotion: metadata.emotion,
    source: (row['source'] as Crew['source']) ?? metadata.source ?? 'custom',
    catalogId: (row['catalog_id'] as string) ?? metadata.catalogId,
    searchText: (row['search_text'] as string) ?? metadata.searchText,
    suggestable: row['suggestable'] !== undefined ? !!(row['suggestable']) : (metadata.suggestable ?? true),
    isDefault: !!(row['is_default'] ?? metadata.isDefault),
    enabled: metadata.enabled ?? true,
    expertise: metadata.expertise ?? (row['expertise'] ? (row['expertise'] as string).split(',') : undefined),
    traits: metadata.traits ?? (row['traits'] ? (row['traits'] as string).split(',') : undefined),
    toolPreferences: metadata.toolPreferences,
    tools: metadata.tools,
    tags: metadata.tags,
    permissions: metadata.permissions,
    model: metadata.model,
    protocol: metadata.protocol,
    quotas: metadata.quotas,
    color: metadata.color,
    icon: metadata.icon,
    createdAt: row['created_at'] as string ?? metadata.createdAt ?? new Date().toISOString(),
    updatedAt: row['updated_at'] as string ?? metadata.updatedAt ?? new Date().toISOString(),
  };
}

export async function migrate(ctx: MigrationContext): Promise<void> {
  // Phase 1: Run versioned SQL migrations (forward-only, tracked in schema_migrations)
  ctx.progress('Running database migrations…');
  const result = await runMigrations(ctx.pool, MIGRATION_FILES, (line) => ctx.progress(line));
  if (result.applied > 0) {
    ctx.progress(`Applied ${result.applied} migration(s). Now at v${result.currentVersion}.`);
  } else {
    ctx.progress(`Schema current (v${result.currentVersion}).`);
  }

  // Phase 2: Ensure pgvector extension (needed by neural memory).
  // On cloud PG (RDS, Supabase, etc.) the app user may lack CREATE EXTENSION
  // privileges. We check first and warn gracefully — the neural memory system
  // has its own fallback handling for missing vector support.
  const client = await ctx.pool.connect();
  try {
    const { rows: vectorRows } = await client.query<{ installed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS installed`,
    );
    if (vectorRows[0]?.installed) {
      ctx.progress('pgvector extension found.');
    } else {
      ctx.progress('Installing pgvector extension…');
      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
      } catch (extErr) {
        const msg = extErr instanceof Error ? extErr.message : String(extErr);
        ctx.progress(`[WARN] Could not create pgvector extension: ${msg}`);
        ctx.progress('  Neural memory features will be limited. On cloud PostgreSQL, install pgvector as a superuser or via your provider dashboard.');
        logger.warn('PG_MIGRATE', `pgvector extension creation failed: ${msg}`);
      }
    }
  } finally {
    client.release();
  }

  // Phase 3: Purge orphaned child sessions (data cleanup, not schema)
  await purgeOrphanChildSessionsPg(ctx.pool);

  // Phase 4: Backfill crew search columns (data migration, not schema)
  await backfillPgCrewSearchColumns(ctx.pool, (row) => ctx.crewFromRow(row));

  // Phase 5: Neural memory schema (has its own versioned migration system)
  ctx.progress('Migrating neural memory schema…');
  const mig = await new MemoryFabric(ctx.pool).migrate();
  if (mig.applied === 0) {
    ctx.progress(`Neural memory schema current (v${mig.currentVersion}, 0 new migrations).`);
  } else {
    ctx.progress(`Applied ${mig.applied} neural memory migration(s) — now at v${mig.currentVersion}.`);
  }
  ctx.progress('Core schema migrations complete.');

  const pgBossConnectionString =
    typeof ctx.pool.options.connectionString === 'string'
      ? ctx.pool.options.connectionString
      : undefined;
  if (pgBossConnectionString) {
    ctx.progress('Ensuring pg-boss job queue schema…');
    const { PgBossQueue } = await import('../queue/PgBossQueue.js');
    await PgBossQueue.migrate(pgBossConnectionString);
    ctx.progress('pg-boss schema ready.');
  }
}

export async function doConnect(ctx: MigrationContext): Promise<void> {
  try {
    ctx.progress('Opening PostgreSQL connection pool…');
    const client = await ctx.pool.connect();
    client.release();
    await migrate(ctx);
    if (ctx.lazyHydrate) {
      ctx.progress('Loading session metadata cache…');
      await ctx.hydrateEssentialCache();
    } else {
      ctx.progress('Loading full storage cache…');
      await ctx.hydrateCache();
    }
    ctx.setConnected(true);
    ctx.progress('PostgreSQL storage connected.');
    logger.info('PG_CONNECTED', 'PostgreSQL connection established');
  } catch (error) {
    ctx.setConnected(false);
    const message = error instanceof Error ? error.message : String(error);
    ctx.progress(`[ERROR] PostgreSQL connect failed: ${message}`);
    logger.error('PG_CONNECT_FAILED', {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
