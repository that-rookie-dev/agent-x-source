/**
 * Neural Brain Ingestion Pipeline
 * 
 * Implements the complete 6-step execution command loop from NEURAL_BRAIN_STRUCTURING.md:
 * 1. Parse & Structurize: Break text into sub-atomic nodes
 * 2. Verify Topology Constraints: Ensure max 7 edges per node, min 4 depth tiers
 * 3. Generate Cypher Transactions: Insert into PostgreSQL AGE + pgvector
 * 4. Emit Visualization Streams: Output NODE_CREATED, SYNAPSE_CONNECTED events
 * 5. Generate Cross-Cluster Bridges: Create RESONATES_WITH edges
 * 6. Activate Neurons: Emit NEURON_ACTIVATED for retrieval
 */

import type { Pool } from 'pg';
import { getLogger } from '@agentx/shared';
import { SubAtomicExtractor, type SubAtomicExtractionOptions } from './SubAtomicExtractor.js';
import { AtomicExtractor } from './AtomicExtractor.js';
import { BrainEventStreamer, getGlobalBrainEventStreamer } from './BrainEventStreamer.js';
import { CrossClusterBridgeGenerator, type BridgeGenerationOptions } from './CrossClusterBridgeGenerator.js';
import type { MemoryFabric } from './MemoryFabric.js';
import type { MemoryNodeInput, MemoryEdgeInput } from './MemoryFabric.js';
import type { GenerateFn } from './MemoryExtractor.js';

export interface IngestionPipelineOptions {
  /** The text to ingest */
  text: string;
  /** Cluster/session ID */
  clusterId: string;
  /** Source ID for provenance */
  sourceId?: string;
  /** Source color for visualization */
  sourceColor?: string;
  /** LLM generator function */
  generate: GenerateFn;
  /** Embedding generator function */
  embed?: (text: string) => Promise<number[]>;
  /**
   * Extraction strategy:
   * - 'dynamic' (default): AtomicExtractor analyzes content complexity and extracts
   *   as many atoms as the text actually contains (no fixed ratio).
   * - 'fixed': SubAtomicExtractor targets `targetDensity` nodes per 100 words.
   */
  extractionMode?: 'dynamic' | 'fixed';
  /** Granularity for dynamic extraction. Defaults to 'atomic' (maximum detail). */
  granularity?: 'atomic' | 'balanced' | 'sparse';
  /** Target node density (nodes per 100 words) — only used when extractionMode === 'fixed'. */
  targetDensity?: number;
  /** Maximum edges per node */
  maxEdgesPerNode?: number;
  /** Minimum depth tiers */
  minDepthTiers?: number;
  /** Enable cross-cluster bridging */
  enableBridging?: boolean;
  /** Bridge generation options */
  bridgeOptions?: Partial<BridgeGenerationOptions>;
  /** Custom event streamer (defaults to global) */
  eventStreamer?: BrainEventStreamer;
}

export interface IngestionResult {
  nodesCreated: number;
  edgesCreated: number;
  bridgesCreated: number;
  topology: {
    maxDepth: number;
    avgEdgesPerNode: number;
    maxEdgesPerNode: number;
    violatesConstraints: boolean;
    violations: string[];
  };
  events: {
    nodeCreated: number;
    synapseConnected: number;
  };
  /** Content analysis (only present when extractionMode === 'dynamic'). */
  analysis?: {
    textComplexity: number;
    conceptDensity: number;
    extractionRatio: number;
    technicalTerms: number;
    relationships: number;
  };
}

/** Common shape returned by both extractors plus optional dynamic analysis. */
interface ExtractionOutput {
  nodes: MemoryNodeInput[];
  edges: MemoryEdgeInput[];
  topology: IngestionResult['topology'];
  analysis?: IngestionResult['analysis'];
}

/**
 * Complete neural brain ingestion pipeline
 */
