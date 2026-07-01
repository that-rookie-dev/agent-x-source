/**
 * Cross-session skill transfer.
 *
 * Group 4: finds memory nodes that are accessed across multiple sessions and
 * promotes them into durable skill nodes, then links them back to the
 * originating knowledge.
 */
import type { MemoryFabric } from './MemoryFabric.js';

export interface SkillTransferOptions {
  /** Minimum number of distinct sessions a node must appear in to become a skill. */
  minSessions?: number;
  /** Minimum access count across all sessions. */
  minAccessCount?: number;
}

export interface SkillTransferResult {
  skillsCreated: number;
  linksCreated: number;
}

export class SkillTransfer {
  constructor(private fabric: MemoryFabric) {}

  async transfer(options: SkillTransferOptions = {}): Promise<SkillTransferResult> {
    const minSessions = options.minSessions ?? 2;
    const minAccessCount = options.minAccessCount ?? 5;

    const { rows } = await this.fabric['pool'].query<{ id: string; label: string; content: string; sessionCount: string; totalAccess: string }>(
      `SELECT n.id, n.label, n.content, COUNT(DISTINCT n.session_id) AS "sessionCount", COALESCE(SUM(a.access_count), 0) AS "totalAccess"
       FROM memory_nodes n
       LEFT JOIN neuron_activity a ON a.node_id = n.id
       WHERE n.status = 'active' AND n.session_id IS NOT NULL AND n.category = 'episodic'
       GROUP BY n.id
       HAVING COUNT(DISTINCT n.session_id) >= $1 AND COALESCE(SUM(a.access_count), 0) >= $2`,
      [minSessions, minAccessCount],
    );

    let skillsCreated = 0;
    let linksCreated = 0;

    for (const row of rows) {
      const skill = await this.fabric.createNode({
        label: `Skill: ${row.label}`,
        category: 'system',
        content: row.content,
      });
      skillsCreated++;

      await this.fabric.bindEdge({
        sourceNodeId: row.id,
        targetNodeId: skill.id,
        relationshipType: 'GENERATED_OUTPUT',
        weight: 1.0,
      });
      linksCreated++;
    }

    return { skillsCreated, linksCreated };
  }
}
