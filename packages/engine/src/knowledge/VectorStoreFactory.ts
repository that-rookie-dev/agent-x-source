import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { getLogger } from '@agentx/shared';
import { PgVectorStore } from './PgVectorStore.js';
import { MemoryVectorStore } from './MemoryVectorStore.js';
import type { IVectorStore } from './VectorStore.js';

export interface VectorStoreConfig {
  dimensions?: number;
}

export async function createVectorStore(
  pool: Pool | undefined,
  dataDir: string,
  config: VectorStoreConfig = {},
): Promise<IVectorStore> {
  const dimensions = config.dimensions ?? 1536;
  const logger = getLogger();

  if (pool) {
    try {
      const pg = new PgVectorStore(pool, dimensions);
      await pg.connect();
      return pg;
    } catch (err) {
      logger.warn('VECTOR_STORE_FALLBACK', 'PgVectorStore unavailable, falling back to MemoryVectorStore', {
        error: (err as Error).message,
      });
    }
  }

  const persistDir = join(dataDir, 'knowledge');
  mkdirSync(persistDir, { recursive: true });
  const mem = new MemoryVectorStore(dimensions, join(persistDir, 'memory-vector-store.json'));
  await mem.connect();
  return mem;
}