export class NeuralBrainIngestionPipeline {
  private eventStreamer: BrainEventStreamer;
  private bridgeGenerator: CrossClusterBridgeGenerator;

  constructor(
    private pool: Pool,
    private fabric: MemoryFabric
  ) {
    this.eventStreamer = getGlobalBrainEventStreamer();
    this.bridgeGenerator = new CrossClusterBridgeGenerator(pool);
  }

  /**
   * Execute the complete 6-step ingestion pipeline
   */
  async ingest(options: IngestionPipelineOptions): Promise<IngestionResult> {
    const logger = getLogger();
    const streamer = options.eventStreamer ?? this.eventStreamer;

    logger.info('NEURAL_INGEST', `Starting ingestion for cluster ${options.clusterId}`);

    // STEP 1 & 2: Parse & Structurize + Verify Topology Constraints
    const extractionResult = await this.extractStructure(options);

    if (extractionResult.analysis) {
      logger.info('NEURAL_INGEST', `Dynamic analysis: complexity=${extractionResult.analysis.textComplexity.toFixed(2)}, density=${extractionResult.analysis.conceptDensity.toFixed(1)}, ratio=${extractionResult.analysis.extractionRatio.toFixed(1)} nodes/100w`);
    }
    logger.info('NEURAL_INGEST', `Extracted ${extractionResult.nodes.length} nodes, ${extractionResult.edges.length} edges`);
    logger.info('NEURAL_INGEST', `Topology: depth=${extractionResult.topology.maxDepth}, avgEdges=${extractionResult.topology.avgEdgesPerNode.toFixed(2)}, maxEdges=${extractionResult.topology.maxEdgesPerNode}`);

    if (extractionResult.topology.violatesConstraints) {
      logger.warn('NEURAL_INGEST', `Topology violations: ${extractionResult.topology.violations.join('; ')}`);
    }

    // STEP 3: Generate Cypher Transactions (Insert into database)
    const { nodesInserted, edgesInserted } = await this.insertIntoDatabase(
      extractionResult.nodes,
      extractionResult.edges
    );

    logger.info('NEURAL_INGEST', `Inserted ${nodesInserted} nodes, ${edgesInserted} edges into database`);

    // STEP 4: Emit Visualization Streams
    const eventCounts = await this.emitVisualizationEvents(
      extractionResult.nodes,
      extractionResult.edges,
      options.sourceColor,
      streamer
    );

    logger.info('NEURAL_INGEST', `Emitted ${eventCounts.nodeCreated} NODE_CREATED, ${eventCounts.synapseConnected} SYNAPSE_CONNECTED events`);

    // STEP 5: Generate Cross-Cluster Bridges (if enabled)
    let bridgesCreated = 0;
    if (options.enableBridging !== false) {
      const bridgeResult = await this.generateCrossClusterBridges({
        clusterId: options.clusterId,
        ...options.bridgeOptions,
      });

      bridgesCreated = bridgeResult.bridgesCreated;
      
      if (bridgesCreated > 0) {
        logger.info('NEURAL_INGEST', `Created ${bridgesCreated} cross-cluster bridge synapses`);
        
        // Emit events for bridge synapses
        for (const edge of bridgeResult.edges) {
          streamer.emitSynapseConnected({
            sourceId: edge.sourceNodeId,
            targetId: edge.targetNodeId,
            edgeType: 'RESONATES_WITH',
            weight: edge.weight ?? 0.8,
          });
        }
      }
    }

    // Force flush all queued events
    streamer.forceFlush();

    logger.info('NEURAL_INGEST', `Ingestion complete for cluster ${options.clusterId}`);

    return {
      nodesCreated: nodesInserted,
      edgesCreated: edgesInserted + bridgesCreated,
      bridgesCreated,
      topology: extractionResult.topology,
      events: eventCounts,
      analysis: extractionResult.analysis,
    };
  }

