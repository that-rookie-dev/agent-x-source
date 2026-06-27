import { getLogger } from '@agentx/shared';
import { syncCatalogFromManifest } from '../crew/catalog-sync.js';
import { catalogNeedsManifestSync } from '../crew/catalog-prune.js';
import { loadCatalogManifest } from '../crew/catalog-manifest.js';
import { getCrewCatalogStoreFromEngine } from '../crew/get-crew-store.js';

/** Tables required for core app + Crew Hub catalog. */
export const CRITICAL_DB_TABLES = [
  'sessions',
  'messages',
  'crews',
  'crew_catalog',
  'app_metadata',
] as const;

export interface DatabaseHealResult {
  schemaRepaired: boolean;
  catalogSynced: boolean;
  catalogCount: number;
  expectedCatalogCount: number;
}

export function isMissingTableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /relation ".+" does not exist|relation does not exist/i.test(msg);
}

type PgPool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

function getPgPool(store: unknown): PgPool | null {
  if (!store || typeof store !== 'object') return null;
  const pool = (store as { pool?: unknown }).pool;
  if (!pool || typeof pool !== 'object' || typeof (pool as PgPool).query !== 'function') return null;
  return pool as PgPool;
}

async function pgTableExists(pool: PgPool, table: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 AS ok FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename = $1 LIMIT 1`,
    [table],
  );
  return res.rows.length > 0;
}

async function pgMissingTables(pool: PgPool): Promise<string[]> {
  const missing: string[] = [];
  for (const t of CRITICAL_DB_TABLES) {
    if (!(await pgTableExists(pool, t))) missing.push(t);
  }
  return missing;
}

async function repairPgStore(store: unknown): Promise<boolean> {
  const pool = getPgPool(store);
  if (!pool) return false;
  const missing = await pgMissingTables(pool);
  if (missing.length === 0) return false;
  getLogger().warn('DB_HEAL', `Postgres missing tables [${missing.join(', ')}] — running migrate()`);
  const s = store as { repairSchema?: () => Promise<void>; migrate?: () => Promise<void> };
  if (typeof s.repairSchema === 'function') {
    await s.repairSchema();
  } else if (typeof s.migrate === 'function') {
    await s.migrate();
  } else {
    return false;
  }
  return true;
}

async function catalogNeedsSync(store: NonNullable<ReturnType<typeof getCrewCatalogStoreFromEngine>>): Promise<boolean> {
  const manifest = loadCatalogManifest();
  if (!manifest) return false;
  try {
    const [count, rev] = await Promise.all([
      store.getCatalogCount(),
      store.getCatalogRevision(),
    ]);
    return catalogNeedsManifestSync(count, rev, manifest);
  } catch (e) {
    if (isMissingTableError(e)) return true;
    throw e;
  }
}

/**
 * Recreate dropped tables (idempotent DDL) and re-seed crew_catalog from the bundled manifest.
 * Safe to call on every startup, catalog API request, and periodic health pass.
 */
export async function healDatabaseStore(store: unknown): Promise<DatabaseHealResult> {
  const manifest = loadCatalogManifest();
  const expectedCatalogCount = manifest?.crews.length ?? 0;
  let schemaRepaired = false;
  let catalogSynced = false;
  let catalogCount = 0;

  schemaRepaired = await repairPgStore(store) || schemaRepaired;

  const catalogStore = getCrewCatalogStoreFromEngine(store);
  if (!catalogStore) {
    return { schemaRepaired, catalogSynced, catalogCount, expectedCatalogCount };
  }

  const syncCatalog = async (): Promise<void> => {
    await syncCatalogFromManifest(catalogStore);
    catalogSynced = true;
    catalogCount = await catalogStore.getCatalogCount();
  };

  try {
    if (await catalogNeedsSync(catalogStore)) {
      await syncCatalog();
    } else {
      catalogCount = await catalogStore.getCatalogCount();
    }
  } catch (e) {
    if (!isMissingTableError(e)) throw e;
    getLogger().warn('DB_HEAL', 'crew_catalog query failed — repairing schema and re-seeding');
    const repaired = await repairPgStore(store);
    schemaRepaired = schemaRepaired || repaired;
    await syncCatalog();
  }

  if (schemaRepaired || catalogSynced) {
    getLogger().info('DB_HEAL', 'Database heal complete', {
      schemaRepaired,
      catalogSynced,
      catalogCount,
      expectedCatalogCount,
    });
  }

  return { schemaRepaired, catalogSynced, catalogCount, expectedCatalogCount };
}

let periodicHealTimer: ReturnType<typeof setInterval> | null = null;

/** Background pass — catches tables dropped while the app stays running. */
export function startPeriodicDatabaseHeal(
  store: unknown,
  intervalMs = 5 * 60 * 1000,
): void {
  if (periodicHealTimer) return;
  periodicHealTimer = setInterval(() => {
    void healDatabaseStore(store).catch((e) => {
      getLogger().warn('DB_HEAL', `Periodic heal failed: ${e instanceof Error ? e.message : e}`);
    });
  }, intervalMs);
  if (typeof periodicHealTimer === 'object' && 'unref' in periodicHealTimer) {
    periodicHealTimer.unref();
  }
}

export function stopPeriodicDatabaseHeal(): void {
  if (periodicHealTimer) {
    clearInterval(periodicHealTimer);
    periodicHealTimer = null;
  }
}
