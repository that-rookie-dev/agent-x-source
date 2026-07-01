/**
 * Cross-Cluster Bridge Synapse Generator (Synaptogenesis)
 * 
 * Implements cross-cluster bridging from NEURAL_BRAIN_STRUCTURING.md:
 * - For every new cluster, run vector similarity scan against historical nodes
 * - Generate 3-5 bridge synapses ([:RESONATES_WITH])
 * - Connect peripheral grandchild nodes of new cluster to peripheral grandchild nodes of past clusters
 * - Creates cosmic filaments binding galaxies together
 */

import type { Pool } from 'pg';
import type { MemoryEdgeInput } from './MemoryFabric.js';
import { getLogger } from '@agentx/shared';

export interface BridgeGenerationOptions {
  /** The new cluster ID to bridge */
  clusterId: string;
  /** Minimum number of bridges to create */
  minBridges?: number;
  /** Maximum number of bridges to create */
  maxBridges?: number;
  /** Minimum similarity threshold for bridge candidates */
  minSimilarity?: number;
  /** Only bridge to peripheral nodes (depth >= this value) */
  minDepthForBridge?: number;
  /** Maximum age of historical clusters to consider (days) */
  maxClusterAgeDays?: number;
}

export interface BridgeResult {
  bridgesCreated: number;
  edges: MemoryEdgeInput[];
  candidatesScanned: number;
}

/**
 * Generates cross-cluster bridge synapses using vector similarity
 */
export class CrossClusterBridgeGenerator {
  constructor(private pool: Pool) {}

  /**
   * Generate bridge synapses for a new cluster
   */
  async generateBridges(options: BridgeGenerationOptions): Promise<BridgeResult> {
    const minBridges = options.minBridges ?? 3;
    const maxBridges = options.maxBridges ?? 5;
    const minSimilarity = options.minSimilarity ?? 0.7;
    const minDepthForBridge = options.minDepthForBridge ?? 2; // grandchild level
    const maxClusterAgeDays = options.maxClusterAgeDays ?? 90;

    const logger = getLogger();

    // Step 1: Get peripheral nodes from the new cluster
    const newClusterPeripheralNodes = await this.getPeripheralNodes(
      options.clusterId,
      minDepthForBridge
    );

    if (newClusterPeripheralNodes.length === 0) {
      logger.info('BRIDGE_GEN', `No peripheral nodes in cluster ${options.clusterId}`);
      return { bridgesCreated: 0, edges: [], candidatesScanned: 0 };
    }

    logger.info('BRIDGE_GEN', `Found ${newClusterPeripheralNodes.length} peripheral nodes in new cluster`);

    // Step 2: Get historical clusters (excluding the current one)
    const historicalClusters = await this.getHistoricalClusters(
      options.clusterId,
      maxClusterAgeDays
    );

    if (historicalClusters.length === 0) {
      logger.info('BRIDGE_GEN', 'No historical clusters found for bridging');
      return { bridgesCreated: 0, edges: [], candidatesScanned: 0 };
    }

    logger.info('BRIDGE_GEN', `Found ${historicalClusters.length} historical clusters`);

    // Step 3: For each peripheral node in new cluster, find similar peripheral nodes in historical clusters
    const bridges: MemoryEdgeInput[] = [];
    let candidatesScanned = 0;

    for (const newNode of newClusterPeripheralNodes) {
      if (bridges.length >= maxBridges) break;

      const candidates = await this.findSimilarPeripheralNodes(
        newNode.id,
        newNode.embedding,
        historicalClusters,
        minDepthForBridge,
        minSimilarity,
        maxBridges - bridges.length
      );

      candidatesScanned += candidates.length;

      // Create bridge edges
      for (const candidate of candidates) {
        if (bridges.length >= maxBridges) break;

        bridges.push({
          sourceNodeId: newNode.id,
          targetNodeId: candidate.nodeId,
          relationshipType: 'RESONATES_WITH',
          weight: candidate.similarity,
        });

        logger.debug('BRIDGE_GEN', `Bridge: ${newNode.label} -> ${candidate.label} (similarity: ${candidate.similarity.toFixed(3)})`);
      }
    }

    // Ensure minimum bridges created
    if (bridges.length < minBridges) {
      logger.warn('BRIDGE_GEN', `Only created ${bridges.length} bridges, below minimum ${minBridges}`);
    }

    // Step 4: Insert bridge edges into database
    if (bridges.length > 0) {
      await this.insertBridgeEdges(bridges);
    }

    logger.info('BRIDGE_GEN', `Created ${bridges.length} bridge synapses for cluster ${options.clusterId}`);

    return {
      bridgesCreated: bridges.length,
      edges: bridges,
      candidatesScanned,
    };
  }

