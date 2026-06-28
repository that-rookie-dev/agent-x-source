/**
 * Synaptic plasticity: weighting, decay, and archival.
 *
 * Group 4 implementation:
 * - Successful use increments edge weight by 0.1, capped at 1.0.
 * - Daily decay multiplies unused edge weights by 0.95 (configurable).
 * - Edges below a floor are deleted; nodes unused for a long period are archived.
 */
import type { MemoryFabric } from './MemoryFabric.js';

export interface PlasticityOptions {
  successIncrement?: number;
  weightCap?: number;
  decayFactor?: number;
  decayFloor?: number;
  archiveDays?: number;
}

export interface PlasticityResult {
  strengthened: number;
  decayed: number;
  deletedEdges: number;
  archivedNodes: number;
}

export class SynapticPlasticity {
  constructor(private fabric: MemoryFabric) {}

  async reinforce(nodeId: string): Promise<void> {
    const { pool } = this.fabric as unknown as { pool: { query: (sql: string, params: unknown[]) => Promise<unknown> } };
    await pool.query(
      `UPDATE memory_edges
       SET weight = LEAST(1.0, weight + 0.1), updated_at = NOW()
       WHERE target_node_id = $1 OR source_node_id = $1`,
      [nodeId],
    );
  }

  async run(options: PlasticityOptions = {}): Promise<PlasticityResult> {
    const { pool } = this.fabric as unknown as { pool: { query: (sql: string, params?: unknown[]) => Promise<unknown> } };
    const decayFactor = options.decayFactor ?? 0.95;
    const decayFloor = options.decayFloor ?? 0.1;
    const archiveDays = options.archiveDays ?? 30;

    const strengthened = 0;

    const { rowCount: decayed } = await pool.query(
      `UPDATE memory_edges
       SET weight = GREATEST($1, weight * $2), updated_at = NOW()
       WHERE updated_at < NOW() - INTERVAL '24 hours'`,
      [decayFloor, decayFactor],
    ) as { rowCount: number };

    const { rowCount: deletedEdges } = await pool.query(
      `DELETE FROM memory_edges WHERE weight <= $1`,
      [decayFloor],
    ) as { rowCount: number };

    const archiveCutoff = new Date(Date.now() - archiveDays * 24 * 60 * 60 * 1000);
    const { rowCount: archivedNodes } = await pool.query(
      `UPDATE memory_nodes
       SET status = 'archived', updated_at = NOW()
       WHERE status = 'active'
         AND id NOT IN (SELECT node_id FROM neuron_activity WHERE last_accessed_at > $1)
         AND created_at < $1`,
      [archiveCutoff],
    ) as { rowCount: number };

    return { strengthened, decayed: decayed ?? 0, deletedEdges: deletedEdges ?? 0, archivedNodes: archivedNodes ?? 0 };
  }
}
