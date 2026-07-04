/**
 * Integration tests for Neural Brain Structuring system
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import {
  MemoryFabric,
  NeuralBrainIngestionPipeline,
  BrainEventStreamer,
  CrossClusterBridgeGenerator,
  type BrainEvent,
} from '../src/index.js';

const connectionString =
  process.env['TEST_DATABASE_URL'] ?? 'postgresql://agentx:agentx@127.0.0.1:3335/agentx';

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
    const { rows } = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS available`,
    );
    return rows[0]?.available === true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

describe.runIf(await isPgAvailable() && await hasPgVector())('Neural Brain Integration Tests', () => {
  let pool: Pool;
  let fabric: MemoryFabric;
  let pipeline: NeuralBrainIngestionPipeline;
  let streamer: BrainEventStreamer;

  // Mock LLM generator — must match the MemoryExtractor JSON schema
  // (nodes require label/category/content; edges use SEMANTIC_EDGE_TYPES).
  const mockGenerate = async (prompt: string): Promise<string> => {
    return JSON.stringify({
      nodes: [
        {
          id: 'node-1',
          label: 'Test Concept',
          category: 'semantic',
          content: 'A test concept node',
          confidence: 0.9,
        },
        {
          id: 'node-2',
          label: 'Test Attribute',
          category: 'semantic',
          content: 'A test attribute node',
          confidence: 0.85,
        },
        {
          id: 'node-3',
          label: 'Test Operation',
          category: 'semantic',
          content: 'A test operation node',
          confidence: 0.8,
        },
      ],
      edges: [
        {
          sourceNodeId: 'node-1',
          targetNodeId: 'node-2',
          relationshipType: 'HAS_PROPERTY',
          weight: 0.9,
          extractionMethod: 'EXTRACTED',
        },
        {
          sourceNodeId: 'node-2',
          targetNodeId: 'node-3',
          relationshipType: 'REQUIRES',
          weight: 0.85,
          extractionMethod: 'EXTRACTED',
        },
      ],
    });
  };

  // Mock embedding generator
  const mockEmbed = async (text: string): Promise<number[]> => {
    // Return a mock 1024-dimension embedding (BGE-M3 dimension)
    return new Array(1024).fill(0).map(() => Math.random());
  };

  beforeAll(async () => {
    // Setup test database connection
    pool = new Pool({ connectionString });
    
    fabric = new MemoryFabric(pool);
    await fabric.migrate();
    
    pipeline = new NeuralBrainIngestionPipeline(pool, fabric);
    streamer = new BrainEventStreamer();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('StructuredMemoryPipeline (via NeuralBrainIngestionPipeline)', () => {
    it('should extract nodes with target density', async () => {
      const text = 'This is a test text. '.repeat(50); // ~100 words
      const result = await pipeline.ingest({
        text,
        clusterId: 'test-cluster-1',
        sourceId: 'test-source-1',
        generate: mockGenerate,
        embed: mockEmbed,
        enableBridging: false,
      });

      expect(result.nodesCreated).toBeGreaterThan(0);
      expect(result.edgesCreated).toBeGreaterThan(0);
      expect(result.topology.maxEdgesPerNode).toBeLessThanOrEqual(7);
    });

    it('should enforce topology constraints', async () => {
      const result = await pipeline.ingest({
        text: 'Test text',
        clusterId: 'test-cluster-2',
        generate: mockGenerate,
        enableBridging: false,
      });

      expect(result.topology.maxEdgesPerNode).toBeLessThanOrEqual(7);
      expect(result.topology.violatesConstraints).toBe(false);
    });
  });

  describe('BrainEventStreamer', () => {
    it('should emit NODE_CREATED events', (done) => {
      const testStreamer = new BrainEventStreamer({ coalesceMs: 10 });
      const events: BrainEvent[] = [];

      testStreamer.on((event) => {
        events.push(event);
        if (events.length === 1) {
          expect(event.event).toBe('NODE_CREATED');
          expect(event).toHaveProperty('node_id');
          expect(event).toHaveProperty('cluster_id');
          expect(event).toHaveProperty('label');
          done();
        }
      });

      testStreamer.emitNodeCreated({
        nodeId: 'test-node-1',
        clusterId: 'test-cluster-1',
        type: 'Concept',
        label: 'Test Node',
      });
    });

    it('should emit SYNAPSE_CONNECTED events', (done) => {
      const testStreamer = new BrainEventStreamer({ coalesceMs: 10 });

      testStreamer.on((event) => {
        if (event.event === 'SYNAPSE_CONNECTED') {
          expect(event).toHaveProperty('source_id');
          expect(event).toHaveProperty('target_id');
          expect(event).toHaveProperty('edge_type');
          expect(event).toHaveProperty('weight');
          done();
        }
      });

      testStreamer.emitSynapseConnected({
        sourceId: 'node-1',
        targetId: 'node-2',
        edgeType: 'PARENT_OF',
        weight: 0.9,
      });
    });

    it('should emit NEURON_ACTIVATED events', (done) => {
      const testStreamer = new BrainEventStreamer({ coalesceMs: 10 });

      testStreamer.on((event) => {
        if (event.event === 'NEURON_ACTIVATED') {
          expect(event).toHaveProperty('node_ids');
          expect(event).toHaveProperty('intensity');
          expect(Array.isArray(event.node_ids)).toBe(true);
          done();
        }
      });

      testStreamer.emitNeuronActivated({
        nodeIds: ['node-1', 'node-2'],
        intensity: 1.0,
      });
    });

    it('should batch events', async () => {
      const testStreamer = new BrainEventStreamer({ coalesceMs: 50, maxBatchSize: 10 });
      const batches: BrainEvent[][] = [];
      let currentBatch: BrainEvent[] = [];

      testStreamer.on((event) => {
        currentBatch.push(event);
      });

      // Emit multiple events rapidly
      for (let i = 0; i < 5; i++) {
        testStreamer.emitNodeCreated({
          nodeId: `node-${i}`,
          clusterId: 'test-cluster',
          type: 'Concept',
          label: `Node ${i}`,
        });
      }

      // Wait for batch to flush
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(currentBatch.length).toBe(5);
    });
  });

  describe('CrossClusterBridgeGenerator', () => {
    it('should generate bridge statistics', async () => {
      const bridgeGen = new CrossClusterBridgeGenerator(pool);
      const stats = await bridgeGen.getBridgeStats();

      expect(stats).toHaveProperty('totalBridges');
      expect(stats).toHaveProperty('avgWeight');
      expect(stats).toHaveProperty('clustersCrossed');
      expect(typeof stats.totalBridges).toBe('number');
    });
  });

  describe('NeuralBrainIngestionPipeline', () => {
    it('should complete full ingestion pipeline', async () => {
      const result = await pipeline.ingest({
        text: 'This is a comprehensive test of the neural brain ingestion pipeline. It should extract multiple nodes and edges.',
        clusterId: 'test-session-1',
        sourceId: 'test-doc-1',
        sourceColor: '#3b82f6',
        generate: mockGenerate,
        embed: mockEmbed,
        maxEdgesPerNode: 7,
        minDepthTiers: 4,
        enableBridging: false, // Disable for isolated test
      });

      expect(result.nodesCreated).toBeGreaterThan(0);
      expect(result.edgesCreated).toBeGreaterThan(0);
      expect(result.topology).toBeDefined();
      expect(result.events.nodeCreated).toBeGreaterThan(0);
      expect(result.events.synapseConnected).toBeGreaterThan(0);
    });

    it('should activate neurons', async () => {
      const events: BrainEvent[] = [];
      const testStreamer = new BrainEventStreamer({ coalesceMs: 10 });

      testStreamer.on((event) => {
        events.push(event);
      });

      await pipeline.activateNeurons(['node-1', 'node-2'], 1.0, testStreamer);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const activationEvents = events.filter((e) => e.event === 'NEURON_ACTIVATED');
      expect(activationEvents.length).toBeGreaterThan(0);
    });

    it('should get ingestion statistics', async () => {
      const stats = await pipeline.getIngestionStats();

      expect(stats).toHaveProperty('totalNodes');
      expect(stats).toHaveProperty('totalEdges');
      expect(stats).toHaveProperty('totalBridges');
      expect(stats).toHaveProperty('avgEdgesPerNode');
      expect(typeof stats.totalNodes).toBe('number');
    });
  });
});
