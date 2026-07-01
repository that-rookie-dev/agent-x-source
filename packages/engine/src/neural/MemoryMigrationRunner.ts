/**
 * Versioned migration runner for the Neural Brain schema.
 *
 * Ensures idempotent schema creation across clean installs, updates, and cloud
 * provisioning. Each migration is wrapped in a transaction and recorded in
 * `schema_migrations` so the same runner can be used for local embedded PG and
 * external PostgreSQL.
 */
import type { Pool } from 'pg';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'baseline_neural_schema',
    sql: `
      CREATE EXTENSION IF NOT EXISTS vector;
      -- AGE is optional; the engine falls back to recursive CTEs when unavailable.
      DO $$
      BEGIN
        CREATE EXTENSION IF NOT EXISTS age;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'AGE extension not available, continuing without graph support: %', SQLERRM;
      END$$;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS memory_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        color_hex TEXT NOT NULL DEFAULT '#ffffff',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS memory_nodes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        label TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding vector(384),
        status TEXT NOT NULL DEFAULT 'active',
        source_id UUID REFERENCES memory_sources(id) ON DELETE SET NULL,
        session_id TEXT,
        agent_id TEXT,
        confidence REAL NOT NULL DEFAULT 0.8,
        x REAL NOT NULL DEFAULT 0,
        y REAL NOT NULL DEFAULT 0,
        layout_epoch INTEGER NOT NULL DEFAULT 0,
        tag TEXT,
        is_benchmark BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS neuron_activity (
        node_id UUID PRIMARY KEY REFERENCES memory_nodes(id) ON DELETE CASCADE,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS memory_edges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_node_id UUID NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
        target_node_id UUID NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
        relationship_type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 0.5,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(source_node_id, target_node_id, relationship_type)
      );

      CREATE TABLE IF NOT EXISTS web_staging (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        url TEXT NOT NULL,
        domain TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'raw',
        raw_payload JSONB NOT NULL,
        distilled_content TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        source_id UUID REFERENCES memory_sources(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(url, kind)
      );

      CREATE TABLE IF NOT EXISTS benchmark_scorecards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL UNIQUE,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ,
        total_score REAL NOT NULL DEFAULT 0,
        max_score REAL NOT NULL DEFAULT 0,
        rag_triad JSONB,
        test_results JSONB NOT NULL,
        metadata JSONB
      );

      CREATE INDEX IF NOT EXISTS idx_memory_nodes_category ON memory_nodes(category);
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_status ON memory_nodes(status);
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_session_id ON memory_nodes(session_id);
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_source_id ON memory_nodes(source_id);
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_embedding ON memory_nodes
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_layout_epoch ON memory_nodes(layout_epoch);
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_spatial ON memory_nodes USING gist (point(x, y));
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_tag ON memory_nodes(tag);
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_is_benchmark ON memory_nodes(is_benchmark);
      CREATE INDEX IF NOT EXISTS idx_memory_edges_source ON memory_edges(source_node_id);
      CREATE INDEX IF NOT EXISTS idx_memory_edges_target ON memory_edges(target_node_id);
      CREATE INDEX IF NOT EXISTS idx_memory_edges_type ON memory_edges(relationship_type);
      CREATE INDEX IF NOT EXISTS idx_web_staging_domain ON web_staging(domain);
      CREATE INDEX IF NOT EXISTS idx_web_staging_status ON web_staging(status);
      CREATE INDEX IF NOT EXISTS idx_benchmark_scorecards_model ON benchmark_scorecards(model);
      CREATE INDEX IF NOT EXISTS idx_benchmark_scorecards_finished_at ON benchmark_scorecards(finished_at);
    `,
  },
  {
    version: 2,
    name: 'age_graph',
    sql: `
      SET search_path = ag_catalog, public;
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'age') THEN
          PERFORM * FROM ag_catalog.ag_graph WHERE name = 'memory_graph';
          IF NOT FOUND THEN
            PERFORM ag_catalog.create_graph('memory_graph');
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'AGE graph setup skipped: %', SQLERRM;
      END$$;
      SET search_path = public;
    `,
  },
  {
    version: 3,
    name: 'legacy_neural_engine_tables',
    sql: `
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
      CREATE INDEX IF NOT EXISTS idx_agent_experiences_category_action ON agent_experiences(category, action);
      CREATE INDEX IF NOT EXISTS idx_agent_experiences_result ON agent_experiences(result);
      CREATE INDEX IF NOT EXISTS idx_agent_experiences_created_at ON agent_experiences(created_at);

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

      INSERT INTO agent_growth_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
      INSERT INTO agent_identity (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    `,
  },
  {
    version: 4,
    name: 'secure_vault',
    sql: `
      CREATE TABLE IF NOT EXISTS secure_vault (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        token TEXT NOT NULL UNIQUE,
        encrypted_value TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'pii',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_secure_vault_token ON secure_vault(token);
    `,
  },
  {
    version: 5,
    name: 'web_staging_ttl',
    sql: `
      ALTER TABLE web_staging ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
      UPDATE web_staging SET expires_at = COALESCE(expires_at, updated_at + INTERVAL '7 days') WHERE expires_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_web_staging_expires_at ON web_staging(expires_at);
    `,
  },
  {
    version: 6,
    name: 'ingestion_jobs',
    sql: `
      CREATE TABLE IF NOT EXISTS ingestion_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        priority INTEGER NOT NULL DEFAULT 0,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        error TEXT,
        result JSONB,
        progress INTEGER NOT NULL DEFAULT 0,
        locked_until TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status_kind ON ingestion_jobs(status, kind);
      CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_priority_created ON ingestion_jobs(priority DESC, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_locked_until ON ingestion_jobs(locked_until);
    `,
  },
  {
    version: 7,
    name: 'halfvec_quantization',
    sql: `
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector' AND default_version >= '0.7.0') THEN
          ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS embedding_halfvec halfvec(384);
          CREATE INDEX IF NOT EXISTS idx_memory_nodes_embedding_halfvec ON memory_nodes
            USING hnsw (embedding_halfvec halfvec_cosine_ops)
            WITH (m = 16, ef_construction = 64);
        END IF;
      END$$;
    `,
  },
  {
    version: 8,
    name: 'node_provenance',
    sql: `
      ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS heading_path TEXT[];
      ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS char_span INT4RANGE;
      ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS unit_type TEXT;
      ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS provenance JSONB;
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_unit_type ON memory_nodes(unit_type);
    `,
  },
  {
    version: 9,
    name: 'edge_extraction_method',
    sql: `
      ALTER TABLE memory_edges ADD COLUMN IF NOT EXISTS extraction_method TEXT;
      CREATE INDEX IF NOT EXISTS idx_memory_edges_extraction_method ON memory_edges(extraction_method);
    `,
  },
  {
    version: 10,
    name: 'bge_m3_embedding_dim_1024',
    sql: `
      -- Bump embedding columns from vector(384) to vector(1024) for BGE-M3.
      -- Existing 384-dim vectors are zero-padded to 1024 by PostgreSQL's cast.
      -- Vectors must be re-embedded via reEmbedAll() after this migration;
      -- old 384-dim values are preserved (zero-padded) until re-embedded.
      DROP INDEX IF EXISTS idx_memory_nodes_embedding;
      DROP INDEX IF EXISTS idx_memory_nodes_embedding_halfvec;
      ALTER TABLE memory_nodes ALTER COLUMN embedding TYPE vector(1024) USING embedding::vector(1024);
      ALTER TABLE memory_nodes ALTER COLUMN embedding_halfvec TYPE halfvec(1024) USING embedding_halfvec::halfvec(1024);
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_embedding ON memory_nodes
        USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64);
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_embedding_halfvec ON memory_nodes
        USING hnsw (embedding_halfvec halfvec_cosine_ops)
        WITH (m = 16, ef_construction = 64);
    `,
  },
  {
    version: 11,
    name: 'graphrag_communities',
    sql: `
      -- Track Louvain community membership for GraphRAG hierarchical retrieval.
      ALTER TABLE memory_nodes ADD COLUMN IF NOT EXISTS community_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_memory_nodes_community_id ON memory_nodes(community_id) WHERE community_id IS NOT NULL;
    `,
  },
  {
    version: 12,
    name: 'source_file_path',
    sql: `
      -- Track the original file path for each knowledge source so users can
      -- re-download or re-ingest documents uploaded via RAG Studio.
      ALTER TABLE memory_sources ADD COLUMN IF NOT EXISTS file_path TEXT;
      ALTER TABLE memory_sources ADD COLUMN IF NOT EXISTS file_size BIGINT;
      ALTER TABLE memory_sources ADD COLUMN IF NOT EXISTS file_mime TEXT;
    `,
  },
  {
    version: 13,
    name: 'ingestion_jobs_stage_detail',
    sql: `
      -- Persist the full atomic IngestProgressEvent (stage/detail/chunkIndex/
      -- chunkCount) alongside the integer progress so the RAG Studio UI can
      -- render a live stage pipeline tracker, log stream, and telemetry.
      ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS stage_detail JSONB;
    `,
  },
  {
    version: 14,
    name: 'ingestion_events_log',
    sql: `
      -- Append-only event log for ingestion jobs. Every atomic progress event
      -- (chunk embedded, LLM batch started, entity parsed, etc.) is inserted
      -- here so the SSE stream can deliver them to the UI without loss.
      -- The stage_detail column on ingestion_jobs only holds the LATEST state;
      -- this table holds the full history for the log stream.
      CREATE TABLE IF NOT EXISTS ingestion_events (
        id BIGSERIAL PRIMARY KEY,
        job_id UUID NOT NULL REFERENCES ingestion_jobs(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        detail TEXT,
        chunk_index INTEGER,
        chunk_count INTEGER,
        batch_index INTEGER,
        batch_count INTEGER,
        progress INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ingestion_events_job_id ON ingestion_events(job_id, id);
    `,
  },
  {
    version: 15,
    name: 'ingestion_token_tracking',
    sql: `
      -- Track LLM token usage per event and per job so users can see
      -- real-time token spend during document ingestion.
      ALTER TABLE ingestion_events ADD COLUMN IF NOT EXISTS input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE ingestion_events ADD COLUMN IF NOT EXISTS output_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS total_input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS total_output_tokens INTEGER NOT NULL DEFAULT 0;
    `,
  },
];

export class MemoryMigrationRunner {
  constructor(private pool: Pool) {}

  async ensureSchema(): Promise<{ applied: number; currentVersion: number }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      const { rows: applied } = await client.query<{ version: number }>(
        `SELECT version FROM schema_migrations ORDER BY version ASC`
      );
      const appliedSet = new Set(applied.map((r) => r.version));
      let appliedCount = 0;

      for (const migration of MIGRATIONS) {
        if (appliedSet.has(migration.version)) continue;
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`,
          [migration.version, migration.name]
        );
        appliedCount++;
      }

      await client.query('COMMIT');
      const currentVersion = Math.max(...MIGRATIONS.map((m) => m.version), 0);
      return { applied: appliedCount, currentVersion };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async detectAge(): Promise<{ available: boolean; error?: string }> {
    try {
      const { rows } = await this.pool.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'age'
        ) AS available
      `);
      return { available: rows[0]?.available === true };
    } catch (e) {
      return { available: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