  /**
   * Get peripheral nodes (grandchildren and deeper) from a cluster
   */
  private async getPeripheralNodes(
    clusterId: string,
    minDepth: number
  ): Promise<Array<{ id: string; label: string; embedding: number[] | null }>> {
    // Calculate node depths within the cluster using recursive CTE
    const query = `
      WITH RECURSIVE node_depths AS (
        -- Start with root nodes (no incoming PARENT_OF edges within cluster)
        SELECT 
          n.id,
          n.label,
          n.embedding,
          0 as depth
        FROM memory_nodes n
        WHERE n.session_id = $1
          AND n.status = 'active'
          AND n.embedding IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM memory_edges e
            JOIN memory_nodes parent ON e.source_node_id = parent.id
            WHERE e.target_node_id = n.id
              AND e.relationship_type = 'PARENT_OF'
              AND parent.session_id = $1
          )
        
        UNION ALL
        
        -- Recursively find children
        SELECT 
          child.id,
          child.label,
          child.embedding,
          nd.depth + 1
        FROM node_depths nd
        JOIN memory_edges e ON e.source_node_id = nd.id
        JOIN memory_nodes child ON e.target_node_id = child.id
        WHERE e.relationship_type = 'PARENT_OF'
          AND child.session_id = $1
          AND child.status = 'active'
          AND child.embedding IS NOT NULL
      )
      SELECT DISTINCT id, label, embedding
      FROM node_depths
      WHERE depth >= $2
      ORDER BY random()
      LIMIT 20
    `;

    const result = await this.pool.query(query, [clusterId, minDepth]);
    return result.rows.map(row => ({
      id: row.id,
      label: row.label,
      embedding: row.embedding,
    }));
  }

  /**
   * Get historical cluster IDs (excluding current cluster)
   */
  private async getHistoricalClusters(
    currentClusterId: string,
    maxAgeDays: number
  ): Promise<string[]> {
    const query = `
      SELECT DISTINCT session_id
      FROM memory_nodes
      WHERE session_id != $1
        AND status = 'active'
        AND created_at >= NOW() - INTERVAL '${maxAgeDays} days'
        AND session_id IS NOT NULL
      ORDER BY random()
      LIMIT 10
    `;

    const result = await this.pool.query(query, [currentClusterId]);
    return result.rows.map(row => row.session_id);
  }

