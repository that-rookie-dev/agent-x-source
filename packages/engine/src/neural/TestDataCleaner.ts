/**
 * Test Data Cleanup Utility
 * 
 * Provides utilities to clean up test data from the neural brain database
 */

import type { Pool } from 'pg';
import { getLogger } from '@agentx/shared';
import { DividerNodeCleaner } from './DividerNodeCleaner.js';

export interface CleanupOptions {
  /** Delete all nodes and edges */
  wipeAll?: boolean;
  /** Delete nodes by session/cluster ID */
  sessionIds?: string[];
  /** Delete nodes by source ID */
  sourceIds?: string[];
  /** Delete nodes by tag */
  tags?: string[];
  /** Delete benchmark nodes */
  wipeBenchmark?: boolean;
  /** Delete markdown divider-only nodes (---, ***, ___) */
  wipeDividers?: boolean;
  /** Delete nodes older than this many days */
  olderThanDays?: number;
  /** Dry run - don't actually delete, just report what would be deleted */
  dryRun?: boolean;
}

export interface CleanupResult {
  nodesDeleted: number;
  edgesDeleted: number;
  sourcesDeleted: number;
  dryRun: boolean;
  details: string[];
}

/**
 * Utility for cleaning up test data from the neural brain
 */
export class TestDataCleaner {
  constructor(private pool: Pool) {}