  /**
   * STEP 1 & 2: Extract atoms and verify topology.
   *
   * Defaults to the dynamic AtomicExtractor (content-aware, no fixed ratio).
   * Set `extractionMode: 'fixed'` to use the density-targeted SubAtomicExtractor.
   */
  private async extractStructure(options: IngestionPipelineOptions): Promise<ExtractionOutput> {
    const mode = options.extractionMode ?? 'dynamic';

    if (mode === 'fixed') {
      const extractorOptions: SubAtomicExtractionOptions = {
        clusterId: options.clusterId,
        sourceId: options.sourceId,
        targetDensity: options.targetDensity,
        maxEdgesPerNode: options.maxEdgesPerNode,
        minDepthTiers: options.minDepthTiers,
        generate: options.generate,
        embed: options.embed,
      };
      const extractor = new SubAtomicExtractor(extractorOptions);
      const result = await extractor.extract(options.text);
      return { nodes: result.nodes, edges: result.edges, topology: result.topology };
    }

    // Dynamic, content-aware extraction (default)
    const extractor = new AtomicExtractor({
      clusterId: options.clusterId,
      sourceId: options.sourceId,
      maxEdgesPerNode: options.maxEdgesPerNode,
      minDepthTiers: options.minDepthTiers,
      granularity: options.granularity ?? 'atomic',
      generate: options.generate,
      embed: options.embed,
    });
    const result = await extractor.extract(options.text);
    return {
      nodes: result.nodes,
      edges: result.edges,
      topology: result.topology,
      analysis: result.analysis,
    };
  }

  /**
   * STEP 3: Insert nodes and edges into PostgreSQL
   */
  private async insertIntoDatabase(
    nodes: MemoryNodeInput[],
    edges: MemoryEdgeInput[]
  ): Promise<{ nodesInserted: number; edgesInserted: number }> {
    let nodesInserted = 0;
    let edgesInserted = 0;

    // Insert nodes
    for (const node of nodes) {
      try {
        await this.fabric.createNode(node);
        nodesInserted++;
      } catch (err) {
        getLogger().error('NEURAL_INGEST', `Failed to insert node ${node.id}: ${err}`);
      }
    }

    // Insert edges
    for (const edge of edges) {
      try {
        await this.fabric.bindEdge(edge);
        edgesInserted++;
      } catch (err) {
        getLogger().error('NEURAL_INGEST', `Failed to insert edge ${edge.sourceNodeId}->${edge.targetNodeId}: ${err}`);
      }
    }

    return { nodesInserted, edgesInserted };
  }

  /**
   * STEP 4: Emit visualization events
   */
  private async emitVisualizationEvents(
    nodes: MemoryNodeInput[],
    edges: MemoryEdgeInput[],
    sourceColor: string | undefined,
    streamer: BrainEventStreamer
  ): Promise<{ nodeCreated: number; synapseConnected: number }> {
    let nodeCreated = 0;
    let synapseConnected = 0;

    // Emit NODE_CREATED events
    for (const node of nodes) {
      if (!node.id) continue;

      streamer.emitNodeCreated({
        nodeId: node.id,
        clusterId: node.sessionId ?? 'unknown',
        type: this.mapCategoryToEventType(node.category),
        label: node.label,
        content: node.content,
        x: node.x,
        y: node.y,
        sourceColor,
      });

      nodeCreated++;
    }

    // Emit SYNAPSE_CONNECTED events
    for (const edge of edges) {
      streamer.emitSynapseConnected({
        sourceId: edge.sourceNodeId,
        targetId: edge.targetNodeId,
        edgeType: this.mapRelationshipToEventType(edge.relationshipType),
        weight: edge.weight ?? 0.8,
      });

      synapseConnected++;
    }

    return { nodeCreated, synapseConnected };
  }

