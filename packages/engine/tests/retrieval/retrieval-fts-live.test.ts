import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../../');
const credPath = join(root, 'credentials.env');

function loadConn(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.PG_CONN_STRING_LOCAL) return process.env.PG_CONN_STRING_LOCAL;
  if (existsSync(credPath)) {
    const m = readFileSync(credPath, 'utf8').match(/^PG_CONN_STRING_LOCAL=(.+)$/m);
    if (m) return m[1]!.trim();
  }
  return null;
}

describe('5.7+ — live PG FTS (content_tsv)', () => {
  it('content_tsv column exists and ranks exact tokens when data present', async () => {
    const conn = loadConn();
    if (!conn) {
      console.warn('skip: no PG connection');
      return;
    }
    const pool = new pg.Pool({ connectionString: conn, connectionTimeoutMillis: 3000 });
    try {
      const { rows: col } = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_name = 'memory_nodes' AND column_name = 'content_tsv'
         ) AS exists`,
      );
      expect(col[0]?.exists).toBe(true);

      // Insert an ephemeral node, search, cleanup.
      const id = '00000000-0000-4000-8000-00000000af01';
      await pool.query(`DELETE FROM memory_nodes WHERE id = $1`, [id]);
      await pool.query(
        `INSERT INTO memory_nodes (id, label, category, content, status)
         VALUES ($1, 'fts-probe', 'semantic', 'UniqueTokenXYZ_ERR_AUTH_401_probe for hybrid FTS', 'active')`,
        [id],
      );
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM memory_nodes
          WHERE content_tsv @@ plainto_tsquery('english', 'UniqueTokenXYZ_ERR_AUTH_401_probe')
          LIMIT 5`,
      );
      expect(rows.some((r) => r.id === id)).toBe(true);
      await pool.query(`DELETE FROM memory_nodes WHERE id = $1`, [id]);
    } finally {
      await pool.end();
    }
  });
});
