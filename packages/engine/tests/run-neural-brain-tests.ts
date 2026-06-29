/**
 * Neural Brain Test Runner
 * 
 * Comprehensive test suite for the Neural Brain Structuring system
 */

import { Pool } from 'pg';
import {
  MemoryFabric,
  NeuralBrainIngestionPipeline,
  SubAtomicExtractor,
  BrainEventStreamer,
  CrossClusterBridgeGenerator,
  TestDataCleaner,
  type BrainEvent,
} from '../src/index.js';

// Test configuration
const TEST_DB_URL = process.env['TEST_DATABASE_URL'] || 'postgresql://localhost:3335/agentx';
const TEST_CLUSTER_PREFIX = 'test-cluster-';
const TEST_SOURCE_PREFIX = 'test-source-';

// Mock LLM generator for testing
const mockGenerate = async (prompt: string): Promise<string> => {
  // Extract target node count from prompt
  const match = prompt.match(/approximately (\d+) nodes/);
  const targetCount = match ? parseInt(match[1]) : 10;
  
  const nodes = [];
  const edges = [];
  
  // Create a hierarchical structure
  for (let i = 0; i < Math.min(targetCount, 20); i++) {
    const depthLevel = Math.floor(i / 5);
    nodes.push({
      id: `node-${i}`,
      label: `Test Node ${i}`,
      type: ['Concept', 'Attribute', 'Operation', 'ContextModifier'][i % 4],
      content: `Test content for node ${i}`,
      depthLevel,
      confidence: 0.8 + Math.random() * 0.2,
    });
    
    // Create hierarchical edges
    if (i > 0 && i % 5 !== 0) {
      const parentIdx = Math.floor(i / 5) * 5;
      edges.push({
        sourceNodeId: `node-${parentIdx}`,
        targetNodeId: `node-${i}`,
        relationshipType: 'PARENT_OF',
        weight: 0.9,
      });
    }
  }
  
  return JSON.stringify({ nodes, edges });
};

// Mock embedding generator
const mockEmbed = async (text: string): Promise<number[]> => {
  // Generate deterministic embedding based on text hash
  const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return new Array(384).fill(0).map((_, i) => Math.sin(hash + i) * 0.5 + 0.5);
};

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: Record<string, unknown>;
}

class NeuralBrainTestSuite {
  private pool: Pool;
  private fabric: MemoryFabric;
  private pipeline: NeuralBrainIngestionPipeline;
  private cleaner: TestDataCleaner;
  private results: TestResult[] = [];

  constructor() {
    this.pool = new Pool({ connectionString: TEST_DB_URL });
    this.fabric = new MemoryFabric(this.pool);
    this.pipeline = new NeuralBrainIngestionPipeline(this.pool, this.fabric);
    this.cleaner = new TestDataCleaner(this.pool);
  }

  async setup(): Promise<void> {
    console.log('Setting up test environment...');
    await this.fabric.migrate();
    console.log('Database migrated successfully');
  }

  async cleanup(): Promise<void> {
    console.log('\nCleaning up test data...');
    
    // Get all test clusters and sources
    const { rows: sessions } = await this.pool.query(
      `SELECT DISTINCT session_id FROM memory_nodes WHERE session_id LIKE '${TEST_CLUSTER_PREFIX}%'`
    );
    const sessionIds = sessions.map(row => row.session_id);
    
    const { rows: sources } = await this.pool.query(
      `SELECT DISTINCT source_id FROM memory_nodes WHERE source_id LIKE '${TEST_SOURCE_PREFIX}%'`
    );
    const sourceIds = sources.map(row => row.source_id).filter(Boolean);
    
    if (sessionIds.length > 0 || sourceIds.length > 0) {
      const result = await this.cleaner.cleanup({
        sessionIds,
        sourceIds,
        dryRun: false,
      });
      
      console.log(`Cleaned up ${result.nodesDeleted} nodes, ${result.edgesDeleted} edges`);
      
      // Vacuum database
      await this.cleaner.vacuum();
    }
    
    await this.pool.end();
    console.log('Cleanup complete');
  }

  async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    console.log(`\n🧪 Running: ${name}`);
    