  /**
   * Map memory category to event type
   */
  private mapCategoryToEventType(
    category: 'persona' | 'tool' | 'episodic' | 'semantic' | 'source_doc' | 'system'
  ): 'Concept' | 'Attribute' | 'Operation' | 'State' | 'Session' {
    switch (category) {
      case 'semantic':
        return 'Concept';
      case 'tool':
        return 'Operation';
      case 'episodic':
        return 'Session';
      case 'system':
        return 'State';
      default:
        return 'Attribute';
    }
  }

  /**
   * Map relationship type to event edge type
   */
  private mapRelationshipToEventType(
    type: string
  ): 'PARENT_OF' | 'DEPENDS_ON' | 'MODIFIES' | 'RESONATES_WITH' {
    if (type === 'PARENT_OF' || type === 'CONTAINS') return 'PARENT_OF';
    if (type === 'DEPENDS_ON' || type === 'REQUIRES') return 'DEPENDS_ON';
    if (type === 'MODIFIES' || type === 'INFLUENCES') return 'MODIFIES';
    return 'RESONATES_WITH';
  }

  /**
   * STEP 5: Generate cross-cluster bridge synapses
   */
  private async generateCrossClusterBridges(
    options: BridgeGenerationOptions
  ): Promise<{ bridgesCreated: number; edges: MemoryEdgeInput[] }> {
    try {
      const result = await this.bridgeGenerator.generateBridges(options);
      return {
        bridgesCreated: result.bridgesCreated,
        edges: result.edges,
      };
    } catch (err) {
      getLogger().error('NEURAL_INGEST', `Bridge generation failed: ${err}`);
      return { bridgesCreated: 0, edges: [] };
    }
  }

  /**
   * STEP 6: Activate neurons during retrieval (called separately during RAG)
   */
  async activateNeurons(
    nodeIds: string[],
    intensity: number = 1.0,
    streamer?: BrainEventStreamer
  ): Promise<void> {
    const eventStreamer = streamer ?? this.eventStreamer;

    // Update access counts in database
    if (nodeIds.length > 0) {
      const placeholders = nodeIds.map((_, i) => `$${i + 1}`).join(',');
      await this.pool.query(
        `UPDATE memory_nodes 
         SET access_count = access_count + 1, 
             last_accessed_at = NOW() 
         WHERE id IN (${placeholders})`,
        nodeIds
      );
    }

    // Emit NEURON_ACTIVATED event
    eventStreamer.emitNeuronActivated({
      nodeIds,
      intensity,
    });

    eventStreamer.forceFlush();
  }

  /**
   * Get ingestion statistics
   */
  async getIngestionStats(clusterId?: string): Promise<{
    totalNodes: number;
    totalEdges: number;
    totalBridges: number;
    avgDepth: number;
    avgEdgesPerNode: number;
  }> {
    const nodeQuery = clusterId
      ? `SELECT COUNT(*) as count FROM memory_nodes WHERE session_id = $1 AND status = 'active'`
      : `SELECT COUNT(*) as count FROM memory_nodes WHERE status = 'active'`;

    const edgeQuery = clusterId
      ? `SELECT COUNT(*) as count FROM memory_edges e 
         JOIN memory_nodes n ON e.source_node_id = n.id 
         WHERE n.session_id = $1`
      : `SELECT COUNT(*) as count FROM memory_edges`;

    const nodeResult = await this.pool.query(
      nodeQuery,
      clusterId ? [clusterId] : []
    );
    const edgeResult = await this.pool.query(
      edgeQuery,
      clusterId ? [clusterId] : []
    );

    const bridgeStats = await this.bridgeGenerator.getBridgeStats(clusterId);

    const totalNodes = parseInt(nodeResult.rows[0]?.count ?? '0');
    const totalEdges = parseInt(edgeResult.rows[0]?.count ?? '0');

    return {
      totalNodes,
      totalEdges,
      totalBridges: bridgeStats.totalBridges,
      avgDepth: 0, // TODO: Calculate from recursive CTE
      avgEdgesPerNode: totalNodes > 0 ? totalEdges / totalNodes : 0,
    };
  }
}
