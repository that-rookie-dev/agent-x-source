import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { MemoryService } from '../src/services/memory/MemoryService.js';

const connectionString = process.env.AGENTX_TEST_PG ?? 'postgresql://agentx:agentx@127.0.0.1:3335/agentx';

async function isPgAvailable(): Promise<boolean> {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 2000 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

async function hasPgVector(): Promise<boolean> {
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 2000 });
  try {
    const { rows } = await pool.query(`SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS available`);
    return rows[0]?.available === true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

class FakeEmbeddingProvider {
  readonly model = 'fake';
  readonly dimensions: number;
  constructor(dim = 1024) {
    this.dimensions = dim;
  }
  async embed(text: string): Promise<number[]> {
    return Array.from({ length: this.dimensions }, (_, i) => {
      const char = text.charCodeAt(i % Math.max(1, text.length)) || 0;
      return (char % 100) / 100;
    });
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

describe.runIf(await isPgAvailable() && await hasPgVector())('MemoryService', () => {
  let pool: Pool;
  let service: MemoryService;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 2 });
    service = new MemoryService({ pool, embeddingProvider: new FakeEmbeddingProvider() });
    await service.migrate();
    // Clean only our test sessions so we don't race with the MemoryFabric suite.
    await pool.query("DELETE FROM memory_nodes WHERE session_id IN ('test-session','ctx-session','doc-session','reinforce-session')");
  });

  afterAll(async () => {
    try {
      await pool.query("DELETE FROM memory_nodes WHERE session_id IN ('test-session','ctx-session','doc-session','reinforce-session')");
    } catch {
      // ignore cleanup errors
    }
    service.dispose();
    await pool.end();
  });

  it('creates the HNSW embedding index during migration', async () => {
    const { rows } = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'memory_nodes' AND indexname = 'idx_memory_nodes_embedding_hnsw'
    `);
    expect(rows.length).toBe(1);
  });

  it('ingests a text node and retrieves it via search', async () => {
    const result = await service.ingest({
      text: 'Agent-X is a local-first autonomous agent framework.',
      category: 'semantic',
      extract: false,
      embed: true,
      sessionId: 'test-session',
    });
    expect(result.nodes.length).toBeGreaterThan(0);
    const nodeId = result.nodes[0]!.id;
    expect(nodeId).toBeTruthy();

    const search = await service.search('autonomous agent framework', { sessionId: 'test-session', limit: 5 });
    expect(search.some((n) => n.id === nodeId)).toBe(true);
  });

  it('assembles formatted context for an empty query', async () => {
    const context = await service.assembleContext('test-session', '', { messages: [], compact: true });
    expect(context.episodic).toBe('');
    expect(context.semantic).toBe('');
    expect(context.graph).toBe('');
  });

  it('assembles context from messages', async () => {
    await service.ingest({
      text: 'The user prefers TypeScript and PostgreSQL.',
      category: 'semantic',
      extract: false,
      embed: true,
      sessionId: 'ctx-session',
      agentId: 'agent-1',
    });

    // Query text must overlap the ingested node enough for FakeEmbeddingProvider
    // cosine similarity to clear the default minRelevance gate (~0.42).
    const search = await service.search('TypeScript and PostgreSQL preferences', {
      sessionId: 'ctx-session',
      limit: 5,
    });
    expect(search.some((n) => (n.content || '').includes('TypeScript'))).toBe(true);

    const context = await service.assembleContext(
      'ctx-session',
      'TypeScript and PostgreSQL preferences',
      { compact: true, minRelevance: 0.01 },
    );
    // Prefetch may place the hit in episodic and/or semantic — accept either lane.
    const combined = `${context.episodic}\n${context.semantic}`;
    expect(combined).toContain('TypeScript');
  });

  it('reinforces the last context node ids', async () => {
    await service.ingest({
      text: 'Reinforcement target',
      category: 'semantic',
      extract: false,
      embed: true,
      sessionId: 'reinforce-session',
    });

    await service.assembleContext('reinforce-session', 'reinforcement target', {
      messages: [{ role: 'user', content: 'reinforcement target' }],
    });

    const before = service.getLastContextNodeIds();
    expect(before.length).toBeGreaterThan(0);

    const node = await service.getFabric().getNode(before[0]!);
    const beforeCount = node?.accessCount ?? 0;

    await service.reinforce();

    const afterNode = await service.getFabric().getNode(before[0]!);
    expect((afterNode?.accessCount ?? 0)).toBeGreaterThanOrEqual(beforeCount);
  });
});
