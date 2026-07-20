/**
 * Cross-database storage transfer (embedded ↔ cloud PostgreSQL).
 * Ensures destination schema is current, then upserts all domain tables.
 */
import type { Pool } from 'pg';
import { Pool as PgPool } from 'pg';
import { getLogger } from '@agentx/shared';
import { runMigrations } from '../db/MigrationRunner.js';
import { MIGRATION_FILES } from '../db/migration-registry.js';
import { MemoryFabric } from '../neural/MemoryFabric.js';

const logger = getLogger();

const COPY_SCHEMAS = ['public', 'pgboss'] as const;
const BATCH_SIZE = 250;

export interface StorageTransferResult {
  ok: boolean;
  tablesCopied: Record<string, number>;
  totalRows: number;
}

interface TableMeta {
  schema: string;
  name: string;
  qualifiedName: string;
  columns: string[];
  primaryKey: string[];
}

export async function ensureDestinationSchema(
  pool: Pool,
  connectionString: string,
  progress: (line: string) => void,
): Promise<void> {
  progress('Applying core schema migrations on destination…');
  const core = await runMigrations(pool, MIGRATION_FILES, progress);
  if (core.applied > 0) {
    progress(`Applied ${core.applied} core migration(s) — now at v${core.currentVersion}.`);
  } else {
    progress(`Core schema current (v${core.currentVersion}).`);
  }

  const client = await pool.connect();
  try {
    const { rows: vectorRows } = await client.query<{ installed: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS installed`,
    );
    if (!vectorRows[0]?.installed) {
      progress('Installing pgvector extension on destination…');
      try {
        await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        progress(`[WARN] Could not create pgvector on destination: ${msg}`);
        logger.warn('PG_TRANSFER', `pgvector extension creation failed: ${msg}`);
      }
    }
  } finally {
    client.release();
  }

  progress('Migrating neural memory schema on destination…');
  const neural = await new MemoryFabric(pool).migrate();
  if (neural.applied > 0) {
    progress(`Applied ${neural.applied} neural migration(s) — now at v${neural.currentVersion}.`);
  } else {
    progress(`Neural memory schema current (v${neural.currentVersion}).`);
  }

  progress('Ensuring pg-boss job queue schema on destination…');
  const { PgBossQueue } = await import('../queue/PgBossQueue.js');
  await PgBossQueue.migrate(connectionString);
  progress('Destination schema ready.');
}

async function listTables(pool: Pool, schema: string): Promise<string[]> {
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_catalog.pg_tables
     WHERE schemaname = $1
     ORDER BY tablename`,
    [schema],
  );
  return rows.map((r) => r.tablename);
}

async function loadTableMeta(pool: Pool, schema: string, table: string): Promise<TableMeta | null> {
  const { rows: colRows } = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table],
  );
  if (colRows.length === 0) return null;

  const { rows: pkRows } = await pool.query<{ column_name: string }>(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_schema = kcu.constraint_schema
      AND tc.constraint_name = kcu.constraint_name
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [schema, table],
  );

  const columns = colRows.map((r) => r.column_name);
  const primaryKey = pkRows.map((r) => r.column_name);

  return {
    schema,
    name: table,
    qualifiedName: `"${schema}"."${table}"`,
    columns,
    primaryKey,
  };
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function buildUpsertSql(meta: TableMeta): string | null {
  const cols = meta.columns.map(quoteIdent);
  const placeholders = meta.columns.map((_, i) => `$${i + 1}`);

  if (meta.primaryKey.length === 0) {
    return null;
  }

  const conflictCols = meta.primaryKey.map(quoteIdent).join(', ');
  const updateCols = meta.columns.filter((c) => !meta.primaryKey.includes(c));
  const updates = updateCols.length > 0
    ? updateCols.map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(', ')
    : meta.primaryKey.map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(', ');

  return `INSERT INTO ${meta.qualifiedName} (${cols.join(', ')})
VALUES (${placeholders.join(', ')})
ON CONFLICT (${conflictCols}) DO UPDATE SET ${updates}`;
}

async function copyTable(
  sourcePool: Pool,
  destClient: PoolClientLike,
  meta: TableMeta,
  progress: (line: string) => void,
): Promise<number> {
  const upsertSql = buildUpsertSql(meta);
  if (!upsertSql) {
    progress(`  Skipping ${meta.schema}.${meta.name} (no primary key — cannot upsert safely).`);
    return 0;
  }

  const colList = meta.columns.map(quoteIdent).join(', ');
  let offset = 0;
  let copied = 0;

  while (true) {
    const { rows } = await sourcePool.query<Record<string, unknown>>(
      `SELECT ${colList} FROM ${meta.qualifiedName} ORDER BY ${quoteIdent(meta.columns[0]!)} LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset],
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      const values = meta.columns.map((c) => row[c]);
      await destClient.query(upsertSql, values);
      copied += 1;
    }

    offset += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }

  return copied;
}

interface PoolClientLike {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
}

export async function transferPostgresStorage(options: {
  sourcePool: Pool;
  destinationConnectionString: string;
  progress: (line: string) => void;
}): Promise<StorageTransferResult> {
  const { sourcePool, destinationConnectionString, progress } = options;
  const destPool = new PgPool({
    connectionString: destinationConnectionString,
    max: 3,
    connectionTimeoutMillis: 30_000,
  });

  const tablesCopied: Record<string, number> = {};
  let totalRows = 0;

  try {
    progress('Connecting to destination PostgreSQL…');
    const testClient = await destPool.connect();
    testClient.release();

    await ensureDestinationSchema(destPool, destinationConnectionString, progress);

    const destClient = await destPool.connect();
    try {
      progress('Preparing destination for bulk copy…');
      await destClient.query('SET session_replication_role = replica');

      for (const schema of COPY_SCHEMAS) {
        const tables = await listTables(sourcePool, schema);
        if (tables.length === 0) continue;
        progress(`Copying ${tables.length} table(s) from schema "${schema}"…`);

        for (const table of tables) {
          const meta = await loadTableMeta(sourcePool, schema, table);
          if (!meta) continue;

          const destMeta = await loadTableMeta(destPool, schema, table);
          if (!destMeta) {
            progress(`  Skipping ${schema}.${table} (not present on destination schema).`);
            continue;
          }

          progress(`  Upserting ${schema}.${table}…`);
          const copied = await copyTable(sourcePool, destClient, meta, progress);
          const key = `${schema}.${table}`;
          tablesCopied[key] = copied;
          totalRows += copied;
          if (copied > 0) {
            progress(`  ${key}: ${copied} row(s).`);
          }
        }
      }

      await destClient.query('SET session_replication_role = DEFAULT');
    } finally {
      destClient.release();
    }

    progress(`Storage transfer complete — ${totalRows} row(s) upserted across ${Object.keys(tablesCopied).length} table(s).`);
    return { ok: true, tablesCopied, totalRows };
  } finally {
    await destPool.end().catch(() => {});
  }
}