  /**
   * Clean up test data based on options
   */
  async cleanup(options: CleanupOptions = {}): Promise<CleanupResult> {
    const logger = getLogger();
    const details: string[] = [];
    let nodesDeleted = 0;
    let edgesDeleted = 0;
    let sourcesDeleted = 0;

    const dryRun = options.dryRun ?? false;
    const action = dryRun ? 'Would delete' : 'Deleting';

    logger.info('TEST_CLEANUP', `Starting cleanup (dry run: ${dryRun})`);

    // Wipe all data
    if (options.wipeAll) {
      logger.warn('TEST_CLEANUP', `${action} ALL nodes and edges`);
      
      if (!dryRun) {
        const edgeResult = await this.pool.query('DELETE FROM memory_edges');
        edgesDeleted = edgeResult.rowCount ?? 0;
        
        const nodeResult = await this.pool.query('DELETE FROM memory_nodes');
        nodesDeleted = nodeResult.rowCount ?? 0;
        
        const sourceResult = await this.pool.query('DELETE FROM memory_sources');
        sourcesDeleted = sourceResult.rowCount ?? 0;
        
        await this.pool.query('DELETE FROM neuron_activity');
        await this.pool.query('DELETE FROM ingestion_jobs');
      } else {
        const nodeCount = await this.pool.query('SELECT COUNT(*) FROM memory_nodes');
        const edgeCount = await this.pool.query('SELECT COUNT(*) FROM memory_edges');
        const sourceCount = await this.pool.query('SELECT COUNT(*) FROM memory_sources');
        nodesDeleted = parseInt(nodeCount.rows[0]?.count ?? '0');
        edgesDeleted = parseInt(edgeCount.rows[0]?.count ?? '0');
        sourcesDeleted = parseInt(sourceCount.rows[0]?.count ?? '0');
      }
      
      details.push(`${action} all data: ${nodesDeleted} nodes, ${edgesDeleted} edges, ${sourcesDeleted} sources`);
      
      return { nodesDeleted, edgesDeleted, sourcesDeleted, dryRun, details };
    }

    // Delete by session IDs
    if (options.sessionIds && options.sessionIds.length > 0) {
      logger.info('TEST_CLEANUP', `${action} nodes from sessions: ${options.sessionIds.join(', ')}`);
      
      const nodeIds = await this.getNodeIdsBySessionIds(options.sessionIds);
      if (nodeIds.length > 0) {
        const result = await this.deleteNodesByIds(nodeIds, dryRun);
        nodesDeleted += result.nodesDeleted;
        edgesDeleted += result.edgesDeleted;
        details.push(`${action} ${result.nodesDeleted} nodes from ${options.sessionIds.length} sessions`);
      }
    }

    // Delete by source IDs
    if (options.sourceIds && options.sourceIds.length > 0) {
      logger.info('TEST_CLEANUP', `${action} nodes from sources: ${options.sourceIds.join(', ')}`);
      
      const nodeIds = await this.getNodeIdsBySourceIds(options.sourceIds);
      if (nodeIds.length > 0) {
        const result = await this.deleteNodesByIds(nodeIds, dryRun);
        nodesDeleted += result.nodesDeleted;
        edgesDeleted += result.edgesDeleted;
        details.push(`${action} ${result.nodesDeleted} nodes from ${options.sourceIds.length} sources`);
      }
      
      // Delete sources themselves
      if (!dryRun) {
        const sourceResult = await this.pool.query(
          'DELETE FROM memory_sources WHERE id = ANY($1::text[])',
          [options.sourceIds]
        );
        sourcesDeleted = sourceResult.rowCount ?? 0;
      } else {
        const sourceCount = await this.pool.query(
          'SELECT COUNT(*) FROM memory_sources WHERE id = ANY($1::text[])',
          [options.sourceIds]
        );
        sourcesDeleted = parseInt(sourceCount.rows[0]?.count ?? '0');
      }
      details.push(`${action} ${sourcesDeleted} sources`);
    }

    // Delete by tags
    if (options.tags && options.tags.length > 0) {
      logger.info('TEST_CLEANUP', `${action} nodes with tags: ${options.tags.join(', ')}`);
      
      const nodeIds = await this.getNodeIdsByTags(options.tags);
      if (nodeIds.length > 0) {
        const result = await this.deleteNodesByIds(nodeIds, dryRun);
        nodesDeleted += result.nodesDeleted;
        edgesDeleted += result.edgesDeleted;
        details.push(`${action} ${result.nodesDeleted} nodes with ${options.tags.length} tags`);
      }
    }

    // Delete benchmark nodes
    if (options.wipeBenchmark) {
      logger.info('TEST_CLEANUP', `${action} benchmark nodes`);
      
      const nodeIds = await this.getBenchmarkNodeIds();
      if (nodeIds.length > 0) {
        const result = await this.deleteNodesByIds(nodeIds, dryRun);
        nodesDeleted += result.nodesDeleted;
        edgesDeleted += result.edgesDeleted;
        details.push(`${action} ${result.nodesDeleted} benchmark nodes`);
      }
    }

    // Delete markdown divider-only nodes
    if (options.wipeDividers) {
      logger.info('TEST_CLEANUP', `${action} markdown divider nodes`);
      const dividerCleaner = new DividerNodeCleaner(this.pool);
      const dividerResult = await dividerCleaner.cleanup({ dryRun });
      nodesDeleted += dividerResult.nodesDeleted;
      edgesDeleted += dividerResult.edgesDeleted;
      if (dividerResult.nodesDeleted > 0) {
        details.push(`${action} ${dividerResult.nodesDeleted} divider node(s): ${dividerResult.deletedLabels.slice(0, 5).join(', ')}`);
      }
    }

    // Delete old nodes
    if (options.olderThanDays != null && options.olderThanDays > 0) {
      logger.info('TEST_CLEANUP', `${action} nodes older than ${options.olderThanDays} days`);
      
      const nodeIds = await this.getOldNodeIds(options.olderThanDays);
      if (nodeIds.length > 0) {
        const result = await this.deleteNodesByIds(nodeIds, dryRun);
        nodesDeleted += result.nodesDeleted;
        edgesDeleted += result.edgesDeleted;
        details.push(`${action} ${result.nodesDeleted} nodes older than ${options.olderThanDays} days`);
      }
    }

    logger.info('TEST_CLEANUP', `Cleanup complete: ${nodesDeleted} nodes, ${edgesDeleted} edges deleted`);

    return { nodesDeleted, edgesDeleted, sourcesDeleted, dryRun, details };
  }