  /**
   * Find similar peripheral nodes in historical clusters using vector similarity
   */
  private async findSimilarPeripheralNodes(
    sourceNodeId: string,
    sourceEmbedding: number[] | null,
    historicalClusters: string[],
    minDepth: number,
    minSimilarity: number,
    limit: number
  ): Promise<Array<{ nodeId: string; label: string; similarity: number }>> {
    if (!sourceEmbedding || historicalClusters.length === 0) {
      return [];
    }

    // Use cosine similarity with pgvector
    const embeddingStr = `[${sourceEmbedding.join(',')}]`;
    
    const query = `
      WITH historical_peripheral AS (
        -- Get peripheral nodes from historical clusters
        WITH RECURSIVE node_depths AS (
          SELECT 
            n.id,
            n.label,
            n.embedding,
            n.session_id,
            0 as depth
          FROM memory_nodes n
          WHERE n.session_id = ANY($1::text[])
            AND n.status = 'active'
            AND n.embedding IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM memory_edges e
              JOIN memory_nodes parent ON e.source_node_id = parent.id
              WHERE e.target_node_id = n.id
                AND e.relationship_type = 'PARENT_OF'
                AND parent.session_id = n.session_id
            )
          
          UNION ALL
          
          SELECT 
            child.id,
            child.label,
            child.embedding,
            child.session_id,
            nd.depth + 1
          FROM node_depths nd
          JOIN memory_edges e ON e.source_node_id = nd.id
          JOIN memory_nodes child ON e.target_node_id = child.id
          WHERE e.relationship_type = 'PARENT_OF'
            AND child.session_id = nd.session_id
            AND child.status = 'active'
            AND child.embedding IS NOT NULL
        )
        SELECT DISTINCT id, label, embedding, session_id
        FROM node_depths
        WHERE depth >= $2
      )
      SELECT 
        hp.id as node_id,
        hp.label,
        1 - (hp.embedding <=> $3::vector) as similarity
      FROM historical_peripheral hp
      WHERE hp.id != $4
        AND (1 - (hp.embedding <=> $3::vector)) >= $5
      ORDER BY similarity DESC
      LIMIT $6
    `;

    try {
      const result = await this.pool.query(query, [
        historicalClusters,
        minDepth,
        embeddingStr,
        sourceNodeId,
        minSimilarity,
        limit,
      ]);

      return result.rows.map(row => ({
        nodeId: row.node_id,
        label: row.label,
        similarity: parseFloat(row.similarity),
      }));
    } catch (err) {
      getLogger().error('BRIDGE_GEN', `Vector similarity query failed: ${err}`);
      return [];
    }
  }

  /**
   * Insert bridge edges into the database
   */
  private async insertBridgeEdges(edges: MemoryEdgeInput[]): Promise<void> {
    if (edges.length === 0) return;

    const values: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    edges.forEach(edge => {
      values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3})`);
      params.push(
        edge.sourceNodeId,
        edge.targetNodeId,
        edge.relationshipType,
        edge.weight ?? 0.8
      );
      paramIndex += 4;
    });

    const query = `
      INSERT INTO memory_edges (source_node_id, target_node_id, relationship_type, weight)
      VALUES ${values.join(', ')}
      ON CONFLICT (source_node_id, target_node_id, relationship_type) 
      DO UPDATE SET 
        weight = EXCLUDED.weight,
        updated_at = NOW()
    `;

    await this.pool.query(query, params);
  }

  /**
   * Get statistics about existing bridges
   */
  async getBridgeStats(clusterId?: string): Promise<{
    totalBridges: number;
    avgWeight: number;
    clustersCrossed: number;
  }> {
    const query = clusterId
      ? `
        SELECT 
          COUNT(*) as total_bridges,
          AVG(e.weight) as avg_weight,
          COUNT(DISTINCT n2.session_id) as clusters_crossed
        FROM memory_edges e
        JOIN memory_nodes n1 ON e.source_node_id = n1.id
        JOIN memory_nodes n2 ON e.target_node_id = n2.id
        WHERE e.relationship_type = 'RESONATES_WITH'
          AND (n1.session_id = $1 OR n2.session_id = $1)
          AND n1.session_id != n2.session_id
      `
      : `
        SELECT 
          COUNT(*) as total_bridges,
          AVG(e.weight) as avg_weight,
          COUNT(DISTINCT n1.session_id) + COUNT(DISTINCT n2.session_id) as clusters_crossed
        FROM memory_edges e
        JOIN memory_nodes n1 ON e.source_node_id = n1.id
        JOIN memory_nodes n2 ON e.target_node_id = n2.id
        WHERE e.relationship_type = 'RESONATES_WITH'
          AND n1.session_id != n2.session_id
      `;

    const result = await this.pool.query(
      query,
      clusterId ? [clusterId] : []
    );

    const row = result.rows[0];
    return {
      totalBridges: parseInt(row?.total_bridges ?? '0'),
      avgWeight: parseFloat(row?.avg_weight ?? '0'),
      clustersCrossed: parseInt(row?.clusters_crossed ?? '0'),
    };
  }
}