    try {
      await testFn();
      const duration = Date.now() - start;
      this.results.push({ name, passed: true, duration });
      console.log(`✅ Passed (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - start;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.results.push({ name, passed: false, duration, error: errorMsg });
      console.log(`❌ Failed (${duration}ms): ${errorMsg}`);
    }
  }

  async testSubAtomicExtraction(): Promise<void> {
    const extractor = new SubAtomicExtractor({
      clusterId: `${TEST_CLUSTER_PREFIX}extraction-1`,
      sourceId: `${TEST_SOURCE_PREFIX}doc-1`,
      targetDensity: 50,
      maxEdgesPerNode: 7,
      minDepthTiers: 4,
      generate: mockGenerate,
      embed: mockEmbed,
    });

    const text = 'This is a test document. '.repeat(50); // ~100 words
    const result = await extractor.extract(text);

    if (result.nodes.length === 0) {
      throw new Error('No nodes extracted');
    }

    if (result.topology.maxEdgesPerNode > 7) {
      throw new Error(`Max edges per node (${result.topology.maxEdgesPerNode}) exceeds limit of 7`);
    }

    console.log(`  Extracted ${result.nodes.length} nodes, ${result.edges.length} edges`);
    console.log(`  Topology: depth=${result.topology.maxDepth}, avgEdges=${result.topology.avgEdgesPerNode.toFixed(2)}`);
  }

  async testEventStreaming(): Promise<void> {
    const streamer = new BrainEventStreamer({ coalesceMs: 50 });
    const events: BrainEvent[] = [];

    streamer.on((event) => {
      events.push(event);
    });

    // Emit test events
    streamer.emitNodeCreated({
      nodeId: 'test-node-1',
      clusterId: `${TEST_CLUSTER_PREFIX}events-1`,
      type: 'Concept',
      label: 'Test Node',
    });

    streamer.emitSynapseConnected({
      sourceId: 'test-node-1',
      targetId: 'test-node-2',
      edgeType: 'PARENT_OF',
      weight: 0.9,
    });

    streamer.emitNeuronActivated({
      nodeIds: ['test-node-1', 'test-node-2'],
      intensity: 1.0,
    });

    // Wait for events to flush
    await new Promise(resolve => setTimeout(resolve, 100));

    if (events.length !== 3) {
      throw new Error(`Expected 3 events, got ${events.length}`);
    }

    const nodeCreated = events.find(e => e.event === 'NODE_CREATED');
    const synapseConnected = events.find(e => e.event === 'SYNAPSE_CONNECTED');
    const neuronActivated = events.find(e => e.event === 'NEURON_ACTIVATED');

    if (!nodeCreated || !synapseConnected || !neuronActivated) {
      throw new Error('Missing expected event types');
    }

    console.log(`  Received ${events.length} events correctly`);
  }

  async testIngestionPipeline(): Promise<void> {
    const clusterId = `${TEST_CLUSTER_PREFIX}pipeline-1`;
    const sourceId = `${TEST_SOURCE_PREFIX}doc-2`;

    const result = await this.pipeline.ingest({
      text: 'This is a comprehensive test of the neural brain ingestion pipeline. It should extract multiple nodes and edges with proper topology.',
      clusterId,
      sourceId,
      sourceColor: '#3b82f6',
      generate: mockGenerate,
      embed: mockEmbed,
      targetDensity: 50,
      maxEdgesPerNode: 7,
      minDepthTiers: 4,
      enableBridging: false,
    });

    if (result.nodesCreated === 0) {
      throw new Error('No nodes created');
    }

    if (result.edgesCreated === 0) {
      throw new Error('No edges created');
    }

    console.log(`  Created ${result.nodesCreated} nodes, ${result.edgesCreated} edges`);
    console.log(`  Topology violations: ${result.topology.violations.length}`);
  }

  async testCrossClusterBridging(): Promise<void> {
    // Create two clusters
    const cluster1 = `${TEST_CLUSTER_PREFIX}bridge-1`;
    const cluster2 = `${TEST_CLUSTER_PREFIX}bridge-2`;

    await this.pipeline.ingest({
      text: 'First cluster about machine learning and neural networks.',
      clusterId: cluster1,
      generate: mockGenerate,
      embed: mockEmbed,
      enableBridging: false,
    });

    await this.pipeline.ingest({
      text: 'Second cluster about artificial intelligence and deep learning.',
      clusterId: cluster2,
      generate: mockGenerate,
      embed: mockEmbed,
      enableBridging: false,
    });

    // Generate bridges
    const bridgeGen = new CrossClusterBridgeGenerator(this.pool);
    const bridgeResult = await bridgeGen.generateBridges({
      clusterId: cluster2,
      minBridges: 1,
      maxBridges: 3,
      minSimilarity: 0.5,
    });

    console.log(`  Created ${bridgeResult.bridgesCreated} bridges`);
    console.log(`  Scanned ${bridgeResult.candidatesScanned} candidates`);

    const stats = await bridgeGen.getBridgeStats(cluster2);
    console.log(`  Total bridges: ${stats.totalBridges}, Avg weight: ${stats.avgWeight.toFixed(3)}`);
  }

  async testNeuronActivation(): Promise<void> {
    const clusterId = `${TEST_CLUSTER_PREFIX}activation-1`;

    const result = await this.pipeline.ingest({
      text: 'Test document for neuron activation.',
      clusterId,
      generate: mockGenerate,
      embed: mockEmbed,
      enableBridging: false,
    });

    if (result.nodesCreated === 0) {
      throw new Error('No nodes created for activation test');
    }

    // Get node IDs
    const { rows } = await this.pool.query(
      'SELECT id FROM memory_nodes WHERE session_id = $1 LIMIT 3',
      [clusterId]
    );

    const nodeIds = rows.map(row => row.id);

    if (nodeIds.length === 0) {
      throw new Error('No nodes found for activation');
    }

    // Activate neurons
    await this.pipeline.activateNeurons(nodeIds, 1.0);

    // Verify access counts updated
    const { rows: updated } = await this.pool.query(
      'SELECT id, access_count FROM memory_nodes WHERE id = ANY($1::text[])',
      [nodeIds]
    );

    const allActivated = updated.every(row => row.access_count > 0);
    if (!allActivated) {
      throw new Error('Not all neurons were activated');
    }

    console.log(`  Activated ${nodeIds.length} neurons successfully`);
  }

  async testDataCleanup(): Promise<void> {
    const clusterId = `${TEST_CLUSTER_PREFIX}cleanup-1`;

    // Create test data
    await this.pipeline.ingest({
      text: 'Test data for cleanup.',
      clusterId,
      generate: mockGenerate,
      embed: mockEmbed,
      enableBridging: false,
    });

    // Dry run cleanup
    const dryRunResult = await this.cleaner.cleanup({
      sessionIds: [clusterId],
      dryRun: true,
    });

    if (dryRunResult.nodesDeleted === 0) {
      throw new Error('Dry run should have found nodes to delete');
    }

    console.log(`  Dry run: would delete ${dryRunResult.nodesDeleted} nodes`);

    // Actual cleanup
    const cleanupResult = await this.cleaner.cleanup({
      sessionIds: [clusterId],
      dryRun: false,
    });

    if (cleanupResult.nodesDeleted === 0) {
      throw new Error('Cleanup should have deleted nodes');
    }

    console.log(`  Deleted ${cleanupResult.nodesDeleted} nodes, ${cleanupResult.edgesDeleted} edges`);
  }

  async run(): Promise<void> {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Neural Brain Structuring - Test Suite');
    console.log('═══════════════════════════════════════════════════════');

    await this.setup();

    await this.runTest('Sub-Atomic Extraction', () => this.testSubAtomicExtraction());
    await this.runTest('Event Streaming', () => this.testEventStreaming());
    await this.runTest('Ingestion Pipeline', () => this.testIngestionPipeline());
    await this.runTest('Cross-Cluster Bridging', () => this.testCrossClusterBridging());
    await this.runTest('Neuron Activation', () => this.testNeuronActivation());
    await this.runTest('Data Cleanup', () => this.testDataCleanup());

    await this.cleanup();

    this.printSummary();
  }

  printSummary(): void {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  Test Summary');
    console.log('═══════════════════════════════════════════════════════');

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => r.passed === false).length;
    const total = this.results.length;

    console.log(`\nTotal: ${total} | Passed: ${passed} | Failed: ${failed}`);

    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    }

    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);
    console.log(`\nTotal Duration: ${totalDuration}ms`);

    console.log('\n═══════════════════════════════════════════════════════');

    if (failed > 0) {
      process.exit(1);
    }
  }
}

// Run tests
const suite = new NeuralBrainTestSuite();
suite.run().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