  /**
   * Get node IDs by session IDs
   */
  private async getNodeIdsBySessionIds(sessionIds: string[]): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT id FROM memory_nodes WHERE session_id = ANY($1::text[])',
      [sessionIds]
    );
    return result.rows.map(row => row.id);
  }

  /**
   * Get node IDs by source IDs
   */
  private async getNodeIdsBySourceIds(sourceIds: string[]): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT id FROM memory_nodes WHERE source_id = ANY($1::text[])',
      [sourceIds]
    );
    return result.rows.map(row => row.id);
  }

  /**
   * Get node IDs by tags
   */
  private async getNodeIdsByTags(tags: string[]): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT id FROM memory_nodes WHERE tag = ANY($1::text[])',
      [tags]
    );
    return result.rows.map(row => row.id);
  }

  /**
   * Get benchmark node IDs
   */
  private async getBenchmarkNodeIds(): Promise<string[]> {
    const result = await this.pool.query(
      'SELECT id FROM memory_nodes WHERE is_benchmark = true'
    );
    return result.rows.map(row => row.id);
  }

  /**
   * Get old node IDs
   */
  private async getOldNodeIds(olderThanDays: number): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT id FROM memory_nodes WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'`
    );
    return result.rows.map(row => row.id);
  }

  /**
   * Delete nodes by IDs and their associated edges
   */
  private async deleteNodesByIds(
    nodeIds: string[],
    dryRun: boolean
  ): Promise<{ nodesDeleted: number; edgesDeleted: number }> {
    if (nodeIds.length === 0) {
      return { nodesDeleted: 0, edgesDeleted: 0 };
    }

    if (dryRun) {
      const edgeCount = await this.pool.query(
        'SELECT COUNT(*) FROM memory_edges WHERE source_node_id = ANY($1::text[]) OR target_node_id = ANY($1::text[])',
        [nodeIds]
      );
      return {
        nodesDeleted: nodeIds.length,
        edgesDeleted: parseInt(edgeCount.rows[0]?.count ?? '0'),
      };
    }

    // Delete edges first
    const edgeResult = await this.pool.query(
      'DELETE FROM memory_edges WHERE source_node_id = ANY($1::text[]) OR target_node_id = ANY($1::text[])',
      [nodeIds]
    );

    // Delete neuron activity
    await this.pool.query(
      'DELETE FROM neuron_activity WHERE node_id = ANY($1::text[])',
      [nodeIds]
    );

    // Delete nodes
    const nodeResult = await this.pool.query(
      'DELETE FROM memory_nodes WHERE id = ANY($1::text[])',
      [nodeIds]
    );

    return {
      nodesDeleted: nodeResult.rowCount ?? 0,
      edgesDeleted: edgeResult.rowCount ?? 0,
    };
  }

  /**
   * Vacuum and analyze the database after cleanup
   */
  async vacuum(): Promise<void> {
    const logger = getLogger();
    logger.info('TEST_CLEANUP', 'Running VACUUM ANALYZE...');
    
    await this.pool.query('VACUUM ANALYZE memory_nodes');
    await this.pool.query('VACUUM ANALYZE memory_edges');
    await this.pool.query('VACUUM ANALYZE memory_sources');
    await this.pool.query('VACUUM ANALYZE neuron_activity');
    
    logger.info('TEST_CLEANUP', 'VACUUM ANALYZE complete');
  }

  /**
   * Get cleanup statistics
   */
  async getStats(): Promise<{
    totalNodes: number;
    totalEdges: number;
    totalSources: number;
    benchmarkNodes: number;
    sessionCount: number;
    oldestNode: string | null;
    newestNode: string | null;
  }> {
    const nodeCount = await this.pool.query('SELECT COUNT(*) FROM memory_nodes');
    const edgeCount = await this.pool.query('SELECT COUNT(*) FROM memory_edges');
    const sourceCount = await this.pool.query('SELECT COUNT(*) FROM memory_sources');
    const benchmarkCount = await this.pool.query('SELECT COUNT(*) FROM memory_nodes WHERE is_benchmark = true');
    const sessionCount = await this.pool.query('SELECT COUNT(DISTINCT session_id) FROM memory_nodes WHERE session_id IS NOT NULL');
    const oldestNode = await this.pool.query('SELECT created_at FROM memory_nodes ORDER BY created_at ASC LIMIT 1');
    const newestNode = await this.pool.query('SELECT created_at FROM memory_nodes ORDER BY created_at DESC LIMIT 1');

    return {
      totalNodes: parseInt(nodeCount.rows[0]?.count ?? '0'),
      totalEdges: parseInt(edgeCount.rows[0]?.count ?? '0'),
      totalSources: parseInt(sourceCount.rows[0]?.count ?? '0'),
      benchmarkNodes: parseInt(benchmarkCount.rows[0]?.count ?? '0'),
      sessionCount: parseInt(sessionCount.rows[0]?.count ?? '0'),
      oldestNode: oldestNode.rows[0]?.created_at ?? null,
      newestNode: newestNode.rows[0]?.created_at ?? null,
    };
  }
}
