import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { MemoryFabric } from '../src/neural/MemoryFabric.js';
import { DocumentIngester } from '../src/neural/DocumentIngester.js';

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

describe.runIf(await isPgAvailable() && await hasPgVector())('MemoryFabric', () => {
  let pool: Pool;
  let fabric: MemoryFabric;

  beforeAll(async () => {
    pool = new Pool({ connectionString, max: 2 });
    fabric = new MemoryFabric(pool);
    await fabric.migrate();
    // Clean up any leftover nodes/edges from previous runs so tests are isolated.
    await pool.query('TRUNCATE memory_edges, memory_nodes, neuron_activity CASCADE');
  });

  afterAll(async () => {
    // Remove all test nodes/edges created by this suite so they do not appear in the user's brain.
    try {
      await pool.query('TRUNCATE memory_edges, memory_nodes, neuron_activity CASCADE');
    } catch {
      // Ignore cleanup errors if the tables were already dropped.
    }
    await pool.end();
  });

  it('creates a node and fires the neuron', async () => {
    const node = await fabric.createNode({
      label: 'Test concept',
      category: 'semantic',
      content: 'A test concept for the memory fabric.',
    });
    expect(node.id).toBeTruthy();
    expect(node.label).toBe('Test concept');
    expect(node.accessCount).toBeGreaterThanOrEqual(1);
  });

  it('binds an edge between two nodes', async () => {
    const a = await fabric.createNode({ label: 'Node A', category: 'semantic', content: 'A' });
    const b = await fabric.createNode({ label: 'Node B', category: 'semantic', content: 'B' });
    const edge = await fabric.bindEdge({
      sourceNodeId: a.id,
      targetNodeId: b.id,
      relationshipType: 'RELATED_TO',
      weight: 0.75,
    });
    expect(edge.sourceNodeId).toBe(a.id);
    expect(edge.targetNodeId).toBe(b.id);
    expect(edge.weight).toBe(0.75);
  });

  it('walks the graph via recursive CTE', async () => {
    const a = await fabric.createNode({ label: 'Graph A', category: 'semantic', content: 'A' });
    const b = await fabric.createNode({ label: 'Graph B', category: 'semantic', content: 'B' });
    const c = await fabric.createNode({ label: 'Graph C', category: 'semantic', content: 'C' });
    await fabric.bindEdge({ sourceNodeId: a.id, targetNodeId: b.id, relationshipType: 'RELATED_TO', weight: 0.9 });
    await fabric.bindEdge({ sourceNodeId: b.id, targetNodeId: c.id, relationshipType: 'RELATED_TO', weight: 0.8 });

    const result = await fabric.graphWalk({ startNodeIds: [a.id], maxDepth: 3 });
    expect(result.nodeIds).toContain(a.id);
    expect(result.nodeIds).toContain(b.id);
    expect(result.nodeIds).toContain(c.id);
  });

  it('searches by vector similarity', async () => {
    const embedding = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1.0 : 0.0));
    await fabric.createNode({
      label: 'Vector match test',
      category: 'semantic',
      content: 'Testing vector similarity.',
      embedding,
    });
    const results = await fabric.vectorSearch(embedding, { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].label).toBe('Vector match test');
  });

  it('finds duplicate by vector similarity without raw-array syntax error', async () => {
    const embedding = Array.from({ length: 384 }, (_, i) => (i === 2 ? 1.0 : 0.0));
    const node = await fabric.createNode({
      label: 'Duplicate vector test',
      category: 'semantic',
      content: 'Testing duplicate vector detection.',
      embedding,
    });

    // Should not throw a pgvector syntax error and should return the same node
    const duplicate = await fabric.findDuplicate(embedding, 0.95, 'semantic');
    expect(duplicate).not.toBeNull();
    expect(duplicate?.id).toBe(node.id);
  });

  it('ingests a document and extracts semantic entities from chunks', async () => {
    const generate = async () => JSON.stringify({
      nodes: [
        { id: 'e1', label: 'Chicxulub Impact', category: 'semantic', content: 'Asteroid strike 66 million years ago', confidence: 0.9 },
        { id: 'e2', label: 'K-Pg Extinction', category: 'semantic', content: 'Mass extinction ending dinosaurs', confidence: 0.9 },
      ],
      edges: [
        { sourceNodeId: 'e1', targetNodeId: 'e2', relationshipType: 'CAUSES', weight: 0.95 },
      ],
    });

    const ingester = new DocumentIngester(fabric, generate);
    // Use markdown headings so the chunker splits into multiple units.
    const sections = Array.from({ length: 10 }, (_, i) => `## Section ${i + 1}\n\nThe Chicxulub impact caused the K-Pg extinction event. The asteroid struck the Yucatan Peninsula and released enormous energy.`);
    const text = sections.join('\n\n');

    const result = await ingester.ingest({
      name: 'extinction-doc',
      kind: 'text',
      content: text,
      chunkSize: 500,
      chunkOverlap: 50,
      maxEntitiesPerChunk: 10,
    });

    // Should create at least one chunk node plus extracted entities.
    expect(result.nodes.length).toBeGreaterThan(1);
    const labels = result.nodes.map((n) => n.label);
    expect(labels.some((l) => /Chicxulub/i.test(l))).toBe(true);
    expect(labels.some((l) => /K-Pg/i.test(l))).toBe(true);

    // Should have edges between chunk nodes and extracted entities, plus semantic edges.
    expect(result.edges.length).toBeGreaterThan(0);
    expect(result.edges.some((e) => e.relationshipType === 'CAUSES')).toBe(true);
  });
});
