/**
 * One-time / on-demand cleanup for markdown divider nodes (---, ***, ___) that
 * were ingested before sanitizeIngestText() was applied.
 */

import type { Pool } from 'pg';
import { getLogger } from '@agentx/shared';
import { isDividerOnlyNode } from './sanitizeIngestText.js';

export interface DividerCleanupOptions {
  /** Report matches without deleting (default false). */
  dryRun?: boolean;
}

export interface DividerCleanupResult {
  nodesDeleted: number;
  edgesDeleted: number;
  dryRun: boolean;
  deletedNodeIds: string[];
  /** Human-readable labels of removed nodes (for logs). */
  deletedLabels: string[];
}

export class DividerNodeCleaner {
  constructor(private pool: Pool) {}

  /**
   * Find and delete nodes whose label/content is only a markdown horizontal rule.
   */
  async cleanup(options: DividerCleanupOptions = {}): Promise<DividerCleanupResult> {
    const logger = getLogger();
    const dryRun = options.dryRun ?? false;
    const action = dryRun ? 'Would delete' : 'Deleting';

    const matches = await this.findDividerNodes();
    if (matches.length === 0) {
      logger.info('DIVIDER_CLEANUP', 'No divider-only nodes found');
      return { nodesDeleted: 0, edgesDeleted: 0, dryRun, deletedNodeIds: [], deletedLabels: [] };
    }

    const nodeIds = matches.map((m) => m.id);
    const deletedLabels = matches.map((m) => m.label.trim() || m.content.trim() || m.id);

    logger.info('DIVIDER_CLEANUP', `${action} ${nodeIds.length} divider-only node(s): ${deletedLabels.slice(0, 8).join(', ')}${deletedLabels.length > 8 ? '…' : ''}`);

    const { nodesDeleted, edgesDeleted } = await this.deleteNodesByIds(nodeIds, dryRun);

    return {
      nodesDeleted,
      edgesDeleted,
      dryRun,
      deletedNodeIds: dryRun ? [] : nodeIds,
      deletedLabels,
    };
  }

  /** SQL pre-filter + JS verification via isDividerOnlyNode(). */
  async findDividerNodes(): Promise<Array<{ id: string; label: string; content: string }>> {
    const { rows } = await this.pool.query<{ id: string; label: string; content: string }>(`
      SELECT id, label, content
      FROM memory_nodes
      WHERE btrim(label) ~ '^[-–—*_=\\s]{3,}$'
         OR btrim(content) ~ '^[-–—*_=\\s]{3,}$'
         OR btrim(label) IN ('---', '***', '___', '----', '-----')
         OR btrim(content) IN ('---', '***', '___', '----', '-----')
    `);
    return rows.filter((r) => isDividerOnlyNode(r.label ?? '', r.content ?? ''));
  }

  private async deleteNodesByIds(
    nodeIds: string[],
    dryRun: boolean,
  ): Promise<{ nodesDeleted: number; edgesDeleted: number }> {
    if (nodeIds.length === 0) return { nodesDeleted: 0, edgesDeleted: 0 };

    if (dryRun) {
      const edgeCount = await this.pool.query(
        'SELECT COUNT(*)::int AS count FROM memory_edges WHERE source_node_id = ANY($1::uuid[]) OR target_node_id = ANY($1::uuid[])',
        [nodeIds],
      );
      return {
        nodesDeleted: nodeIds.length,
        edgesDeleted: edgeCount.rows[0]?.count ?? 0,
      };
    }

    const edgeResult = await this.pool.query(
      'DELETE FROM memory_edges WHERE source_node_id = ANY($1::uuid[]) OR target_node_id = ANY($1::uuid[])',
      [nodeIds],
    );
    await this.pool.query(
      'DELETE FROM neuron_activity WHERE node_id = ANY($1::uuid[])',
      [nodeIds],
    );
    const nodeResult = await this.pool.query(
      'DELETE FROM memory_nodes WHERE id = ANY($1::uuid[])',
      [nodeIds],
    );

    return {
      nodesDeleted: nodeResult.rowCount ?? 0,
      edgesDeleted: edgeResult.rowCount ?? 0,
    };
  }
}
