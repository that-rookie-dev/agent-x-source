/**
 * PG-backed neural DB adapter for neural engines (ExperienceEngine, GrowthEngine).
 * Reads from in-memory cache; writes queue to PG in the background.
 * Gracefully degrades to in-memory-only if PG is unavailable.
 */
import { getLogger } from '@agentx/shared';

const logger = getLogger();

export interface NeuralStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

export interface NeuralDb {
  prepare(sql: string): NeuralStatement;
}

/**
 * PG-backed neural DB adapter.
 * Reads from in-memory cache; writes queue to PG in the background.
 * Gracefully degrades to in-memory-only if PG is unavailable.
 */
export function createPgNeuralDb(pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }): NeuralDb {
  const cache = new Map<string, Record<string, unknown>[]>();
  const singles = new Map<string, Record<string, unknown>>();

  // Schema for neural engine tables (agent_experiences, agent_growth_state, etc.)
  // is now managed by versioned migrations (V001 + V003 in MemoryMigrationRunner).
  // We only seed the singleton growth state row here.
  pool.query(`INSERT INTO agent_growth_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`).catch(() => {
    logger.warn('NEURAL_DB', 'PG seed failed — neural data will be in-memory only');
  });

  return {
    prepare(sql: string): NeuralStatement {
      const sqlLower = sql.toLowerCase().trim();

      return {
        run(...params: unknown[]): { changes: number } {
          const paramValues = params.map(p => p === undefined ? null : p);
          // Write to PG in background
          pool.query(sql, paramValues).catch(() => {});
          // Also update cache
          if (sqlLower.startsWith('insert into agent_experiences')) {
            const key = `experiences_${paramValues[0]}`;
            const row: Record<string, unknown> = {};
            const cols = sql.match(/\(([^)]+)\)/)?.[1]?.split(',').map(c => c.trim()) || [];
            cols.forEach((c, i) => { row[c] = paramValues[i]; });
            singles.set(key, row);
          } else if (sqlLower.startsWith('update agent_growth_state')) {
            singles.set('growth_state', {});
          }
          return { changes: 1 };
        },

        get(...params: unknown[]): Record<string, unknown> | undefined {
          if (sqlLower.includes('from agent_experiences') && sqlLower.includes('min(')) {
            return { d: null };
          }
          if (sqlLower.includes('from agent_growth_state')) {
            return singles.get('growth_state') ?? { level: 'Fresh', wisdom_score: 0 };
          }
          if (sqlLower.includes('count(')) {
            const key = `count_${params.join('_')}`;
            const cached = singles.get(key);
            if (cached) return cached;
            // Async fetch
            pool.query(sql, params).then(r => {
              if (r.rows[0]) singles.set(key, r.rows[0]);
            }).catch(() => {});
            return { c: 0, a: 0.5 };
          }
          return undefined;
        },

        all(...params: unknown[]): Record<string, unknown>[] {
          const cacheKey = `${sqlLower}_${JSON.stringify(params)}`.slice(0, 100);
          const cached = cache.get(cacheKey);
          if (cached) return cached;
          // Async fetch
          pool.query(sql, params).then(r => {
            cache.set(cacheKey, r.rows);
          }).catch(() => {});
          return [];
        },
      };
    },
  };
}
