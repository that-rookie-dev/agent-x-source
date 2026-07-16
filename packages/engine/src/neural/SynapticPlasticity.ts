/**
 * Synaptic plasticity: edge reinforcement on successful memory use.
 *
 * The decay/deletion/archival logic has been removed — in a GraphRAG knowledge
 * graph, edges represent extracted relationships that should persist. Decay
 * was causing edges to vanish between sessions, orphaning nodes.
 *
 * Only `reinforce()` remains: it strengthens edges when a node's memory is
 * successfully accessed, providing positive feedback for frequently-used paths.
 */
import type { MemoryFabric } from './MemoryFabric.js';

export class SynapticPlasticity {
  constructor(private fabric: MemoryFabric) {}

  /** Strengthen edges attached to a node when its memory is successfully used. */
  async reinforce(nodeId: string): Promise<void> {
    const { pool } = this.fabric as unknown as { pool: { query: (sql: string, params: unknown[]) => Promise<unknown> } };
    await pool.query(
      `UPDATE memory_edges
       SET weight = LEAST(1.0, weight + 0.1), updated_at = NOW()
       WHERE target_node_id = $1 OR source_node_id = $1`,
      [nodeId],
    );
  }
}
