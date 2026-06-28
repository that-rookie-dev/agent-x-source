/**
 * Background memory pipeline for Group 3 ingestion.
 *
 * Orchestrates:
 * - Web staging distillation (raw JSONB -> distilled content -> memory nodes)
 * - Domain aggregation (pages from the same domain grouped under a host cluster)
 * - Duplicate detection (exact content hash + vector similarity)
 * - Memory consolidation (episodic -> semantic)
 * - Cross-linking between new memory and existing knowledge
 *
 * The pipeline is designed to run periodically from a scheduler or worker.
 */
import { createHash } from 'node:crypto';
import type { MemoryFabric } from './MemoryFabric.js';
import type { MemoryConsolidator } from './MemoryConsolidator.js';
import type { DocumentIngester } from './DocumentIngester.js';
import { extractArticle } from './ReadabilityExtractor.js';

export interface DistillFn {
  (rawPayload: unknown): Promise<string>;
}

export interface PipelineOptions {
  consolidator: MemoryConsolidator;
  ingester: DocumentIngester;
  distill?: DistillFn;
  domainCluster?: boolean;
  /** Optional embedding provider for similarity de-duplication. */
  embed?: (text: string) => Promise<number[]>;
}

export interface PipelineResult {
  distilled: number;
  domainClusters: number;
  duplicatesSkipped: number;
  consolidated: ConsolidationResult;
}

export interface ConsolidationResult {
  sessionsProcessed: number;
  nodesArchived: number;
  summariesCreated: number;
}

export class MemoryPipeline {
  constructor(
    private fabric: MemoryFabric,
    private options: PipelineOptions,
  ) {}

  async run(): Promise<PipelineResult> {
    const { distilled, domainClusters, duplicatesSkipped } = await this.distillWebStaging();
    const consolidated = await this.options.consolidator.consolidate();
    return { distilled, domainClusters, duplicatesSkipped, consolidated };
  }

  private async distillWebStaging(): Promise<{ distilled: number; domainClusters: number; duplicatesSkipped: number }> {
    const pending = await this.fabric.getPendingWebStaging(50);
    if (pending.length === 0) return { distilled: 0, domainClusters: 0, duplicatesSkipped: 0 };

    const distill = this.options.distill ?? defaultDistill;
    let distilled = 0;
    let duplicatesSkipped = 0;
    const domainMap = new Map<string, { sourceId: string; hostNodeId: string }>();
    const seenHashes = new Set<string>();

    for (const item of pending) {
      const raw = typeof item.rawPayload === 'string' ? JSON.parse(item.rawPayload) : (item.rawPayload as any);
      const rawText = raw?.text ?? '';
      if (!rawText) {
        await this.fabric.markWebStagingDone(item.id);
        continue;
      }

      const contentHash = raw?.contentHash ?? hashText(rawText);
      if (seenHashes.has(contentHash)) {
        duplicatesSkipped++;
        await this.fabric.markWebStagingDone(item.id);
        continue;
      }

      const article = extractArticle(rawText);
      const content = await distill({ title: article.title, content: article.content, excerpt: article.excerpt });
      await this.fabric.markWebStagingDistilled(item.id, content);

      if (await this.isDuplicate(content)) {
        duplicatesSkipped++;
        await this.fabric.markWebStagingDone(item.id);
        continue;
      }

      seenHashes.add(contentHash);

      const domain = item.domain;
      let domainSource = domainMap.get(domain);
      if (!domainSource && this.options.domainCluster) {
        const source = await this.fabric.createSource(domain, 'web_domain', domainColor(domain));
        const hostNode = await this.fabric.createNode({
          label: `Host: ${domain}`,
          category: 'source_doc',
          content: `Domain cluster for ${domain}`,
          sourceId: source.id,
        });
        domainSource = { sourceId: source.id, hostNodeId: hostNode.id };
        domainMap.set(domain, domainSource);
      }

      const pageNode = await this.fabric.createNode({
        label: article.title || `Web: ${domain}`,
        category: 'source_doc',
        content,
        sourceId: domainSource?.sourceId,
      });

      if (domainSource) {
        await this.fabric.bindEdge({
          sourceNodeId: domainSource.hostNodeId,
          targetNodeId: pageNode.id,
          relationshipType: 'CONTAINS',
          weight: 1.0,
        });
      }

      await this.crossLinkToKnowledge(pageNode.id, content);
      await this.fabric.markWebStagingDone(item.id);
      distilled++;
    }

    return { distilled, domainClusters: domainMap.size, duplicatesSkipped };
  }

  private async isDuplicate(content: string): Promise<boolean> {
    if (!this.options.embed) return false;
    try {
      const embedding = await this.options.embed(content);
      const duplicate = await this.fabric.findDuplicate(embedding, 0.97, 'source_doc');
      return !!duplicate;
    } catch {
      return false;
    }
  }

  private async crossLinkToKnowledge(nodeId: string, content: string): Promise<void> {
    const words = content.split(/\s+/).filter((w) => w.length > 4).slice(0, 10);
    if (words.length === 0) return;
    const pattern = words.map((w) => `%${w}%`).join('|');
    const { rows } = await this.fabric['pool'].query<{ id: string }>(
      `SELECT id FROM memory_nodes
       WHERE category IN ('semantic', 'source_doc') AND status = 'active' AND id != $1
         AND content ILIKE ANY ($2::text[])
       LIMIT 5`,
      [nodeId, pattern],
    );
    for (const row of rows) {
      await this.fabric.bindEdge({
        sourceNodeId: row.id,
        targetNodeId: nodeId,
        relationshipType: 'RELATED_TO',
        weight: 0.6,
      });
    }
  }
}

function defaultDistill(rawPayload: unknown): Promise<string> {
  const payload = rawPayload as { title?: string; content?: string; excerpt?: string };
  if (payload?.content) return Promise.resolve(`${payload.title ? `# ${payload.title}\n\n` : ''}${payload.content}`.slice(0, 4000));
  if (typeof rawPayload === 'string') return Promise.resolve(rawPayload);
  return Promise.resolve(JSON.stringify(rawPayload, null, 2).slice(0, 4000));
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function domainColor(domain: string): string {
  const colors = ['#ff4d4d', '#4da6ff', '#ffd24d', '#4dff88', '#d24dff', '#ff8c4d', '#4dffea', '#ff4da6'];
  let hash = 0;
  for (let i = 0; i < domain.length; i++) hash = ((hash << 5) - hash) + domain.charCodeAt(i);
  return colors[Math.abs(hash) % colors.length] ?? '#ffffff';
}
