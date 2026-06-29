/**
 * Memory consolidation background task.
 *
 * Compresses old episodic conversation nodes into long-term semantic
 * summaries, keeps the most recent raw nodes, and decays unused edges.
 *
 * Group 3 stub: the algorithm is intentionally simple. The full version will
 * use an LLM to summarize >20-turn sessions into clean semantic nodes and
 * cross-link them to source knowledge.
 */
import type { MemoryFabric } from './MemoryFabric.js';
import { LocalLLMJudge } from './LocalLLMJudge.js';

export type SummarizeFn = (texts: string[]) => Promise<string>;

export async function createLocalLLMSummarizer(modelName?: string): Promise<SummarizeFn> {
  const judge = new LocalLLMJudge({ modelName });
  return async (texts: string[]) => {
    const combined = texts.join('\n\n');
    const prompt = `Summarize the following conversation into a concise long-term memory note. Capture key facts, decisions, and user intent. Keep under 400 words.\n\n${combined}`;
    try {
      return await judge.generate(prompt, { maxTokens: 512 });
    } catch {
      return texts.join('\n\n---\n\n');
    }
  };
}

export interface ConsolidationOptions {
  /** Sessions with more than this many episodic nodes are consolidated. */
  turnThreshold?: number;
  /** Number of most recent raw episodic nodes to keep after consolidation. */
  keepLast?: number;
  /** Only consolidate sessions idle for at least this many milliseconds. */
  idleMs?: number;
  summarize?: SummarizeFn;
}

export interface ConsolidationResult {
  sessionsProcessed: number;
  nodesArchived: number;
  summariesCreated: number;
}

export class MemoryConsolidator {
  constructor(private fabric: MemoryFabric, private summarize?: SummarizeFn) {}

  async consolidate(options: ConsolidationOptions = {}): Promise<ConsolidationResult> {
    const turnThreshold = options.turnThreshold ?? 20;
    const keepLast = options.keepLast ?? 5;
    const idleMs = options.idleMs ?? 60_000;
    const summarize = options.summarize ?? this.summarize ?? (async (texts: string[]) => texts.join('\n\n---\n\n'));

    const { rows: sessions } = await this.fabric['pool'].query<{ sessionId: string; count: string }>(
      `SELECT session_id AS "sessionId", COUNT(*) AS count
       FROM memory_nodes
       WHERE category = 'episodic' AND status = 'active' AND session_id IS NOT NULL
       GROUP BY session_id
       HAVING COUNT(*) > $1`,
      [turnThreshold],
    );

    let sessionsProcessed = 0;
    let nodesArchived = 0;
    let summariesCreated = 0;
    const cutoff = new Date(Date.now() - idleMs);

    for (const row of sessions) {
      const { rows: nodes } = await this.fabric['pool'].query<{ id: string; updatedAt: Date; content: string }>(
        `SELECT id, updated_at AS "updatedAt", content
         FROM memory_nodes
         WHERE category = 'episodic' AND status = 'active' AND session_id = $1
         ORDER BY updated_at DESC`,
        [row.sessionId],
      );

      if (nodes.length <= turnThreshold) continue;
      if (nodes[0] && nodes[0].updatedAt > cutoff) continue;

      sessionsProcessed++;
      const toArchive = nodes.slice(keepLast);
      const sorted = toArchive.map((n) => n.content).reverse();
      const summaryContent = await summarize(sorted);

      const summaryNode = await this.fabric.createNode({
        label: `Consolidated session ${row.sessionId.slice(0, 8)}`,
        category: 'semantic',
        content: summaryContent,
        sessionId: row.sessionId,
      });
      summariesCreated++;

      for (const n of toArchive) {
        await this.fabric['pool'].query(
          `UPDATE memory_nodes SET status = 'archived', updated_at = NOW() WHERE id = $1`,
          [n.id],
        );
        await this.fabric.bindEdge({
          sourceNodeId: n.id,
          targetNodeId: summaryNode.id,
          relationshipType: 'GENERATED_OUTPUT',
          weight: 1.0,
        });
        nodesArchived++;
      }
    }

    return { sessionsProcessed, nodesArchived, summariesCreated };
  }
}

