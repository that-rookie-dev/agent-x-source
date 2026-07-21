#!/usr/bin/env node
/**
 * Ops DoD check: apply/verify memory migrations v22–v23 on a live Postgres.
 * Usage from source/: node scripts/retrieval-reindex-check.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const sourceRoot = join(__dirname, '..');
const require = createRequire(join(sourceRoot, 'packages/engine/package.json'));
const pg = require('pg');

const credPath = join(root, 'credentials.env');

function loadConn() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.PG_CONN_STRING_LOCAL) return process.env.PG_CONN_STRING_LOCAL;
  if (existsSync(credPath)) {
    const text = readFileSync(credPath, 'utf8');
    const m = text.match(/^PG_CONN_STRING_LOCAL=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

async function main() {
  const conn = loadConn();
  if (!conn) {
    console.error('No PG connection string found');
    process.exit(2);
  }

  const pool = new pg.Pool({ connectionString: conn, connectionTimeoutMillis: 5000 });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows: migrations } = await pool.query(
      `SELECT version, name FROM schema_migrations WHERE version >= 20 ORDER BY version`,
    );
    console.log('Migrations >=20:', migrations);

    const { rows: has22 } = await pool.query(`SELECT 1 FROM schema_migrations WHERE version = 22`);
    if (!has22.length) {
      console.log('Applying v22 content_tsv…');
      await pool.query(`
        ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS content_tsv tsvector;
        UPDATE memory_nodes
           SET content_tsv = to_tsvector('english', coalesce(label, '') || ' ' || coalesce(content, ''))
         WHERE content_tsv IS NULL;
        CREATE INDEX IF NOT EXISTS idx_memory_nodes_content_tsv ON memory_nodes USING GIN (content_tsv);
        CREATE OR REPLACE FUNCTION memory_nodes_content_tsv_update() RETURNS trigger AS $$
        BEGIN
          NEW.content_tsv := to_tsvector('english', coalesce(NEW.label, '') || ' ' || coalesce(NEW.content, ''));
          RETURN NEW;
        END
        $$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS trg_memory_nodes_content_tsv ON memory_nodes;
        CREATE TRIGGER trg_memory_nodes_content_tsv
          BEFORE INSERT OR UPDATE OF label, content ON memory_nodes
          FOR EACH ROW EXECUTE PROCEDURE memory_nodes_content_tsv_update();
      `);
      await pool.query(
        `INSERT INTO schema_migrations (version, name) VALUES (22, 'memory_nodes_content_tsv_hybrid') ON CONFLICT DO NOTHING`,
      );
    }

    const { rows: has23 } = await pool.query(`SELECT 1 FROM schema_migrations WHERE version = 23`);
    if (!has23.length) {
      console.log('Applying v23 FOLLOWS rewrite…');
      await pool.query(`
        UPDATE memory_edges e
           SET relationship_type = 'FOLLOWS', updated_at = NOW()
          FROM memory_nodes s, memory_nodes t
         WHERE e.source_node_id = s.id
           AND e.target_node_id = t.id
           AND e.relationship_type = 'NEXT_STEP'
           AND s.unit_type = 'chunk'
           AND t.unit_type = 'chunk';
      `);
      await pool.query(
        `INSERT INTO schema_migrations (version, name) VALUES (23, 'chunk_order_edges_follows') ON CONFLICT DO NOTHING`,
      );
    }

    const { rows: tsvNull } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM memory_nodes WHERE status = 'active' AND content_tsv IS NULL`,
    );
    const { rows: nextStepChunks } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM memory_edges e
         JOIN memory_nodes s ON s.id = e.source_node_id
         JOIN memory_nodes t ON t.id = e.target_node_id
        WHERE e.relationship_type = 'NEXT_STEP'
          AND s.unit_type = 'chunk' AND t.unit_type = 'chunk'`,
    );
    const { rows: follows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM memory_edges WHERE relationship_type = 'FOLLOWS'`,
    );

    let sampleSources = [];
    try {
      const r = await pool.query(
        `SELECT id, name, status, chunk_count FROM memory_sources ORDER BY updated_at DESC NULLS LAST LIMIT 5`,
      );
      sampleSources = r.rows;
    } catch {
      sampleSources = [];
    }

    const report = {
      contentTsvNullActive: tsvNull[0]?.n,
      chunkNextStepRemaining: nextStepChunks[0]?.n,
      followsEdges: follows[0]?.n,
      sampleSources,
      ok: (tsvNull[0]?.n ?? 0) === 0 && (nextStepChunks[0]?.n ?? 0) === 0,
    };
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      console.error('Reindex check FAILED');
      process.exit(1);
    }
    console.log('Reindex check OK — migrations + dual-read state verified on live DB');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
