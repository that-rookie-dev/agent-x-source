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

  // Run CREATE TABLE IF NOT EXISTS schemas
  const neuralSchema = `
    CREATE TABLE IF NOT EXISTS agent_experiences (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      category TEXT,
      action TEXT,
      context TEXT,
      result TEXT,
      confidence REAL,
      reward REAL,
      correction TEXT,
      learnings TEXT,
      metadata TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_growth_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      level TEXT DEFAULT 'Fresh',
      wisdom_score REAL DEFAULT 0,
      total_experiences INTEGER DEFAULT 0,
      total_interactions INTEGER DEFAULT 0,
      total_corrections INTEGER DEFAULT 0,
      avg_confidence REAL DEFAULT 0.5,
      emotional_range REAL DEFAULT 0,
      capabilities TEXT DEFAULT '[]',
      next_milestone_at INTEGER,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS agent_emotions (
      id TEXT PRIMARY KEY,
      mood TEXT,
      intensity REAL,
      context TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      content TEXT,
      category TEXT,
      importance REAL,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_diary (
      id TEXT PRIMARY KEY,
      entry TEXT,
      importance INTEGER,
      highlights TEXT,
      tags TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_identity (
      id INTEGER PRIMARY KEY DEFAULT 1,
      interaction_count INTEGER DEFAULT 0
    );
  `;
  // Init schema in background
  pool.query(neuralSchema).catch(() => {
    logger.warn('NEURAL_DB', 'PG schema init failed — neural data will be in-memory only');
  });

  // Seed growth state
  pool.query(`INSERT INTO agent_growth_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`).catch(() => {});

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
