/**
 * Ingestion worker that processes jobs from the `ingestion_jobs` queue.
 *
 * The worker is designed to run in the main process or in a Node.js worker
 * thread. It claims jobs with `FOR UPDATE SKIP LOCKED`, executes the
 * appropriate handler, and reports progress/completion.
 */
import type { Pool } from 'pg';
import { IngestionQueue, type ClaimedJob, type JobKind } from './IngestionQueue.js';
import type { MemoryFabric } from './MemoryFabric.js';
import { MemoryPipeline } from './MemoryPipeline.js';
import { MemoryConsolidator } from './MemoryConsolidator.js';
import { DocumentIngester } from './DocumentIngester.js';
import { SynapticPlasticity } from './SynapticPlasticity.js';
import { OnnxEmbeddingProvider } from './OnnxEmbeddingProvider.js';
import { LocalLLMJudge } from './LocalLLMJudge.js';

export interface IngestionWorkerOptions {
  /** Kinds to process. Defaults to all. */
  kinds?: JobKind[];
  /** Max concurrent jobs. */
  concurrency?: number;
  /** Poll interval in ms. */
  pollIntervalMs?: number;
  /** Embedding provider. */
  embed?: (text: string) => Promise<number[]>;
}

export class IngestionWorker {
  private queue: IngestionQueue;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = 0;
  private embed: (text: string) => Promise<number[]>;

  constructor(
    private pool: Pool,
    private fabric: MemoryFabric,
    private options: IngestionWorkerOptions = {},
  ) {
    this.queue = new IngestionQueue(pool);
    this.embed = options.embed ?? (async (text) => {
      const provider = new OnnxEmbeddingProvider();
      return provider.embed(text);
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    const pollIntervalMs = this.options.pollIntervalMs ?? 5000;
    this.timer = setTimeout(() => {
      void this.tick();
    }, pollIntervalMs);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const concurrency = this.options.concurrency ?? 1;
    const kinds = this.options.kinds ?? ['web_distill', 'document_ingest', 'memory_consolidate', 'plasticity', 'louvain_layout', 'rag_telemetry'];
    const limit = Math.max(1, concurrency - this.active);

    try {
      const jobs = await this.queue.claimNext(kinds, limit);
      if (jobs.length > 0) {
        for (const job of jobs) {
          this.active++;
          void this.runJob(job).finally(() => {
            this.active--;
          });
        }
      }
    } catch (e) {
      console.error('IngestionWorker tick failed:', e instanceof Error ? e.message : e);
    }

    this.scheduleNext();
  }

  private async runJob(claimed: ClaimedJob): Promise<void> {
    const { job } = claimed;
    try {
      await this.handleJob(claimed);
      await claimed.complete({ ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await claimed.fail(message, job.attemptCount + 1 < job.maxAttempts);
    }
  }

  private async handleJob(claimed: ClaimedJob): Promise<void> {
    const { job } = claimed;
    switch (job.kind) {
      case 'web_distill': {
        const pipeline = new MemoryPipeline(this.fabric, {
          consolidator: new MemoryConsolidator(this.fabric),
          ingester: new DocumentIngester(this.fabric),
          domainCluster: true,
          embed: this.embed,
        });
        await pipeline.run();
        return;
      }
      case 'document_ingest': {
        const payload = job.payload as { name?: string; kind?: string; content?: string; chunkSize?: number; chunkOverlap?: number };
        if (!payload.content || !payload.name) throw new Error('Invalid document_ingest payload');
        const ingester = new DocumentIngester(this.fabric);
        await ingester.ingest({
          name: payload.name,
          kind: (payload.kind as any) ?? 'text',
          content: payload.content,
          chunkSize: payload.chunkSize,
          chunkOverlap: payload.chunkOverlap,
          embed: this.embed,
        });
        return;
      }
      case 'memory_consolidate': {
        const consolidator = new MemoryConsolidator(this.fabric);
        await consolidator.consolidate(job.payload as Record<string, unknown>);
        return;
      }
      case 'plasticity': {
        const plasticity = new SynapticPlasticity(this.fabric);
        await plasticity.run(job.payload as Record<string, unknown>);
        return;
      }
      case 'louvain_layout': {
        await this.fabric.computeLouvainLayout();
        return;
      }
      case 'rag_telemetry': {
        await this.runRagTelemetry(claimed);
        return;
      }
      default:
        throw new Error(`Unknown job kind: ${(job as any).kind}`);
    }
  }

  private async runRagTelemetry(claimed: ClaimedJob): Promise<void> {
    const judge = new LocalLLMJudge();
    const { rows } = await this.pool.query<{ id: string; content: string }>(
      `SELECT id, content FROM memory_nodes
       WHERE category IN ('semantic', 'source_doc') AND status = 'active'
       ORDER BY RANDOM() LIMIT 5`
    );
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const question = await judge.generate(`Generate a single concrete question that can be answered from the following text. Reply with only the question.\n\n${row.content.slice(0, 800)}`, { maxTokens: 64 });
      const embedding = await this.embed(question);
      const matches = await this.fabric.vectorSearch(embedding, { limit: 5, category: 'semantic' });
      const relevant = matches.slice(0, 3);
      const scores = {
        contextRelevance: relevant.length > 0 ? 1.0 : 0.0,
        groundedness: relevant.some((m) => m.content.includes(row.content.slice(0, 100))) ? 1.0 : 0.0,
        mrr: this.computeMrr(relevant, row.id),
      };
      await this.pool.query(
        `INSERT INTO benchmark_scorecards (run_id, model, provider, total_score, max_score, rag_triad, test_results, metadata, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (run_id) DO UPDATE SET rag_triad = EXCLUDED.rag_triad, test_results = EXCLUDED.test_results, updated_at = NOW()`,
        [
          `rag-telemetry-${row.id}`,
          'telemetry',
          'local',
          scores.contextRelevance + scores.groundedness + scores.mrr,
          3,
          JSON.stringify(scores),
          JSON.stringify([{ question, nodeId: row.id }]),
          JSON.stringify({ kind: 'rag_telemetry' }),
        ],
      );
      await claimed.setProgress(Math.round(((i + 1) / rows.length) * 100));
    }
  }

  private computeMrr(matches: { id: string }[], targetId: string): number {
    const rank = matches.findIndex((m) => m.id === targetId) + 1;
    return rank > 0 ? 1 / rank : 0;
  }
}
